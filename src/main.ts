/**
 * CLI entrypoint for effect-autoagent.
 *
 * Provides subcommands:
 * - `run`       — Run an agent against a single task instruction.
 * - `bench`     — Run all benchmark tasks in a directory and collect scores.
 * - `serve http`— Serve the agent as an HTTP API.
 * - `serve mcp` — Serve the agent as an MCP server (stdio transport).
 *
 * Not exported from the library barrel — used as a standalone binary.
 *
 * @since 0.3.0
 */
import {
	BunHttpServer,
	BunRuntime,
	BunServices,
	BunStdio
} from '@effect/platform-bun';
import { Console, Effect, FileSystem, Layer, Logger } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { Command, Flag } from 'effect/unstable/cli';
import { FetchHttpClient, HttpRouter } from 'effect/unstable/http';
import { HttpApiBuilder } from 'effect/unstable/httpapi';

import { AgentBlueprint, BlueprintJson } from './AgentBlueprint.js';
import { AgentExecutor } from './AgentExecutor.js';
import { AgentFactory } from './AgentFactory.js';
import { AgentApi, AgentApiHandlers } from './AgentHttpApi.js';
import { AgentMcpLayer } from './AgentMcpServer.js';
import { AgentConfigService } from './AgentRunner.js';
import {
	BenchmarkOptions,
	BenchmarkReport,
	BenchmarkRunner,
	TaskResult
} from './BenchmarkRunner.js';
import { BlueprintStore } from './BlueprintStore.js';
import { ContainerManager } from './ContainerManager.js';
import { Environment } from './Environment.js';
import { formatSummary, trajectoryToJson } from './Metrics.js';
import { anthropicModel, openAiModel } from './Providers.js';
import { discoverTasks } from './TaskSpec.js';
import { ToolFactory } from './ToolFactory.js';
import * as McpServer from 'effect/unstable/ai/McpServer';

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
			Flag.withDefault('gpt-5.4'),
			Flag.withDescription(
				'Model identifier (e.g. gpt-5.4, claude-sonnet-4-6)'
			)
		),
		provider: Flag.choice('provider', ['openai', 'anthropic']).pipe(
			Flag.withAlias('p'),
			Flag.withDefault('openai' as const),
			Flag.withDescription('AI provider to use')
		),
		blueprint: Flag.file('blueprint', { mustExist: true }).pipe(
			Flag.withAlias('b'),
			Flag.optional,
			Flag.withDescription(
				'Path to a blueprint JSON file (AgentBlueprint)'
			)
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
 * Build the benchmark runner layer stack.
 *
 * Unlike `makeDockerExecutorLayer`, the bench flow does NOT pre-wire
 * an `AgentExecutor` — `BenchmarkRunner` creates a per-task executor
 * with a Docker environment targeting the task's container so the
 * agent and verifier share the same filesystem.
 */
const makeBenchLayer = (
	provider: 'openai' | 'anthropic',
	model: string,
	maxTurns: number
) => {
	const containerLayer = ContainerManager.layer.pipe(
		Layer.provide(BunServices.layer)
	);

	return BenchmarkRunner.layer.pipe(
		Layer.provide(makeProviderLayer(provider, model)),
		Layer.provide(containerLayer),
		Layer.provide(makeConfigLayer(model, maxTurns)),
		Layer.provide(BunServices.layer)
	);
};

/**
 * Build an AgentFactory layer backed by a Docker container.
 * Used when `--blueprint` is provided to construct agents from blueprints.
 */
const makeBlueprintRunLayer = (
	provider: 'openai' | 'anthropic',
	model: string
) => {
	const containerLayer = ContainerManager.layer.pipe(
		Layer.provide(BunServices.layer)
	);
	const envLayer = Environment.docker().pipe(
		Layer.provide(containerLayer),
		Layer.provide(BunServices.layer)
	);
	const toolFactoryLayer = ToolFactory.layer.pipe(Layer.provide(envLayer));

	return AgentFactory.layer.pipe(
		Layer.provide(makeProviderLayer(provider, model)),
		Layer.provide(envLayer),
		Layer.provide(toolFactoryLayer)
	);
};

/**
 * Read and decode a blueprint from a file path.
 */
const loadBlueprint = Effect.fn('CLI.loadBlueprint')(function* (
	blueprintPath: string
) {
	const fs = yield* FileSystem.FileSystem;
	const content = yield* fs.readFileString(blueprintPath);
	return yield* Schema.decodeUnknownEffect(BlueprintJson)(content).pipe(
		Effect.orDie
	);
});

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
		const { provider, model, blueprint: blueprintFile } = yield* app;
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

		yield* fs.makeDirectory(outputDir, { recursive: true });

		// Branch: blueprint-driven (AgentFactory) vs legacy (AgentExecutor)
		const result = yield* Option.match(blueprintFile, {
			onSome: (bpPath) =>
				Effect.gen(function* () {
					const blueprint = yield* loadBlueprint(bpPath);
					yield* Console.log(
						`Running via blueprint (${blueprint.model.provider}/${blueprint.model.modelName})...`
					);

					const factoryLayer = makeBlueprintRunLayer(
						blueprint.model.provider,
						blueprint.model.modelName
					);
					return yield* Effect.gen(function* () {
						const factory = yield* AgentFactory.Service;
						const runtime = yield* factory
							.fromBlueprint(blueprint)
							.pipe(Effect.orDie);
						return yield* runtime.runTask(instruction);
					}).pipe(Effect.provide(factoryLayer));
				}),
			onNone: () =>
				Effect.gen(function* () {
					yield* Console.log(
						`Running agent with ${provider}/${model} (Docker)...`
					);
					const executorLayer = makeDockerExecutorLayer(
						provider,
						model,
						maxTurns
					);
					return yield* Effect.gen(function* () {
						const executor = yield* AgentExecutor.Service;
						return yield* executor.runTask(instruction);
					}).pipe(Effect.provide(executorLayer));
				})
		});

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
		const { provider, model, blueprint: blueprintFile } = yield* app;
		const fs = yield* FileSystem.FileSystem;

		yield* fs.makeDirectory(outputDir, { recursive: true });

		// Blueprint-driven single-task bench (--blueprint + --task-name)
		const report = yield* Option.match(blueprintFile, {
			onSome: (bpPath) =>
				Option.match(taskName, {
					onSome: (name) =>
						Effect.gen(function* () {
							const blueprint = yield* loadBlueprint(bpPath);
							yield* Console.log(
								`Running single task '${name}' via blueprint...`
							);

							const factoryLayer = makeBlueprintRunLayer(
								blueprint.model.provider,
								blueprint.model.modelName
							);
							const tasks = yield* discoverTasks(tasksDir).pipe(
								Effect.orDie
							);
							const target = Arr.findFirst(
								tasks,
								(t) => t.config.task.name === name
							);
							const spec = yield* Option.match(target, {
								onSome: Effect.succeed,
								onNone: () =>
									Effect.die(`Task not found: ${name}`)
							});

							const result = yield* Effect.gen(function* () {
								const factory = yield* AgentFactory.Service;
								const runtime = yield* factory
									.fromBlueprint(blueprint)
									.pipe(Effect.orDie);
								const agentResult = yield* runtime
									.runTask(spec.instruction)
									.pipe(Effect.orDie);
								return agentResult;
							}).pipe(Effect.provide(factoryLayer));

							const passed = result.exitReason === 'completed';
							const score = passed ? 1 : 0;

							return new BenchmarkReport({
								results: [
									new TaskResult({
										taskName: name,
										passed,
										score,
										durationMs: result.metrics.durationMs,
										metrics: result.metrics,
										verifierOutput: Option.getOrElse(
											result.finalText,
											() => ''
										)
									})
								],
								totalPassed: passed ? 1 : 0,
								totalTasks: 1,
								avgScore: score,
								passed: passed ? '1/1' : '0/1'
							});
						}),
					onNone: () =>
						// Blueprint + full bench not yet supported — fall through to legacy
						Effect.gen(function* () {
							yield* Console.log(
								'Blueprint + full bench not yet integrated. Using legacy path.'
							);
							return yield* runLegacyBench(
								provider,
								model,
								maxTurns,
								tasksDir,
								concurrency,
								taskName
							);
						})
				}),
			onNone: () =>
				runLegacyBench(
					provider,
					model,
					maxTurns,
					tasksDir,
					concurrency,
					taskName
				)
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
				'effect-autoagent bench -p openai -m gpt-5.4 --tasks-dir tasks/ -n 100',
			description: 'Run all tasks with OpenAI gpt-5.4'
		},
		{
			command:
				'effect-autoagent bench --task-name my-task -p anthropic -m claude-sonnet-4-6',
			description: 'Run a single named task'
		},
		{
			command:
				'effect-autoagent bench --task-name my-task --blueprint agent.json',
			description: 'Run a single task with a blueprint'
		}
	])
);

/**
 * Legacy benchmark runner — uses the old AgentExecutor-based path.
 * @internal
 */
const runLegacyBench = Effect.fn('CLI.runLegacyBench')(function* (
	provider: 'openai' | 'anthropic',
	model: string,
	maxTurns: number,
	tasksDir: string,
	concurrency: number,
	taskName: Option.Option<string>
) {
	const benchLayer = Layer.mergeAll(
		makeBenchLayer(provider, model, maxTurns),
		BunServices.layer
	);

	yield* Console.log(
		`Running benchmarks from ${tasksDir}/ with ${provider}/${model} (concurrency=${concurrency})...`
	);

	return yield* Option.match(taskName, {
		onSome: (name) =>
			Effect.gen(function* () {
				const runner = yield* BenchmarkRunner.Service;
				const tasks = yield* discoverTasks(tasksDir).pipe(Effect.orDie);
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
});

// =============================================================================
// `serve` command group
// =============================================================================

/**
 * Build the full service layer stack for blueprint-based serving.
 * Includes AgentFactory, ToolFactory, BlueprintStore, and Environment.
 */
const makeServeLayer = (blueprint: AgentBlueprint) => {
	const containerLayer = ContainerManager.layer.pipe(
		Layer.provide(BunServices.layer)
	);
	const envLayer = Environment.docker().pipe(
		Layer.provide(containerLayer),
		Layer.provide(BunServices.layer)
	);
	const toolFactoryLayer = ToolFactory.layer.pipe(Layer.provide(envLayer));
	const agentFactoryLayer = AgentFactory.layer.pipe(
		Layer.provide(
			makeProviderLayer(
				blueprint.model.provider,
				blueprint.model.modelName
			)
		),
		Layer.provide(envLayer),
		Layer.provide(toolFactoryLayer)
	);
	const blueprintStoreLayer = BlueprintStore.layer.pipe(
		Layer.provide(BunServices.layer)
	);

	return Layer.mergeAll(agentFactoryLayer, blueprintStoreLayer);
};

const serve = Command.make('serve').pipe(
	Command.withDescription('Serve the agent as an HTTP API or MCP server')
);

// =============================================================================
// `serve http` subcommand
// =============================================================================

const serveHttp = Command.make(
	'http',
	{
		port: Flag.integer('port').pipe(
			Flag.withDefault(3000),
			Flag.withDescription('HTTP server port')
		)
	},
	Effect.fn(function* ({ port }) {
		const { blueprint: blueprintFile } = yield* app;

		const bpPath = yield* Option.match(blueprintFile, {
			onSome: Effect.succeed,
			onNone: () =>
				Effect.die('--blueprint is required for serve commands')
		});

		const blueprint = yield* loadBlueprint(bpPath);
		yield* Console.log(
			`Starting HTTP server on port ${port} (${blueprint.model.provider}/${blueprint.model.modelName})...`
		);

		// Save blueprint to store for the handler to read
		const serviceLayer = makeServeLayer(blueprint);

		const apiRoutes = HttpApiBuilder.layer(AgentApi, {
			openapiPath: '/openapi.json'
		}).pipe(Layer.provide(AgentApiHandlers), Layer.provide(serviceLayer));

		const serverLayer = HttpRouter.serve(apiRoutes).pipe(
			Layer.provide(BunHttpServer.layer({ port }))
		);

		// Save the initial blueprint into the store, then launch
		yield* Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;
			yield* store.save(blueprint);
		}).pipe(Effect.provide(serviceLayer));

		yield* Console.log(`HTTP server listening on http://localhost:${port}`);
		yield* Console.log('Endpoints:');
		yield* Console.log('  POST /api/run       — Run a task');
		yield* Console.log('  GET  /api/blueprint — Get current blueprint');
		yield* Console.log('  PUT  /api/blueprint — Update blueprint');
		yield* Console.log('  GET  /api/health    — Health check');
		yield* Console.log('  GET  /openapi.json  — OpenAPI spec');

		return yield* Layer.launch(serverLayer);
	})
).pipe(
	Command.withDescription('Serve the agent as an HTTP API'),
	Command.withExamples([
		{
			command:
				'effect-autoagent serve http --port 3000 --blueprint agent.json',
			description: 'Start HTTP server with a blueprint'
		}
	])
);

// =============================================================================
// `serve mcp` subcommand
// =============================================================================

const serveMcp = Command.make(
	'mcp',
	{},
	Effect.fn(function* () {
		const { blueprint: blueprintFile } = yield* app;

		const bpPath = yield* Option.match(blueprintFile, {
			onSome: Effect.succeed,
			onNone: () =>
				Effect.die('--blueprint is required for serve commands')
		});

		const blueprint = yield* loadBlueprint(bpPath);

		const serviceLayer = makeServeLayer(blueprint);

		const mcpServerLayer = AgentMcpLayer.pipe(
			Layer.provide(
				McpServer.layerStdio({
					name: 'effect-autoagent',
					version: '0.3.0'
				})
			),
			Layer.provide(serviceLayer),
			Layer.provide(BunStdio.layer),
			Layer.provide(
				Logger.layer([Logger.consolePretty({ stderr: true })])
			)
		);

		// Save initial blueprint into the store
		yield* Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;
			yield* store.save(blueprint);
		}).pipe(Effect.provide(serviceLayer));

		return yield* Layer.launch(mcpServerLayer);
	})
).pipe(
	Command.withDescription(
		'Serve the agent as an MCP server (stdio transport)'
	),
	Command.withExamples([
		{
			command: 'effect-autoagent serve mcp --blueprint agent.json',
			description: 'Start MCP stdio server with a blueprint'
		}
	])
);

// =============================================================================
// Entry Point
// =============================================================================

app.pipe(
	Command.withSubcommands([
		run,
		bench,
		serve.pipe(Command.withSubcommands([serveHttp, serveMcp]))
	]),
	Command.run({ version: '0.3.0' }),
	Effect.provide(PlatformLayer),
	BunRuntime.runMain
);
