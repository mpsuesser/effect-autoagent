/**
 * Basic OpenAI agent example.
 *
 * Runs a single agent task using OpenAI's GPT model with local
 * shell execution. Set OPENAI_API_KEY in your environment.
 *
 * Usage: bun run examples/basic-openai.ts
 *
 * @since 0.3.0
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Layer } from 'effect';
import * as Option from 'effect/Option';

import {
	AgentExecutor,
	Environment,
	formatSummary,
	openAiModel
} from '../src/index.js';

const task = `
Create a file called hello.txt that contains "Hello from effect-autoagent!"
Then verify it exists by running cat hello.txt.
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
const ModelLayer = openAiModel('gpt-4o');
const ExecutorLayer = AgentExecutor.layer.pipe(
	Layer.provide(ModelLayer),
	Layer.provide(EnvLayer)
);

program.pipe(
	Effect.provide(ExecutorLayer),
	Effect.provide(BunServices.layer),
	BunRuntime.runMain
);
