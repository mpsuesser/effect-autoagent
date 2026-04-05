import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Option from 'effect/Option';
import * as Prompt from 'effect/unstable/ai/Prompt';

import { AgentInfo } from '../src/Atif.js';
import { fromEffectAiHistory } from '../src/EffectAiConverter.js';
import { UsageSnapshot } from '../src/UsageMetrics.js';

const agentInfo = new AgentInfo({
	name: 'test-agent',
	version: '0.1.0',
	model_name: 'gpt-test'
});

const baseInput = {
	agentInfo,
	sessionId: 'test-session',
	modelName: 'gpt-test',
	usage: new UsageSnapshot({
		inputTokens: 100,
		outputTokens: 50,
		cachedTokens: 10
	}),
	durationMs: 500,
	numTurns: 1
};

describe('fromEffectAiHistory', () => {
	it.effect('produces a trajectory from empty history', () =>
		Effect.gen(function* () {
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history: Prompt.empty
			});
			expect(trajectory.schema_version).toBe('ATIF-v1.6');
			expect(trajectory.session_id).toBe('test-session');
			expect(trajectory.agent.name).toBe('test-agent');
			// Empty history produces a single placeholder step
			expect(trajectory.steps.length).toBe(1);
			expect(trajectory.steps[0]?.message).toBe('(empty)');
		})
	);

	it.effect('converts a user text message', () =>
		Effect.gen(function* () {
			const history = Prompt.make('Hello, solve this task');
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history
			});
			// Should have at least one user step
			const userSteps = trajectory.steps.filter(
				(s) => s.source === 'user'
			);
			expect(userSteps.length).toBeGreaterThanOrEqual(1);
			expect(userSteps[0]?.message).toContain('Hello, solve this task');
		})
	);

	it.effect('converts an assistant text response', () =>
		Effect.gen(function* () {
			const history = Prompt.make([
				{
					role: 'user',
					content: [{ type: 'text', text: 'What is 2+2?' }]
				},
				{
					role: 'assistant',
					content: [{ type: 'text', text: 'The answer is 4.' }]
				}
			]);
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history
			});
			const agentSteps = trajectory.steps.filter(
				(s) => s.source === 'agent'
			);
			expect(agentSteps.length).toBeGreaterThanOrEqual(1);
			expect(agentSteps[0]?.message).toContain('The answer is 4');
		})
	);

	it.effect('converts tool call + tool result pairs', () =>
		Effect.gen(function* () {
			const history = Prompt.make([
				{
					role: 'user',
					content: [{ type: 'text', text: 'List files' }]
				},
				{
					role: 'assistant',
					content: [
						{
							type: 'tool-call',
							id: 'call-1',
							name: 'run_shell',
							params: { command: 'ls' },
							providerExecuted: false
						}
					]
				},
				{
					role: 'tool',
					content: [
						{
							type: 'tool-result',
							id: 'call-1',
							name: 'run_shell',
							isFailure: false,
							result: 'file1.txt\nfile2.txt'
						}
					]
				}
			]);
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history,
				numTurns: 2
			});

			// Should have a paired tool step with observation
			const toolSteps = trajectory.steps.filter((s) =>
				Option.isSome(s.observation)
			);
			expect(toolSteps.length).toBe(1);

			Option.match(Option.fromNullishOr(toolSteps[0]), {
				onNone: () => {
					expect.unreachable('Expected a tool step with observation');
				},
				onSome: (step) => {
					const calls = Option.getOrElse(step.tool_calls, () => []);
					expect(calls.length).toBe(1);
				}
			});
		})
	);

	it.effect('skips system messages', () =>
		Effect.gen(function* () {
			const history = Prompt.make([
				{
					role: 'system',
					content: 'You are a helpful assistant'
				},
				{
					role: 'user',
					content: [{ type: 'text', text: 'Hello' }]
				}
			]);
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history
			});
			// No system step should appear — only user step
			const systemSteps = trajectory.steps.filter(
				(s) => s.source === 'system'
			);
			expect(systemSteps.length).toBe(0);
		})
	);

	it.effect('records final metrics from input', () =>
		Effect.gen(function* () {
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history: Prompt.make('test'),
				costUsd: 0.05
			});
			expect(Option.isSome(trajectory.final_metrics)).toBe(true);
			Option.match(trajectory.final_metrics, {
				onNone: () => {
					expect.unreachable('expected final_metrics to be Some');
				},
				onSome: (fm) => {
					expect(
						Option.getOrElse(fm.total_prompt_tokens, () => 0)
					).toBe(100);
					expect(
						Option.getOrElse(fm.total_completion_tokens, () => 0)
					).toBe(50);
					expect(
						Option.getOrElse(fm.total_cached_tokens, () => 0)
					).toBe(10);
					expect(Option.getOrElse(fm.total_cost_usd, () => 0)).toBe(
						0.05
					);
				}
			});
		})
	);

	it.effect('handles unpaired tool calls', () =>
		Effect.gen(function* () {
			const history = Prompt.make([
				{
					role: 'user',
					content: [{ type: 'text', text: 'Do something' }]
				},
				{
					role: 'assistant',
					content: [
						{
							type: 'tool-call',
							id: 'call-orphan',
							name: 'run_shell',
							params: { command: 'echo hi' },
							providerExecuted: false
						}
					]
				}
				// No tool result follows
			]);
			const trajectory = yield* fromEffectAiHistory({
				...baseInput,
				history
			});
			// Should still produce steps — the tool call appears without observation
			const toolSteps = trajectory.steps.filter((s) =>
				Option.isSome(s.tool_calls)
			);
			expect(toolSteps.length).toBeGreaterThanOrEqual(1);
			// The last tool step should have no observation (unpaired)
			expect(toolSteps.length).toBeGreaterThan(0);
			Option.match(
				Option.fromNullishOr(toolSteps[toolSteps.length - 1]),
				{
					onNone: () => {
						expect.unreachable('Expected at least one tool step');
					},
					onSome: (lastToolStep) => {
						expect(Option.isNone(lastToolStep.observation)).toBe(
							true
						);
					}
				}
			);
		})
	);
});
