/**
 * Basic Anthropic agent example.
 *
 * Runs a single agent task using Anthropic's Claude model with local
 * shell execution. Set ANTHROPIC_API_KEY in your environment.
 *
 * Usage: bun run examples/basic-anthropic.ts
 *
 * @since 0.3.0
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Layer } from 'effect';
import * as Option from 'effect/Option';

import {
	AgentExecutor,
	Environment,
	anthropicModel,
	formatSummary
} from '../src/index.js';

const task = `
List all files in the current directory and print each filename
on its own line.
`.trim();

const program = Effect.gen(function* () {
	const executor = yield* AgentExecutor.Service;
	const result = yield* executor.runTask(task);

	yield* Console.log(`Exit: ${result.exitReason}`);
	yield* Console.log(`Summary: ${formatSummary(result.metrics)}`);
	yield* Option.match(result.finalText, {
		onNone: () => Console.log('(no final text)'),
		onSome: (text) => Console.log(`Final: ${text.slice(0, 200)}`)
	});
});

const EnvLayer = Environment.local.pipe(Layer.provide(BunServices.layer));
const ModelLayer = anthropicModel('claude-sonnet-4-20250514');
const ExecutorLayer = AgentExecutor.layer.pipe(
	Layer.provide(ModelLayer),
	Layer.provide(EnvLayer)
);

program.pipe(
	Effect.provide(ExecutorLayer),
	Effect.provide(BunServices.layer),
	BunRuntime.runMain
);
