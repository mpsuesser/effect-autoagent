import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { AgentBlueprint, defaultBlueprint } from '../src/AgentBlueprint.js';
import { BlueprintStore, BlueprintStoreError } from '../src/BlueprintStore.js';

describe('BlueprintStore', () => {
	describe('BlueprintStoreError', () => {
		it('constructs with operation and message', () => {
			const err = new BlueprintStoreError({
				operation: 'read',
				message: 'disk failure'
			});
			expect(err._tag).toBe('BlueprintStoreError');
			expect(err.operation).toBe('read');
			expect(err.message).toBe('disk failure');
		});

		it('constructs with optional cause', () => {
			const cause = new TypeError('bad type');
			const err = new BlueprintStoreError({
				operation: 'decode',
				message: 'parse failed',
				cause
			});
			expect(err.cause).toBe(cause);
		});
	});

	describe('test layer', () => {
		it.effect('current returns defaultBlueprint when nothing saved', () =>
			Effect.gen(function* () {
				const store = yield* BlueprintStore.Service;
				const bp = yield* store.current;
				expect(bp.name).toBe('autoagent');
				expect(bp).toEqual(defaultBlueprint);
			}).pipe(Effect.provide(BlueprintStore.test()))
		);

		it.effect('current returns custom initial blueprint', () =>
			Effect.gen(function* () {
				const store = yield* BlueprintStore.Service;
				const bp = yield* store.current;
				expect(bp.systemPrompt).toBe('custom prompt');
			}).pipe(
				Effect.provide(
					BlueprintStore.test(
						new AgentBlueprint({
							systemPrompt: 'custom prompt'
						})
					)
				)
			)
		);

		it.effect('save then current returns the saved blueprint', () =>
			Effect.gen(function* () {
				const store = yield* BlueprintStore.Service;
				const customBp = new AgentBlueprint({
					systemPrompt: 'updated prompt',
					description: 'test save'
				});
				yield* store.save(customBp);
				const bp = yield* store.current;
				expect(bp.systemPrompt).toBe('updated prompt');
				expect(bp.description).toBe('test save');
			}).pipe(Effect.provide(BlueprintStore.test()))
		);

		it.effect(
			'save twice then history returns two entries newest first',
			() =>
				Effect.gen(function* () {
					const store = yield* BlueprintStore.Service;

					const bp1 = new AgentBlueprint({
						description: 'first'
					});
					const bp2 = new AgentBlueprint({
						description: 'second'
					});

					yield* store.save(bp1);
					yield* store.save(bp2);

					const entries = yield* store.history;
					expect(entries).toHaveLength(2);

					// Newest first (unshift order)
					expect(entries[0]?.blueprint.description).toBe('second');
					expect(entries[1]?.blueprint.description).toBe('first');

					// Each entry has a version string
					expect(entries[0]?.version).toMatch(/^v-\d+$/);
					expect(entries[1]?.version).toMatch(/^v-\d+$/);
				}).pipe(Effect.provide(BlueprintStore.test()))
		);

		it.effect('history is empty when nothing saved', () =>
			Effect.gen(function* () {
				const store = yield* BlueprintStore.Service;
				const entries = yield* store.history;
				expect(entries).toHaveLength(0);
			}).pipe(Effect.provide(BlueprintStore.test()))
		);

		it.effect('rollback restores a previous version', () =>
			Effect.gen(function* () {
				const store = yield* BlueprintStore.Service;

				const bp1 = new AgentBlueprint({
					description: 'original'
				});
				const bp2 = new AgentBlueprint({
					description: 'modified'
				});

				yield* store.save(bp1);
				yield* store.save(bp2);

				// Current should be the second save
				const currentBefore = yield* store.current;
				expect(currentBefore.description).toBe('modified');

				// Get the version of the first save (index 1 — newest first)
				const entries = yield* store.history;
				const firstEntry = entries[1];
				expect(firstEntry).toBeDefined();
				if (!firstEntry) return; // unreachable — satisfies type narrowing

				// Rollback to first version
				const rolled = yield* store.rollback(firstEntry.version);
				expect(rolled.description).toBe('original');

				// Current should now be the rolled-back version
				const currentAfter = yield* store.current;
				expect(currentAfter.description).toBe('original');
			}).pipe(Effect.provide(BlueprintStore.test()))
		);

		it.effect('rollback to non-existent version is a defect', () =>
			Effect.gen(function* () {
				const store = yield* BlueprintStore.Service;
				const exit = yield* Effect.exit(
					store.rollback('v-nonexistent')
				);
				expect(exit._tag).toBe('Failure');
			}).pipe(Effect.provide(BlueprintStore.test()))
		);
	});
});
