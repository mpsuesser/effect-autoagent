/**
 * Sandbox environment service abstraction.
 *
 * Provides a typed Effect service for executing commands in containers,
 * uploading files, and creating directories. Includes a bridge layer
 * for external Promise-based environment adapters and a local layer
 * for host-side shell execution.
 *
 * @since 0.1.0
 */
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import { ContainerManager } from './ContainerManager.js';
import { EnvironmentError } from './Errors.js';
import { ExecResult } from './ExecResult.js';

// =============================================================================
// Service Interface
// =============================================================================

/**
 * Sandbox environment for executing commands and managing files
 * inside an isolated container.
 *
 * @since 0.1.0
 */
export namespace Environment {
	export interface Interface {
		/**
		 * Execute a shell command in the container.
		 *
		 * @since 0.1.0
		 */
		readonly exec: (options: {
			readonly command: string;
			readonly timeoutSec?: number;
			readonly env?: Readonly<Record<string, string>>;
		}) => Effect.Effect<ExecResult, EnvironmentError>;

		/**
		 * Upload a file from the host to the container.
		 *
		 * @since 0.1.0
		 */
		readonly uploadFile: (options: {
			readonly content: string;
			readonly targetPath: string;
		}) => Effect.Effect<void, EnvironmentError>;

		/**
		 * Create a directory inside the container (mkdir -p).
		 *
		 * @since 0.1.0
		 */
		readonly mkdir: (path: string) => Effect.Effect<void, EnvironmentError>;
	}

	export class Service extends Context.Service<Service, Interface>()(
		'@autoagent/Environment'
	) {}

	/**
	 * Create a test environment that records all operations.
	 *
	 * @since 0.1.0
	 */
	export const test = (responses?: {
		readonly exec?: (command: string) => ExecResult;
	}) =>
		Layer.succeed(
			Service,
			Service.of({
				exec: (options) =>
					Effect.sync(() =>
						responses?.exec
							? responses.exec(options.command)
							: new ExecResult({
									stdout: Option.some(''),
									stderr: Option.none()
								})
					),
				uploadFile: () => Effect.void,
				mkdir: () => Effect.void
			})
		);

	/**
	 * Local environment that executes commands on the host machine.
	 * Uses `sh -c` for full shell interpretation.
	 *
	 * @since 0.3.0
	 */
	export const local: Layer.Layer<
		Service,
		never,
		ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
	> = Layer.effect(
		Service,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const fs = yield* FileSystem.FileSystem;

			const exec = Effect.fn('Environment.exec')(function* (options: {
				readonly command: string;
				readonly timeoutSec?: number;
				readonly env?: Readonly<Record<string, string>>;
			}) {
				const timeoutMs = (options.timeoutSec ?? 120) * 1000;
				const stdout = yield* spawner
					.string(
						ChildProcess.make('sh', ['-c', options.command], {
							stdin: 'ignore',
							...(options.env !== undefined
								? { env: options.env, extendEnv: true }
								: {})
						})
					)
					.pipe(
						Effect.timeout(`${timeoutMs} millis`),
						Effect.mapError(
							(cause) =>
								new EnvironmentError({
									operation: 'exec',
									message: `Command failed: ${options.command}`,
									cause
								})
						)
					);
				return new ExecResult({
					stdout: Option.fromNullishOr(stdout),
					stderr: Option.none()
				});
			});

			const uploadFile = Effect.fn('Environment.uploadFile')(
				function* (options: {
					readonly content: string;
					readonly targetPath: string;
				}) {
					yield* fs
						.writeFileString(options.targetPath, options.content)
						.pipe(
							Effect.mapError(
								(cause) =>
									new EnvironmentError({
										operation: 'uploadFile',
										message: `Upload failed: ${options.targetPath}`,
										cause
									})
							)
						);
				}
			);

			const mkdir = Effect.fn('Environment.mkdir')(function* (
				path: string
			) {
				yield* fs.makeDirectory(path, { recursive: true }).pipe(
					Effect.mapError(
						(cause) =>
							new EnvironmentError({
								operation: 'mkdir',
								message: `mkdir failed: ${path}`,
								cause
							})
					)
				);
			});

			return Service.of({ exec, uploadFile, mkdir });
		})
	);

	/**
	 * Docker-backed environment that runs commands inside an ephemeral
	 * container. The container is created on layer construction and
	 * removed on teardown via `Effect.acquireRelease`.
	 *
	 * @since 0.3.0
	 */
	export const docker = (
		image: string = 'debian:bookworm-slim'
	): Layer.Layer<
		Service,
		EnvironmentError,
		ContainerManager.Service | ChildProcessSpawner.ChildProcessSpawner
	> =>
		Layer.effect(
			Service,
			Effect.gen(function* () {
				const container = yield* ContainerManager.Service;
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				const ts = yield* Clock.currentTimeMillis;

				// Start container; remove on scope close
				const containerId = yield* Effect.acquireRelease(
					Effect.gen(function* () {
						const id = `ea-run-${ts}`;
						yield* spawner
							.string(
								ChildProcess.make(
									'docker',
									[
										'run',
										'-d',
										'--name',
										id,
										image,
										'sleep',
										'infinity'
									],
									{ stdin: 'ignore' }
								)
							)
							.pipe(
								Effect.mapError(
									(cause) =>
										new EnvironmentError({
											operation: 'docker.run',
											message: `Failed to start container ${id}`,
											cause
										})
								)
							);
						return id;
					}),
					(id) =>
						container
							.removeContainer(id)
							.pipe(
								Effect.catchTag(
									'ContainerError',
									() => Effect.void
								)
							)
				);

				const exec = Effect.fn('Environment.exec')(function* (options: {
					readonly command: string;
					readonly timeoutSec?: number;
					readonly env?: Readonly<Record<string, string>>;
				}) {
					const execOpts: {
						readonly containerId: string;
						readonly command: string;
						readonly timeoutSec?: number;
						readonly env?: Readonly<Record<string, string>>;
					} = {
						containerId,
						command: options.command,
						...(options.timeoutSec !== undefined
							? { timeoutSec: options.timeoutSec }
							: {}),
						...(options.env !== undefined
							? { env: options.env }
							: {})
					};
					return yield* container.execInContainer(execOpts).pipe(
						Effect.mapError(
							(cause) =>
								new EnvironmentError({
									operation: 'exec',
									message: `Command failed: ${options.command}`,
									cause
								})
						)
					);
				});

				const uploadFile = Effect.fn('Environment.uploadFile')(
					function* (options: {
						readonly content: string;
						readonly targetPath: string;
					}) {
						yield* container
							.copyToContainer({
								containerId,
								content: options.content,
								targetPath: options.targetPath
							})
							.pipe(
								Effect.mapError(
									(cause) =>
										new EnvironmentError({
											operation: 'uploadFile',
											message: `Upload failed: ${options.targetPath}`,
											cause
										})
								)
							);
					}
				);

				const mkdir = Effect.fn('Environment.mkdir')(function* (
					path: string
				) {
					yield* container
						.execInContainer({
							containerId,
							command: `mkdir -p ${path}`
						})
						.pipe(
							Effect.mapError(
								(cause) =>
									new EnvironmentError({
										operation: 'mkdir',
										message: `mkdir failed: ${path}`,
										cause
									})
							)
						);
				});

				return Service.of({ exec, uploadFile, mkdir });
			})
		);

	/**
	 * Create an `Environment.Service` implementation that wraps an
	 * already-running Docker container. Unlike `docker()`, this does NOT
	 * create or destroy the container — the caller is responsible for
	 * the container lifecycle.
	 *
	 * Used by `BenchmarkRunner` so the agent and verifier share the same
	 * container.
	 *
	 * @since 0.4.0
	 */
	export const fromContainer = (
		containerId: string,
		mgr: ContainerManager.Interface
	): Interface => ({
		exec: Effect.fn('Environment.exec')(function* (options: {
			readonly command: string;
			readonly timeoutSec?: number;
			readonly env?: Readonly<Record<string, string>>;
		}) {
			return yield* mgr
				.execInContainer({
					containerId,
					command: options.command,
					...(options.timeoutSec !== undefined
						? { timeoutSec: options.timeoutSec }
						: {}),
					...(options.env !== undefined ? { env: options.env } : {})
				})
				.pipe(
					Effect.mapError(
						(cause) =>
							new EnvironmentError({
								operation: 'exec',
								message: `Command failed: ${options.command}`,
								cause
							})
					)
				);
		}),
		uploadFile: Effect.fn('Environment.uploadFile')(function* (options: {
			readonly content: string;
			readonly targetPath: string;
		}) {
			yield* mgr
				.copyToContainer({
					containerId,
					content: options.content,
					targetPath: options.targetPath
				})
				.pipe(
					Effect.mapError(
						(cause) =>
							new EnvironmentError({
								operation: 'uploadFile',
								message: `Upload failed: ${options.targetPath}`,
								cause
							})
					)
				);
		}),
		mkdir: Effect.fn('Environment.mkdir')(function* (path: string) {
			yield* mgr
				.execInContainer({
					containerId,
					command: `mkdir -p ${path}`
				})
				.pipe(
					Effect.mapError(
						(cause) =>
							new EnvironmentError({
								operation: 'mkdir',
								message: `mkdir failed: ${path}`,
								cause
							})
					)
				);
		})
	});
}

// =============================================================================
// External Bridge Layer
// =============================================================================

/**
 * Raw exec result shape from an external environment adapter.
 *
 * @since 0.1.0
 */
export class BridgeExecResult extends Schema.Class<BridgeExecResult>(
	'BridgeExecResult'
)(
	{
		stdout: Schema.OptionFromNullishOr(Schema.String),
		stderr: Schema.OptionFromNullishOr(Schema.String)
	},
	{
		description:
			'Raw exec result shape from an external environment adapter.'
	}
) {}

/**
 * Options for creating an Environment layer from an external
 * Promise-based environment adapter.
 *
 * @since 0.1.0
 */
export interface BridgeOptions {
	/**
	 * Execute a command in the container.
	 */
	readonly exec: (options: {
		readonly command: string;
		readonly timeoutSec?: number;
		readonly env?: Readonly<Record<string, string>>;
	}) => Promise<{ stdout?: string | null; stderr?: string | null }>;

	/**
	 * Upload a file to the container.
	 */
	readonly uploadFile: (options: {
		readonly content: string;
		readonly targetPath: string;
	}) => Promise<void>;
}

/**
 * Create an Environment layer from a Promise-based bridge adapter.
 *
 * @since 0.1.0
 */
export const fromBridge = (bridge: BridgeOptions) =>
	Layer.succeed(
		Environment.Service,
		Environment.Service.of({
			exec: Effect.fn('Environment.exec')(function* (options) {
				const execOptions: {
					readonly command: string;
					readonly timeoutSec?: number;
					readonly env?: Readonly<Record<string, string>>;
				} = {
					command: options.command,
					...(options.timeoutSec !== undefined
						? { timeoutSec: options.timeoutSec }
						: {}),
					...(options.env !== undefined ? { env: options.env } : {})
				};
				const result = yield* Effect.tryPromise({
					try: () => bridge.exec(execOptions),
					catch: (cause) =>
						new EnvironmentError({
							operation: 'exec',
							message: `Command failed: ${options.command}`,
							cause
						})
				});
				return new ExecResult({
					stdout: Option.fromNullishOr(result.stdout),
					stderr: Option.fromNullishOr(result.stderr)
				});
			}),
			uploadFile: Effect.fn('Environment.uploadFile')(
				function* (options) {
					yield* Effect.tryPromise({
						try: () =>
							bridge.uploadFile({
								content: options.content,
								targetPath: options.targetPath
							}),
						catch: (cause) =>
							new EnvironmentError({
								operation: 'uploadFile',
								message: `Upload failed: ${options.targetPath}`,
								cause
							})
					});
				}
			),
			mkdir: Effect.fn('Environment.mkdir')(function* (path) {
				yield* Effect.tryPromise({
					try: () =>
						bridge.exec({
							command: `mkdir -p ${path}`
						}),
					catch: (cause) =>
						new EnvironmentError({
							operation: 'mkdir',
							message: `mkdir failed: ${path}`,
							cause
						})
				});
			})
		})
	);
