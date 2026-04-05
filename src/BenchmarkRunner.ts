/**
 * Native benchmark runner service.
 *
 * Replaces the Harbor CLI wrapper with an Effect-native implementation
 * that reads task directories, builds containers, runs agents inside
 * those containers, executes verifiers in the same container, and
 * collects scores.
 *
 * Each task gets its own ephemeral Docker container built from the
 * task's Dockerfile. The agent's shell commands execute inside that
 * container so the verifier can see the agent's filesystem changes.
 *
 * @since 0.3.0
 */
import { Clock, Effect, FileSystem, Layer, ServiceMap } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';
import { LanguageModel } from 'effect/unstable/ai';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import { AgentExecutor } from './AgentExecutor.js';
import { AgentConfigService } from './AgentRunner.js';
import { ContainerManager } from './ContainerManager.js';
import { Environment } from './Environment.js';
import { BenchmarkError } from './Errors.js';
import { AgentMetrics } from './Metrics.js';
import { type TaskSpec, discoverTasks } from './TaskSpec.js';

// =============================================================================
// Benchmark Options
// =============================================================================

/**
 * Options for running a benchmark suite.
 *
 * @since 0.3.0
 */
export class BenchmarkOptions extends Schema.Class<BenchmarkOptions>(
	'BenchmarkOptions'
)(
	{
		tasksDir: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'tasks'),
			Schema.withConstructorDefault(() => Option.some('tasks'))
		),
		concurrency: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 4),
			Schema.withConstructorDefault(() => Option.some(4))
		),
		baseImageTag: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'effect-autoagent:latest'),
			Schema.withConstructorDefault(() =>
				Option.some('effect-autoagent:latest')
			)
		),
		outputDir: Schema.OptionFromOptionalKey(Schema.String).pipe(
			Schema.withConstructorDefault(() => Option.some(Option.none()))
		)
	},
	{ description: 'Options for running a benchmark suite.' }
) {}

// =============================================================================
// Task Result
// =============================================================================

/**
 * Result of running a single benchmark task.
 *
 * @since 0.3.0
 */
export class TaskResult extends Schema.Class<TaskResult>('TaskResult')(
	{
		taskName: Schema.String,
		score: Schema.Number,
		passed: Schema.Boolean,
		durationMs: Schema.Number,
		metrics: AgentMetrics,
		verifierOutput: Schema.String
	},
	{ description: 'Result of running a single benchmark task.' }
) {}

// =============================================================================
// Benchmark Report
// =============================================================================

/**
 * Aggregated benchmark results across all tasks.
 *
 * @since 0.3.0
 */
export class BenchmarkReport extends Schema.Class<BenchmarkReport>(
	'BenchmarkReport'
)(
	{
		results: Schema.Array(TaskResult),
		totalPassed: Schema.Number,
		totalTasks: Schema.Number,
		avgScore: Schema.Number,
		passed: Schema.String
	},
	{ description: 'Aggregated benchmark results across all tasks.' }
) {}

// =============================================================================
// Service
// =============================================================================

/**
 * Native benchmark runner that executes tasks in Docker containers.
 *
 * @since 0.3.0
 */
export namespace BenchmarkRunner {
	export interface Interface {
		/**
		 * Run all tasks in a directory.
		 *
		 * @since 0.3.0
		 */
		readonly runAll: (
			options?: BenchmarkOptions
		) => Effect.Effect<BenchmarkReport, BenchmarkError>;

		/**
		 * Run a single task from a TaskSpec.
		 *
		 * @since 0.3.0
		 */
		readonly runTask: (
			taskSpec: TaskSpec
		) => Effect.Effect<TaskResult, BenchmarkError>;
	}

	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/BenchmarkRunner'
	) {}

	/**
	 * Live layer for the benchmark runner.
	 *
	 * Dependencies:
	 * - `ContainerManager.Service` — Docker operations
	 * - `LanguageModel.LanguageModel` — LLM provider for per-task agents
	 * - `AgentConfigService.Service` — agent config (optional, defaults apply)
	 * - `ChildProcessSpawner.ChildProcessSpawner` — for starting containers
	 * - `FileSystem.FileSystem` — for task discovery
	 *
	 * @since 0.3.0
	 */
	export const layer = Layer.effect(
		Service,
		Effect.gen(function* () {
			const container = yield* ContainerManager.Service;
			const lm = yield* LanguageModel.LanguageModel;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const fileSystem = yield* FileSystem.FileSystem;
			const clock = yield* Clock.Clock;
			const configOption = yield* Effect.serviceOption(
				AgentConfigService.Service
			);

			const wrapError = (operation: string) => (cause: unknown) =>
				new BenchmarkError({
					operation,
					message: `Benchmark ${operation} failed`,
					cause
				});

			/**
			 * Parse a score from verifier output.
			 * Reads reward.txt content (a float 0.0-1.0).
			 */
			const parseScore = (output: string): number => {
				const trimmed = Str.trim(output);
				const parsed = parseFloat(trimmed);
				return isNaN(parsed) ? 0 : parsed;
			};

			/**
			 * Start a Docker container from the given image, returning
			 * its container ID. The caller is responsible for cleanup
			 * via `container.removeContainer`.
			 */
			const startContainer = Effect.fn('BenchmarkRunner.startContainer')(
				function* (containerId: string, image: string) {
					yield* spawner
						.string(
							ChildProcess.make(
								'docker',
								[
									'run',
									'-d',
									'--name',
									containerId,
									image,
									'sleep',
									'infinity'
								],
								{ stdin: 'ignore' }
							)
						)
						.pipe(Effect.mapError(wrapError('startContainer')));
					return containerId;
				}
			);

			const runTask = Effect.fn('BenchmarkRunner.runTask')(function* (
				taskSpec: TaskSpec
			) {
				const startMs = yield* clock.currentTimeMillis;
				const taskName = taskSpec.config.task.name;
				const containerId = `bench-${taskName.replace(/\//g, '-')}-${startMs}`;
				const imageTag = `bench-${taskName.replace(/\//g, '-')}:latest`;
				const defaultImage = 'debian:bookworm-slim';

				// 1. Build container image if Dockerfile exists
				const hasDockerfile = Option.isSome(taskSpec.dockerfilePath);
				if (hasDockerfile) {
					yield* container
						.buildImage({
							dockerfile: Option.getOrElse(
								taskSpec.dockerfilePath,
								() => ''
							),
							contextDir: `${taskSpec.taskDir}/environment`,
							tag: imageTag
						})
						.pipe(Effect.mapError(wrapError('buildImage')));
				}

				// 2. Start a container from the task image (or default)
				const image = hasDockerfile ? imageTag : defaultImage;
				yield* startContainer(containerId, image);

				// 3. Run agent inside the task container
				//    Create an Environment wrapping the running container
				//    and build a per-task AgentExecutor layer.
				const taskEnv = Environment.fromContainer(
					containerId,
					container
				);
				const envLayer = Layer.succeed(
					Environment.Service,
					Environment.Service.of(taskEnv)
				);
				const modelLayer = Layer.succeed(
					LanguageModel.LanguageModel,
					lm
				);
				const configLayer = Option.match(configOption, {
					onNone: () => AgentConfigService.defaultLayer,
					onSome: (cfg) =>
						Layer.succeed(
							AgentConfigService.Service,
							AgentConfigService.Service.of(cfg)
						)
				});
				const executorLayer = AgentExecutor.layer.pipe(
					Layer.provide(modelLayer),
					Layer.provide(envLayer),
					Layer.provide(configLayer)
				);

				const agentResult = yield* Effect.gen(function* () {
					const exec = yield* AgentExecutor.Service;
					return yield* exec.runTask(taskSpec.instruction);
				}).pipe(
					Effect.provide(executorLayer),
					Effect.mapError(wrapError('runAgent'))
				);

				// 4. Copy test scripts into the container, then run verifier
				const hasTests = Arr.length(taskSpec.testScripts) > 0;
				if (hasTests) {
					yield* container
						.execInContainer({
							containerId,
							command: 'mkdir -p /tests /logs/verifier'
						})
						.pipe(
							Effect.catchTag('ContainerError', () => Effect.void)
						);

					yield* Effect.forEach(
						taskSpec.testScripts,
						(script) =>
							fileSystem
								.readFileString(
									`${taskSpec.taskDir}/tests/${script}`
								)
								.pipe(
									Effect.flatMap((content) =>
										container.copyToContainer({
											containerId,
											content,
											targetPath: `/tests/${script}`
										})
									),
									Effect.mapError(
										wrapError('copyTestScripts')
									)
								),
						{ concurrency: 4 }
					);
				}

				const verifierOutput: string = hasTests
					? yield* container
							.execInContainer({
								containerId,
								command:
									'chmod +x /tests/test.sh && /tests/test.sh',
								timeoutSec: taskSpec.config.verifier.timeout_sec
							})
							.pipe(
								Effect.map((result) =>
									Option.getOrElse(result.stdout, () => '')
								),
								Effect.catchTag('ContainerError', () =>
									Effect.succeed('(verifier failed)')
								)
							)
					: '';

				// 5. Parse score from verifier output in the same container
				const scoreOutput = yield* container
					.execInContainer({
						containerId,
						command:
							'cat /logs/verifier/reward.txt 2>/dev/null || echo "0"'
					})
					.pipe(
						Effect.map((result) =>
							Option.getOrElse(result.stdout, () => '0')
						),
						Effect.catchTag('ContainerError', () =>
							Effect.succeed('0')
						)
					);

				const score = parseScore(scoreOutput);

				// 6. Cleanup — remove the task container
				yield* container
					.removeContainer(containerId)
					.pipe(Effect.catchTag('ContainerError', () => Effect.void));

				const endMs = yield* clock.currentTimeMillis;
				const durationMs = Number(endMs - startMs);

				return new TaskResult({
					taskName,
					score,
					passed: score >= 1.0,
					durationMs,
					metrics: agentResult.metrics,
					verifierOutput
				});
			});

			const runAll = Effect.fn('BenchmarkRunner.runAll')(function* (
				options?: BenchmarkOptions
			) {
				const opts = options ?? new BenchmarkOptions({});
				const tasks = yield* discoverTasks(opts.tasksDir).pipe(
					Effect.provideService(FileSystem.FileSystem, fileSystem),
					Effect.mapError(wrapError('discoverTasks'))
				);

				const results = yield* Effect.forEach(
					tasks,
					(taskSpec) =>
						runTask(taskSpec).pipe(
							Effect.catchTag('BenchmarkError', (err) =>
								Effect.succeed(
									new TaskResult({
										taskName: taskSpec.config.task.name,
										score: 0,
										passed: false,
										durationMs: 0,
										metrics: new AgentMetrics({
											inputTokens: 0,
											outputTokens: 0,
											cachedTokens: 0,
											costUsd: Option.none(),
											durationMs: 0,
											numTurns: 0
										}),
										verifierOutput: `Error: ${err.message}`
									})
								)
							)
						),
					{ concurrency: opts.concurrency }
				);

				return aggregateResults(results);
			});

			return Service.of({ runAll, runTask });
		})
	);

	/**
	 * Create a test layer with mock benchmark operations.
	 *
	 * @since 0.3.0
	 */
	export const test = (responses?: {
		readonly runTask?: (taskSpec: TaskSpec) => TaskResult;
		readonly runAll?: (options?: BenchmarkOptions) => BenchmarkReport;
	}) =>
		Layer.succeed(
			Service,
			Service.of({
				runTask: (taskSpec) =>
					Effect.sync(
						() =>
							responses?.runTask?.(taskSpec) ??
							new TaskResult({
								taskName: taskSpec.config.task.name,
								score: 1.0,
								passed: true,
								durationMs: 100,
								metrics: new AgentMetrics({
									inputTokens: 10,
									outputTokens: 5,
									cachedTokens: 0,
									costUsd: Option.none(),
									durationMs: 100,
									numTurns: 1
								}),
								verifierOutput: 'mock pass'
							})
					),
				runAll: (options) =>
					Effect.sync(() => {
						if (responses?.runAll) {
							return responses.runAll(options);
						}
						return new BenchmarkReport({
							results: [],
							totalPassed: 0,
							totalTasks: 0,
							avgScore: 0,
							passed: '0/0'
						});
					})
			})
		);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Aggregate individual task results into a benchmark report.
 */
const aggregateResults = (
	results: ReadonlyArray<TaskResult>
): BenchmarkReport => {
	const totalTasks = Arr.length(results);
	const totalPassed = Arr.length(Arr.filter(results, (r) => r.passed));
	const avgScore =
		totalTasks > 0
			? Arr.reduce(results, 0, (acc, r) => acc + r.score) / totalTasks
			: 0;

	return new BenchmarkReport({
		results: Array.from(results),
		totalPassed,
		totalTasks,
		avgScore,
		passed: `${totalPassed}/${totalTasks}`
	});
};
