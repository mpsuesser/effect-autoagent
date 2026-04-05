import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import { AgentRunResult } from '../src/AgentRunResult.js';
import { AgentInfo, AtifTrajectory } from '../src/Atif.js';
import { AgentMetrics } from '../src/Metrics.js';

const makeTrajectory = () =>
	new AtifTrajectory({
		schema_version: 'ATIF-v1.6',
		session_id: 'test-session',
		agent: new AgentInfo({
			name: 'test',
			version: '0.1.0',
			model_name: 'gpt-5.4'
		}),
		steps: [],
		final_metrics: Option.none()
	});

const makeMetrics = () =>
	new AgentMetrics({
		inputTokens: 100,
		outputTokens: 50,
		cachedTokens: 0,
		costUsd: Option.none(),
		durationMs: 1000,
		numTurns: 3
	});

describe('AgentRunResult', () => {
	it('isCompleted returns true for completed runs', () => {
		const result = new AgentRunResult({
			trajectory: makeTrajectory(),
			metrics: makeMetrics(),
			exitReason: 'completed',
			finalText: Option.some('Done!')
		});
		expect(result.isCompleted).toBe(true);
	});

	it('isCompleted returns false for max_turns', () => {
		const result = new AgentRunResult({
			trajectory: makeTrajectory(),
			metrics: makeMetrics(),
			exitReason: 'max_turns',
			finalText: Option.none()
		});
		expect(result.isCompleted).toBe(false);
	});

	it('isCompleted returns false for timeout', () => {
		const result = new AgentRunResult({
			trajectory: makeTrajectory(),
			metrics: makeMetrics(),
			exitReason: 'timeout',
			finalText: Option.none()
		});
		expect(result.isCompleted).toBe(false);
	});

	it('finalTextOrReason returns text when present', () => {
		const result = new AgentRunResult({
			trajectory: makeTrajectory(),
			metrics: makeMetrics(),
			exitReason: 'completed',
			finalText: Option.some('The answer is 42')
		});
		expect(result.finalTextOrReason).toBe('The answer is 42');
	});

	it('finalTextOrReason returns reason when no text', () => {
		const result = new AgentRunResult({
			trajectory: makeTrajectory(),
			metrics: makeMetrics(),
			exitReason: 'max_turns',
			finalText: Option.none()
		});
		expect(result.finalTextOrReason).toBe('(agent exited: max_turns)');
	});

	it('finalTextOrReason returns reason for budget_exceeded', () => {
		const result = new AgentRunResult({
			trajectory: makeTrajectory(),
			metrics: makeMetrics(),
			exitReason: 'budget_exceeded',
			finalText: Option.none()
		});
		expect(result.finalTextOrReason).toBe(
			'(agent exited: budget_exceeded)'
		);
	});
});
