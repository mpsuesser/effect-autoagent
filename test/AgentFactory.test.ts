import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Option from 'effect/Option';

import { AgentBlueprint } from '../src/AgentBlueprint.js';
import { AgentFactory, AgentFactoryError } from '../src/AgentFactory.js';
import { AgentRunResult } from '../src/AgentRunResult.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const testBlueprint = new AgentBlueprint({
	name: 'test-agent',
	version: '1.0.0',
	description: 'A test blueprint'
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentFactory', () => {
	describe('AgentFactoryError', () => {
		it('constructs with message', () => {
			const error = new AgentFactoryError({
				message: 'toolkit build failed'
			});
			expect(error._tag).toBe('AgentFactoryError');
			expect(error.message).toBe('toolkit build failed');
		});

		it('constructs with message and cause', () => {
			const cause = new Error('underlying issue');
			const error = new AgentFactoryError({
				message: 'toolkit build failed',
				cause
			});
			expect(error._tag).toBe('AgentFactoryError');
			expect(error.message).toBe('toolkit build failed');
			expect(error.cause).toBe(cause);
		});
	});

	describe('test layer — fromBlueprint', () => {
		it.effect('returns an AgentRuntime with the blueprint attached', () =>
			Effect.gen(function* () {
				const factory = yield* AgentFactory.Service;
				const runtime = yield* factory.fromBlueprint(testBlueprint);

				expect(runtime.blueprint).toBe(testBlueprint);
				expect(runtime.blueprint.name).toBe('test-agent');
				expect(runtime.blueprint.version).toBe('1.0.0');
				expect(typeof runtime.runTask).toBe('function');
			}).pipe(Effect.provide(AgentFactory.test()))
		);
	});

	describe('test layer — runTask', () => {
		it.effect(
			'returns a mock AgentRunResult with exitReason completed',
			() =>
				Effect.gen(function* () {
					const factory = yield* AgentFactory.Service;
					const runtime = yield* factory.fromBlueprint(testBlueprint);
					const result = yield* runtime.runTask('do something');

					expect(result).toBeInstanceOf(AgentRunResult);
					expect(result.exitReason).toBe('completed');
					expect(Option.isSome(result.finalText)).toBe(true);
					expect(Option.getOrElse(result.finalText, () => '')).toBe(
						'mock result'
					);
					expect(result.metrics.inputTokens).toBe(0);
					expect(result.metrics.outputTokens).toBe(0);
					expect(result.metrics.durationMs).toBe(0);
					expect(result.metrics.numTurns).toBe(0);
				}).pipe(Effect.provide(AgentFactory.test()))
		);

		it.effect(
			'mock result has a valid trajectory with agent info from blueprint',
			() =>
				Effect.gen(function* () {
					const factory = yield* AgentFactory.Service;
					const runtime = yield* factory.fromBlueprint(testBlueprint);
					const result = yield* runtime.runTask('test instruction');

					expect(result.trajectory.agent.name).toBe('test-agent');
					expect(result.trajectory.agent.version).toBe('1.0.0');
					expect(result.trajectory.session_id).toBe('test-session');
					expect(result.trajectory.steps.length).toBeGreaterThan(0);
				}).pipe(Effect.provide(AgentFactory.test()))
		);
	});

	describe('test layer — custom fromBlueprint handler', () => {
		it.effect('uses provided custom handler when given', () =>
			Effect.gen(function* () {
				const factory = yield* AgentFactory.Service;
				const runtime = yield* factory.fromBlueprint(testBlueprint);

				expect(runtime.blueprint.name).toBe('custom-agent');
			}).pipe(
				Effect.provide(
					AgentFactory.test({
						fromBlueprint: (blueprint) => ({
							blueprint: new AgentBlueprint({
								name: 'custom-agent',
								version: blueprint.version
							}),
							runTask: () =>
								Effect.die(
									'custom handler — runTask not expected'
								)
						})
					})
				)
			)
		);
	});
});
