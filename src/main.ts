/**
 * CLI entrypoint for effect-autoagent.
 *
 * Provides two subcommands:
 * - `run`   — Run an agent against a single task instruction.
 * - `bench` — Run all benchmark tasks in a directory and collect scores.
 *
 * Not exported from the library barrel — used as a standalone binary.
 *
 * @since 0.3.0
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, FileSystem, Layer } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import { Command, Flag } from 'effect/unstable/cli';
import { FetchHttpClient } from 'effect/unstable/http';

import { AgentExecutor } from './AgentExecutor.js';
import { AgentConfigService } from './AgentRunner.js';
import {
	BenchmarkOptions,
	BenchmarkReport,
	BenchmarkRunner
} from './BenchmarkRunner.js';
import { ContainerManager } from './ContainerManager.js';
import { Environment } from './Environment.js';
import { formatSummary, trajectoryToJson } from './Metrics.js';
import { anthropicModel, openAiModel } from './Providers.js';
import { discoverTasks } from './TaskSpec.js';

// =============================================================================
// Platform layer
// =============================================================================

const PlatformLayer = Layer.merge(BunServices.layer, FetchHttpClient.layer);

// =============================================================================
// Root command with shared provider/model flags
// =============================================================================

const app = Command.make('effect-autoagent').pipe(
	Command.withSharedFlags({
		model: Flag.string('model').pipe(
			Flag.withAlias('m'),
			Flag.withDefault('gpt-5'),
			Flag.withDescription(
				'Model identifier (e.g. gpt-5, claude-sonnet-4-20250514)'
			)
		),
		provider: Flag.choice('provider', ['openai', 'anthropic']).pipe(
			Flag.withAlias('p'),
			Flag.withDefault('openai' as const),
			Flag.withDescription('AI provider to use')
		)
	}),
	Command.withDescription(
		'Meta-agent framework for autonomous agent harness iteration'
	)
);

// =============================================================================
// Shared layer helpers
// =============================================================================

const makeConfigLayer = (model: string, maxTurns: number) =>
	Layer.succeed(
		AgentConfigService.Service,
		AgentConfigService.Service.of({
			name: 'effect-autoagent',
			version: '0.3.0',
			model,
			maxTurns,
			shellTimeoutSec: 120,
			containerTimeoutSec: 600
		})
	);

const makeProviderLayer = (provider: 'openai' | 'anthropic', model: string) =>
	provider === 'openai' ? openAiModel(model) : anthropicModel(model);

/**
 * Build an executor layer backed by a Docker container.
 * Used by the `run` subcommand for ad-hoc task execution.
 */
const makeDockerExecutorLayer = (
	provider: 'openai' | 'anthropic',
	model: string,
	maxTurns: number
) => {
	const containerLayer = ContainerManager.layer.pipe(
		Layer.provide(BunServices.layer)
	);
	const envLayer = Environment.docker().pipe(
		Layer.provide(containerLayer),
		Layer.provide(BunServices.layer)
	);

	return AgentExecutor.layer.pipe(
		Layer.provide(makeProviderLayer(provider, model)),
		Layer.provide(envLayer),
		Layer.provide(makeConfigLayer(model, maxTurns))
	);
};

/**
 * Build an executor layer backed by local shell execution.
 * Used by the `bench` subcommand where Docker is managed externally
 * per-task by `BenchmarkRunner`.
 */
const makeLocalExecutorLayer = (
	provider: 'openai' | 'anthropic',
	model: string,
	maxTurns: number
) => {
	const envLayer = Environment.local.pipe(Layer.provide(BunServices.layer));

	return AgentExecutor.layer.pipe(
		Layer.provide(makeProviderLayer(provider, model)),
		Layer.provide(envLayer),
		Layer.provide(makeConfigLayer(model, maxTurns))
	);
};

// =============================================================================
// `run` subcommand — run a single task
// =============================================================================

const run = Command.make(
	'run',
	{
		task: Flag.string('task').pipe(
			Flag.optional,
			Flag.withAlias('t'),
			Flag.withDescription('Inline task instruction')
		),
		taskFile: Flag.file('task-file').pipe(
			Flag.optional,
			Flag.withAlias('f'),
			Flag.withDescription('Path to task instruction file')
		),
		outputDir: Flag.string('output-dir').pipe(
			Flag.withDefault('.'),
			Flag.withAlias('o'),
			Flag.withDescription('Directory to write trajectory output')
		),
		maxTurns: Flag.integer('max-turns').pipe(
			Flag.withDefault(30),
			Flag.withDescription('Maximum agent turns')
		)
	},
	Effect.fn(function* ({ task, taskFile, outputDir, maxTurns }) {
		const { provider, model } = yield* app;
		const fs = yield* FileSystem.FileSystem;

		const instruction = yield* Option.match(task, {
			onSome: Effect.succeed,
			onNone: () =>
				Option.match(taskFile, {
					onSome: (path) => fs.readFileString(path),
					onNone: () =>
						Effect.die(
							'Either --task or --task-file must be provided'
						)
				})
		});

		const executorLayer = makeDockerExecutorLayer(
			provider,
			model,
			maxTurns
		);

		yield* fs.makeDirectory(outputDir, { recursive: true });

		yield* Console.log(
			`Running agent with ${provider}/${model} (Docker)...`
		);

		const result = yield* Effect.gen(function* () {
			const executor = yield* AgentExecutor.Service;
			return yield* executor.runTask(instruction);
		}).pipe(Effect.provide(executorLayer));

		const trajectoryPath = `${outputDir}/trajectory.json`;
		yield* fs.writeFileString(
			trajectoryPath,
			trajectoryToJson(result.trajectory)
		);

		yield* Console.log(`Exit reason: ${result.exitReason}`);
		yield* Console.log(`Summary: ${formatSummary(result.metrics)}`);
		yield* Console.log(`Trajectory written to: ${trajectoryPath}`);
	})
).pipe(
	Command.withDescription('Run an agent against a single task instruction')
);

// =============================================================================
// `bench` subcommand — run all benchmark tasks
// =============================================================================

const bench = Command.make(
	'bench',
	{
		tasksDir: Flag.string('tasks-dir').pipe(
			Flag.withDefault('tasks'),
			Flag.withDescription('Directory containing benchmark tasks')
		),
		concurrency: Flag.integer('concurrency').pipe(
			Flag.withAlias('n'),
			Flag.withDefault(4),
			Flag.withDescription('Number of tasks to run in parallel')
		),
		outputDir: Flag.string('output-dir').pipe(
			Flag.withDefault('jobs'),
			Flag.withAlias('o'),
			Flag.withDescription('Directory to write job outputs')
		),
		maxTurns: Flag.integer('max-turns').pipe(
			Flag.withDefault(30),
			Flag.withDescription('Maximum agent turns per task')
		),
		taskName: Flag.string('task-name').pipe(
			Flag.optional,
			Flag.withDescription('Run only a single named task')
		)
	},
	Effect.fn(function* ({
		tasksDir,
		concurrency,
		outputDir,
		maxTurns,
		taskName
	}) {
		const { provider, model } = yield* app;
		const fs = yield* FileSystem.FileSystem;

		// Build benchmark layer stack
		const executorLayer = makeLocalExecutorLayer(provider, model, maxTurns);
		const containerLayer = ContainerManager.layer.pipe(
			Layer.provide(BunServices.layer)
		);
		const benchLayer = Layer.mergeAll(
			BenchmarkRunner.layer.pipe(
				Layer.provide(executorLayer),
				Layer.provide(containerLayer),
				Layer.provide(BunServices.layer)
			),
			BunServices.layer
		);

		yield* fs.makeDirectory(outputDir, { recursive: true });

		yield* Console.log(
			`Running benchmarks from ${tasksDir}/ with ${provider}/${model} (concurrency=${concurrency})...`
		);

		const report = yield* Option.match(taskName, {
			onSome: (name) =>
				Effect.gen(function* () {
					const runner = yield* BenchmarkRunner.Service;
					const tasks = yield* discoverTasks(tasksDir).pipe(
						Effect.orDie
					);
					const target = Arr.findFirst(
						tasks,
						(t) => t.config.task.name === name
					);
					const spec = yield* Option.match(target, {
						onSome: Effect.succeed,
						onNone: () => Effect.die(`Task not found: ${name}`)
					});
					const result = yield* runner.runTask(spec);
					return new BenchmarkReport({
						results: [result],
						totalPassed: result.passed ? 1 : 0,
						totalTasks: 1,
						avgScore: result.score,
						passed: result.passed ? '1/1' : '0/1'
					});
				}).pipe(Effect.provide(benchLayer)),
			onNone: () =>
				Effect.gen(function* () {
					const runner = yield* BenchmarkRunner.Service;
					return yield* runner.runAll(
						new BenchmarkOptions({ tasksDir, concurrency })
					);
				}).pipe(Effect.provide(benchLayer))
		});

		// Print per-task results
		yield* Effect.forEach(
			report.results,
			(r) =>
				Console.log(
					`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.taskName}  score=${r.score}`
				),
			{ concurrency: 1 }
		);

		yield* Console.log('');
		yield* Console.log(
			`passed=${report.passed}  avg_score=${report.avgScore.toFixed(3)}`
		);
	})
).pipe(
	Command.withDescription(
		'Run all benchmark tasks and collect scores (equivalent to harbor run)'
	),
	Command.withExamples([
		{
			command:
				'effect-autoagent bench -p openai -m gpt-5 --tasks-dir tasks/ -n 100',
			description: 'Run all tasks with OpenAI gpt-5'
		},
		{
			command:
				'effect-autoagent bench --task-name my-task -p anthropic -m claude-sonnet-4-20250514',
			description: 'Run a single named task'
		}
	])
);

// =============================================================================
// Entry Point
// =============================================================================

app.pipe(
	Command.withSubcommands([run, bench]),
	Command.run({ version: '0.3.0' }),
	Effect.provide(PlatformLayer),
	BunRuntime.runMain
);
