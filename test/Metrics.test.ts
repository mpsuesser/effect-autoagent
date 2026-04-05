import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import {
	AgentInfo,
	AtifTrajectory,
	FinalMetrics,
	StepBuilder
} from '../src/Atif.js';
import {
	AgentMetrics,
	extractMetrics,
	formatSummary,
	trajectoryToJson,
	trajectoryToPlainObject
} from '../src/Metrics.js';

const makeTrajectory = (
	metricsOverride?: Partial<{
		promptTokens: number;
		completionTokens: number;
		cachedTokens: number;
		costUsd: number;
		durationMs: number;
		numTurns: number;
	}>
): AtifTrajectory => {
	const builder = new StepBuilder('2025-01-01T00:00:00Z');
	return new AtifTrajectory({
		schema_version: 'ATIF-v1.6',
		session_id: 'sess-test',
		agent: new AgentInfo({
			name: 'autoagent',
			version: '0.1.0',
			model_name: 'gpt-5.4'
		}),
		steps: [builder.step('agent', 'hello')],
		final_metrics: Option.some(
			new FinalMetrics({
				total_prompt_tokens: Option.some(
					metricsOverride?.promptTokens ?? 100
				),
				total_completion_tokens: Option.some(
					metricsOverride?.completionTokens ?? 50
				),
				total_cached_tokens: Option.some(
					metricsOverride?.cachedTokens ?? 10
				),
				total_cost_usd:
					metricsOverride?.costUsd !== undefined
						? Option.some(metricsOverride.costUsd)
						: Option.none(),
				total_steps: 1,
				extra: {
					duration_ms: metricsOverride?.durationMs ?? 1000,
					num_turns: metricsOverride?.numTurns ?? 3
				}
			})
		)
	});
};

describe('extractMetrics', () => {
	it('extracts metrics from trajectory', () => {
		const traj = makeTrajectory();
		const result = extractMetrics(traj);
		expect(Option.isSome(result)).toBe(true);
		Option.match(result, {
			onNone: () => expect.unreachable(),
			onSome: (metrics) => {
				expect(metrics.inputTokens).toBe(100);
				expect(metrics.outputTokens).toBe(50);
				expect(metrics.cachedTokens).toBe(10);
				expect(metrics.durationMs).toBe(1000);
				expect(metrics.numTurns).toBe(3);
				expect(Option.isNone(metrics.costUsd)).toBe(true);
			}
		});
	});

	it('returns none when no metrics', () => {
		const traj = new AtifTrajectory({
			schema_version: 'ATIF-v1.6',
			session_id: 'sess-test',
			agent: new AgentInfo({
				name: 'autoagent',
				version: '0.1.0',
				model_name: 'gpt-5.4'
			}),
			steps: [],
			final_metrics: Option.none()
		});
		expect(Option.isNone(extractMetrics(traj))).toBe(true);
	});
});

const TrajectoryJson = Schema.Record(Schema.String, Schema.Unknown);
const decodeTrajectoryJson = Schema.decodeUnknownSync(
	Schema.fromJsonString(TrajectoryJson)
);

describe('trajectoryToPlainObject', () => {
	it('converts to a JSON-friendly plain object', () => {
		const traj = makeTrajectory();
		const obj = trajectoryToPlainObject(traj);
		expect(obj['schema_version']).toBe('ATIF-v1.6');
		expect(obj['session_id']).toBe('sess-test');

		expect(obj).toHaveProperty('agent');
		expect(obj['agent']).toMatchObject({ name: 'autoagent' });

		const steps = obj['steps'];
		expect(Array.isArray(steps)).toBe(true);
		expect(steps).toHaveLength(1);
	});
});

describe('trajectoryToJson', () => {
	it('produces valid JSON string', () => {
		const traj = makeTrajectory();
		const json = trajectoryToJson(traj);
		const parsed = decodeTrajectoryJson(json);
		expect(parsed['schema_version']).toBe('ATIF-v1.6');
	});
});

describe('formatSummary', () => {
	it('formats summary without cost', () => {
		const metrics = new AgentMetrics({
			inputTokens: 100,
			outputTokens: 50,
			cachedTokens: 10,
			costUsd: Option.none(),
			durationMs: 1500,
			numTurns: 5
		});
		expect(formatSummary(metrics)).toBe(
			'turns=5 duration_ms=1500 input=100 output=50'
		);
	});

	it('formats summary with cost', () => {
		const metrics = new AgentMetrics({
			inputTokens: 500,
			outputTokens: 200,
			cachedTokens: 50,
			costUsd: Option.some(0.0042),
			durationMs: 15000,
			numTurns: 8
		});
		const summary = formatSummary(metrics);
		expect(summary).toContain('cost_usd=0.0042');
		expect(summary).toContain('turns=8');
		expect(summary).toContain('duration_ms=15000');
		expect(summary).toContain('input=500');
		expect(summary).toContain('output=200');
	});
});
