/**
 * Meta-agent assisted workflow example.
 *
 * Demonstrates the assisted mode API: diagnose failures, read editable
 * harness files, and record/evaluate results. This is the intended
 * integration point for coding agents that drive the optimization loop.
 *
 * NOTE: Requires a git repository, task directory, and experiment log
 * to be set up. This example illustrates the API shape — running it
 * without the full project setup will fail at runtime.
 *
 * Usage: bun run examples/meta-agent-workflow.ts
 *
 * @since 0.3.0
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Layer } from 'effect';
import * as Arr from 'effect/Array';

import {
	AgentExecutor,
	BenchmarkRunner,
	ContainerManager,
	Environment,
	ExperimentLog,
	MetaAgent,
	openAiModel
} from '../src/index.js';

const program = Effect.gen(function* () {
	const meta = yield* MetaAgent.Service;

	// Step 1: Diagnose failures from last benchmark run
	yield* Console.log('--- Step 1: Diagnose ---');
	const diagnosis = yield* meta.diagnose;
	yield* Console.log(
		`Found ${Arr.length(diagnosis.diagnoses)} failure diagnoses`
	);
	yield* Console.log(
		`Proposal: ${diagnosis.proposal.description.slice(0, 100)}`
	);

	// Step 2: Read the editable harness files
	yield* Console.log('--- Step 2: Read Harness ---');
	const files = yield* meta.readHarness;
	yield* Console.log(`Loaded ${Arr.length(files)} editable files`);

	// (A coding agent would modify files here based on the diagnosis)

	// Step 3: Record and evaluate
	yield* Console.log('--- Step 3: Record & Evaluate ---');
	const evalResult = yield* meta.recordAndEvaluate(
		'Applied prompt improvements based on diagnosis'
	);
	yield* Console.log(`Decision: ${evalResult.decision}`);
	yield* Console.log(`Passed: ${evalResult.currentPassed}`);
});

// Compose layers — MetaAgent needs many services wired together
const EnvLayer = Environment.local.pipe(Layer.provide(BunServices.layer));
const ModelLayer = openAiModel('gpt-4o');
const ExecutorLayer = AgentExecutor.layer.pipe(
	Layer.provide(ModelLayer),
	Layer.provide(EnvLayer)
);
const BenchLayer = BenchmarkRunner.layer.pipe(
	Layer.provide(ExecutorLayer),
	Layer.provide(BunServices.layer)
);
const ContainerLayer = ContainerManager.layer.pipe(
	Layer.provide(BunServices.layer)
);
const ExperimentLayer = ExperimentLog.layer('experiments.tsv').pipe(
	Layer.provide(BunServices.layer)
);
const MetaLayer = MetaAgent.layer.pipe(
	Layer.provide(BenchLayer),
	Layer.provide(ContainerLayer),
	Layer.provide(ExperimentLayer),
	Layer.provide(ModelLayer),
	Layer.provide(BunServices.layer)
);

program.pipe(Effect.provide(MetaLayer), BunRuntime.runMain);
