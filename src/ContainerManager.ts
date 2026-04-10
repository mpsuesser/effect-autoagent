/**
 * Docker container management service.
 *
 * Wraps Docker CLI operations (build, exec, copy, remove) via Effect's
 * `ChildProcessSpawner`, providing typed errors and resource-safe
 * lifecycle management.
 *
 * @since 0.2.0
 */
import { Context, Effect, Layer } from 'effect';
import * as Option from 'effect/Option';
import * as R from 'effect/Record';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import { ContainerError } from './Errors.js';
import { ExecResult } from './ExecResult.js';

// =============================================================================
// Build Result
// =============================================================================

/**
 * Result of a Docker image build operation.
 *
 * @since 0.2.0
 */
export class BuildResult extends Schema.Class<BuildResult>('BuildResult')(
	{
		imageName: Schema.String,
		tag: Schema.String,
		output: Schema.String
	},
	{ description: 'Result of a Docker image build operation.' }
) {}

// =============================================================================
// Service
// =============================================================================

/**
 * Docker container lifecycle management service.
 *
 * Provides typed operations for building images, executing commands
 * in containers, copying files into containers, and cleanup.
 *
 * @since 0.2.0
 */
export namespace ContainerManager {
	export interface Interface {
		/**
		 * Build a Docker image from a Dockerfile.
		 *
		 * @since 0.2.0
		 */
		readonly buildImage: (options: {
			readonly dockerfile: string;
			readonly contextDir: string;
			readonly tag: string;
		}) => Effect.Effect<BuildResult, ContainerError>;

		/**
		 * Execute a command inside a running container.
		 *
		 * @since 0.2.0
		 */
		readonly execInContainer: (options: {
			readonly containerId: string;
			readonly command: string;
			readonly timeoutSec?: number;
			readonly env?: Readonly<Record<string, string>>;
		}) => Effect.Effect<ExecResult, ContainerError>;

		/**
		 * Copy content into a container at the specified path.
		 *
		 * @since 0.2.0
		 */
		readonly copyToContainer: (options: {
			readonly containerId: string;
			readonly content: string;
			readonly targetPath: string;
		}) => Effect.Effect<void, ContainerError>;

		/**
		 * Remove a container (force).
		 *
		 * @since 0.2.0
		 */
		readonly removeContainer: (
			containerId: string
		) => Effect.Effect<void, ContainerError>;
	}

	export class Service extends Context.Service<Service, Interface>()(
		'@autoagent/ContainerManager'
	) {}

	export const layer = Layer.effect(
		Service,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

			const wrapError = (operation: string) => (cause: unknown) =>
				new ContainerError({
					operation,
					message: `Docker ${operation} failed`,
					cause
				});

			const buildImage = Effect.fn('ContainerManager.buildImage')(
				function* (options: {
					readonly dockerfile: string;
					readonly contextDir: string;
					readonly tag: string;
				}) {
					const output = yield* spawner
						.string(
							ChildProcess.make('docker', [
								'build',
								'-f',
								options.dockerfile,
								'-t',
								options.tag,
								options.contextDir
							])
						)
						.pipe(Effect.mapError(wrapError('build')));

					const colonIdx = options.tag.indexOf(':');
					const imageName =
						colonIdx >= 0
							? options.tag.slice(0, colonIdx)
							: options.tag;
					const tag =
						colonIdx >= 0
							? options.tag.slice(colonIdx + 1)
							: 'latest';

					return new BuildResult({
						imageName,
						tag,
						output
					});
				}
			);

			const execInContainer = Effect.fn(
				'ContainerManager.execInContainer'
			)(function* (options: {
				readonly containerId: string;
				readonly command: string;
				readonly timeoutSec?: number;
				readonly env?: Readonly<Record<string, string>>;
			}) {
				const emptyArgs: Array<string> = [];
				const envArgs: Array<string> = Option.match(
					Option.fromNullishOr(options.env),
					{
						onNone: (): Array<string> => emptyArgs,
						onSome: (envRecord) => {
							const init: Array<string> = [];
							return R.reduce(
								envRecord,
								init,
								(acc, value, key) => [
									...acc,
									'-e',
									`${key}=${value}`
								]
							);
						}
					}
				);

				const cmd = ChildProcess.make(
					'docker',
					[
						'exec',
						...envArgs,
						options.containerId,
						'sh',
						'-c',
						options.command
					],
					{ stdin: 'ignore' }
				);

				const timeoutMs = (options.timeoutSec ?? 120) * 1000;

				const output = yield* spawner
					.string(cmd)
					.pipe(
						Effect.timeout(`${timeoutMs} millis`),
						Effect.mapError(wrapError('exec'))
					);

				return new ExecResult({
					stdout: Option.fromNullishOr(output),
					stderr: Option.none()
				});
			});

			const copyToContainer = Effect.fn(
				'ContainerManager.copyToContainer'
			)(function* (options: {
				readonly containerId: string;
				readonly content: string;
				readonly targetPath: string;
			}) {
				// Base64-encode to avoid shell-quoting issues, then decode
				// inside the container. This avoids stdin piping (which hangs
				// when spawner.string is used because nothing writes to stdin).
				const encoded = Buffer.from(options.content).toString('base64');
				yield* spawner
					.string(
						ChildProcess.make(
							'docker',
							[
								'exec',
								options.containerId,
								'sh',
								'-c',
								`echo '${encoded}' | base64 -d > ${options.targetPath}`
							],
							{ stdin: 'ignore' }
						)
					)
					.pipe(Effect.mapError(wrapError('copyToContainer')));
			});

			const removeContainer = Effect.fn(
				'ContainerManager.removeContainer'
			)(function* (containerId: string) {
				yield* spawner
					.string(
						ChildProcess.make('docker', ['rm', '-f', containerId])
					)
					.pipe(
						Effect.map(Str.trim),
						Effect.mapError(wrapError('removeContainer'))
					);
			});

			return Service.of({
				buildImage,
				execInContainer,
				copyToContainer,
				removeContainer
			});
		})
	);

	/**
	 * Create a test layer with mock Docker operations.
	 *
	 * @since 0.2.0
	 */
	export const test = (responses?: {
		readonly buildImage?: (tag: string) => BuildResult;
		readonly execInContainer?: (command: string) => ExecResult;
	}) =>
		Layer.succeed(
			Service,
			Service.of({
				buildImage: (options) =>
					Effect.sync(() =>
						responses?.buildImage
							? responses.buildImage(options.tag)
							: new BuildResult({
									imageName: options.tag,
									tag: 'latest',
									output: 'mock build output'
								})
					),
				execInContainer: (options) =>
					Effect.sync(() =>
						responses?.execInContainer
							? responses.execInContainer(options.command)
							: new ExecResult({
									stdout: Option.some(''),
									stderr: Option.none()
								})
					),
				copyToContainer: () => Effect.void,
				removeContainer: () => Effect.void
			})
		);
}
