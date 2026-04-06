import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import {
	AgentBlueprint,
	BlueprintJson,
	defaultBlueprint
} from '../src/AgentBlueprint.js';
import { AgentFactory } from '../src/AgentFactory.js';
import { AgentRunResult } from '../src/AgentRunResult.js';
import {
	type BlueprintPatch,
	SetConstraints,
	SetSystemPrompt,
	AddTool,
	RemoveTool,
	applyPatches
} from '../src/BlueprintPatch.js';
import { BlueprintStore } from '../src/BlueprintStore.js';
import { RunShellImpl, ToolSpec } from '../src/ToolSpec.js';

// =============================================================================
// Fixtures
// =============================================================================

const customBlueprint = new AgentBlueprint({
	name: 'integration-agent',
	version: '2.0.0',
	systemPrompt: 'You are a helpful test agent.',
	description: 'Integration test blueprint'
});

// =============================================================================
// Blueprint JSON round-trip
// =============================================================================

describe('Integration: Blueprint JSON round-trip', () => {
	it.effect('encodes and decodes a blueprint losslessly', () =>
		Effect.gen(function* () {
			const encoded =
				yield* Schema.encodeEffect(BlueprintJson)(customBlueprint);
			expect(typeof encoded).toBe('string');

			const decoded =
				yield* Schema.decodeUnknownEffect(BlueprintJson)(encoded);
			expect(decoded.name).toBe('integration-agent');
			expect(decoded.version).toBe('2.0.0');
			expect(decoded.systemPrompt).toBe('You are a helpful test agent.');
			expect(decoded.model.provider).toBe('openai');
			expect(decoded.model.modelName).toBe('gpt-5.4');
		})
	);

	it.effect('round-trips default blueprint', () =>
		Effect.gen(function* () {
			const encoded =
				yield* Schema.encodeEffect(BlueprintJson)(defaultBlueprint);
			const decoded =
				yield* Schema.decodeUnknownEffect(BlueprintJson)(encoded);

			expect(decoded.name).toBe(defaultBlueprint.name);
			expect(decoded.version).toBe(defaultBlueprint.version);
			expect(decoded.systemPrompt).toBe(defaultBlueprint.systemPrompt);
			expect(decoded.orchestration._tag).toBe('SingleLoop');
			expect(Arr.length(decoded.tools)).toBe(
				Arr.length(defaultBlueprint.tools)
			);
		})
	);

	it.effect('decodes minimal JSON with defaults', () =>
		Effect.gen(function* () {
			const minimalJson = '{}';
			const decoded =
				yield* Schema.decodeUnknownEffect(BlueprintJson)(minimalJson);

			expect(decoded.name).toBe('autoagent');
			expect(decoded.version).toBe('0.1.0');
			expect(decoded.orchestration._tag).toBe('SingleLoop');
			expect(decoded.constraints.maxTurns).toBe(100);
		})
	);
});

// =============================================================================
// Blueprint patches
// =============================================================================

describe('Integration: Blueprint patch application', () => {
	it('applies SetSystemPrompt patch', () => {
		const patches: ReadonlyArray<BlueprintPatch> = [
			new SetSystemPrompt({ prompt: 'New prompt' })
		];
		const result = applyPatches(defaultBlueprint, patches);
		expect(result.systemPrompt).toBe('New prompt');
	});

	it('applies SetConstraints patch', () => {
		const patches: ReadonlyArray<BlueprintPatch> = [
			new SetConstraints({
				maxTurns: 50,
				shellTimeoutSec: 60
			})
		];
		const result = applyPatches(defaultBlueprint, patches);
		expect(result.constraints.maxTurns).toBe(50);
		expect(result.constraints.shellTimeoutSec).toBe(60);
	});

	it('applies AddTool then RemoveTool', () => {
		const newTool = new ToolSpec({
			name: 'myCustomTool',
			description: 'A custom tool for testing',
			implementation: new RunShellImpl({})
		});

		const withTool = applyPatches(defaultBlueprint, [
			new AddTool({ tool: newTool })
		]);
		const toolNames = Arr.map(withTool.tools, (t) => t.name);
		expect(toolNames).toContain('myCustomTool');

		const withoutTool = applyPatches(withTool, [
			new RemoveTool({ toolName: 'myCustomTool' })
		]);
		const toolNamesAfter = Arr.map(withoutTool.tools, (t) => t.name);
		expect(toolNamesAfter).not.toContain('myCustomTool');
	});

	it('applies multiple patches in sequence', () => {
		const patches: ReadonlyArray<BlueprintPatch> = [
			new SetSystemPrompt({ prompt: 'Updated prompt' }),
			new SetConstraints({ maxTurns: 25 })
		];
		const result = applyPatches(defaultBlueprint, patches);
		expect(result.systemPrompt).toBe('Updated prompt');
		expect(result.constraints.maxTurns).toBe(25);
	});
});

// =============================================================================
// AgentFactory pipeline (mock)
// =============================================================================

describe('Integration: AgentFactory pipeline', () => {
	it.effect('constructs runtime from blueprint and runs a mock task', () =>
		Effect.gen(function* () {
			const factory = yield* AgentFactory.Service;

			// Construct runtime from blueprint
			const runtime = yield* factory.fromBlueprint(customBlueprint);
			expect(runtime.blueprint.name).toBe('integration-agent');

			// Run task
			const result = yield* runtime.runTask('test instruction');
			expect(result).toBeInstanceOf(AgentRunResult);
			expect(result.exitReason).toBe('completed');
			expect(Option.isSome(result.finalText)).toBe(true);
		}).pipe(Effect.provide(AgentFactory.test()))
	);

	it.effect(
		'supports different blueprints producing different runtimes',
		() =>
			Effect.gen(function* () {
				const factory = yield* AgentFactory.Service;

				const runtime1 = yield* factory.fromBlueprint(customBlueprint);
				const runtime2 = yield* factory.fromBlueprint(
					new AgentBlueprint({
						name: 'other-agent',
						version: '3.0.0'
					})
				);

				expect(runtime1.blueprint.name).toBe('integration-agent');
				expect(runtime2.blueprint.name).toBe('other-agent');
			}).pipe(Effect.provide(AgentFactory.test()))
	);
});

// =============================================================================
// BlueprintStore pipeline (in-memory)
// =============================================================================

describe('Integration: BlueprintStore pipeline', () => {
	it.effect('save + current round-trip', () =>
		Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;

			// Default blueprint before any save
			const initial = yield* store.current;
			expect(initial.name).toBe(defaultBlueprint.name);

			// Save custom blueprint
			yield* store.save(customBlueprint);

			const current = yield* store.current;
			expect(current.name).toBe('integration-agent');
			expect(current.version).toBe('2.0.0');
		}).pipe(Effect.provide(BlueprintStore.test()))
	);

	it.effect('version history tracks saves', () =>
		Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;

			yield* store.save(customBlueprint);
			yield* store.save(
				new AgentBlueprint({
					name: 'v2-agent',
					version: '2.1.0'
				})
			);

			const history = yield* store.history;
			expect(Arr.length(history)).toBe(2);

			// Most recent first — use Arr.get for safe access
			const newest = Arr.get(history, 0);
			const oldest = Arr.get(history, 1);
			expect(Option.map(newest, (h) => h.blueprint.name)).toEqual(
				Option.some('v2-agent')
			);
			expect(Option.map(oldest, (h) => h.blueprint.name)).toEqual(
				Option.some('integration-agent')
			);
		}).pipe(Effect.provide(BlueprintStore.test()))
	);

	it.effect('rollback restores previous version', () =>
		Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;

			yield* store.save(customBlueprint);
			yield* store.save(
				new AgentBlueprint({
					name: 'v2-agent'
				})
			);

			const history = yield* store.history;
			const v1Entry = Arr.get(history, 1);
			const v1Version = Option.match(v1Entry, {
				onNone: () => '',
				onSome: (h) => h.version
			});

			const rolledBack = yield* store.rollback(v1Version);
			expect(rolledBack.name).toBe('integration-agent');

			const current = yield* store.current;
			expect(current.name).toBe('integration-agent');
		}).pipe(Effect.provide(BlueprintStore.test()))
	);
});

// =============================================================================
// Full pipeline: patch → save → factory → run
// =============================================================================

describe('Integration: Full pipeline (patch → save → factory → run)', () => {
	const testLayer = Layer.mergeAll(
		AgentFactory.test(),
		BlueprintStore.test()
	);

	it.effect(
		'applies patches, saves blueprint, constructs runtime, runs task',
		() =>
			Effect.gen(function* () {
				const factory = yield* AgentFactory.Service;
				const store = yield* BlueprintStore.Service;

				// Start with default blueprint
				const initial = yield* store.current;
				expect(initial.orchestration._tag).toBe('SingleLoop');

				// Apply patches
				const patches: ReadonlyArray<BlueprintPatch> = [
					new SetSystemPrompt({
						prompt: 'You are a specialized coding assistant.'
					}),
					new SetConstraints({ maxTurns: 50 })
				];
				const patched = applyPatches(initial, patches);
				expect(patched.systemPrompt).toBe(
					'You are a specialized coding assistant.'
				);
				expect(patched.constraints.maxTurns).toBe(50);

				// Save patched blueprint
				yield* store.save(patched);
				const current = yield* store.current;
				expect(current.systemPrompt).toBe(
					'You are a specialized coding assistant.'
				);

				// Construct runtime from saved blueprint
				const runtime = yield* factory.fromBlueprint(current);
				expect(runtime.blueprint.constraints.maxTurns).toBe(50);

				// Run task
				const result = yield* runtime.runTask('implement feature X');
				expect(result).toBeInstanceOf(AgentRunResult);
				expect(result.exitReason).toBe('completed');
			}).pipe(Effect.provide(testLayer))
	);

	it.effect('JSON round-trip preserves patched blueprint', () =>
		Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;

			// Apply patches and save
			const patched = applyPatches(defaultBlueprint, [
				new SetSystemPrompt({ prompt: 'custom prompt' }),
				new SetConstraints({ maxTurns: 42 })
			]);
			yield* store.save(patched);

			// Encode to JSON
			const json = yield* Schema.encodeEffect(BlueprintJson)(patched);

			// Decode from JSON
			const decoded =
				yield* Schema.decodeUnknownEffect(BlueprintJson)(json);

			expect(decoded.systemPrompt).toBe('custom prompt');
			expect(decoded.constraints.maxTurns).toBe(42);
			expect(decoded.orchestration._tag).toBe('SingleLoop');
		}).pipe(Effect.provide(testLayer))
	);
});
