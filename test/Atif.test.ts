import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import {
	AgentInfo,
	FinalMetrics,
	Observation,
	ObservationResult,
	StepBuilder,
	ToolCall,
	buildTrajectory,
	ensureNonEmpty,
	stepSourceLabel
} from '../src/Atif.js';

describe('StepBuilder', () => {
	it('auto-increments step IDs', () => {
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const s1 = builder.step('agent', 'hello');
		const s2 = builder.step('user', 'world');
		expect(s1.step_id).toBe(1);
		expect(s2.step_id).toBe(2);
	});

	it('stamps timestamp on every step', () => {
		const ts = '2025-06-15T12:00:00Z';
		const builder = new StepBuilder(ts);
		const step = builder.step('agent', 'msg');
		expect(step.timestamp).toBe(ts);
	});

	it('creates step with tool calls and observation', () => {
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const toolCall = new ToolCall({
			tool_call_id: 'tc-1',
			function_name: 'run_shell',
			arguments: { command: 'ls' }
		});
		const obs = new Observation({
			results: [
				new ObservationResult({
					source_call_id: 'tc-1',
					content: 'file1.txt'
				})
			]
		});
		const step = builder.step('agent', 'Tool: run_shell', {
			toolCalls: [toolCall],
			observation: obs
		});
		expect(Option.isSome(step.tool_calls)).toBe(true);
		expect(Option.isSome(step.observation)).toBe(true);
	});

	it('creates step with reasoning content', () => {
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const step = builder.step('agent', '(thinking)', {
			reasoningContent: 'I should try ls first',
			modelName: 'gpt-5.4'
		});
		expect(Option.getOrThrow(step.reasoning_content)).toBe(
			'I should try ls first'
		);
		expect(Option.getOrThrow(step.model_name)).toBe('gpt-5.4');
	});

	it('omits optional fields when not provided', () => {
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const step = builder.step('agent', 'hello');
		expect(Option.isNone(step.model_name)).toBe(true);
		expect(Option.isNone(step.reasoning_content)).toBe(true);
		expect(Option.isNone(step.tool_calls)).toBe(true);
		expect(Option.isNone(step.observation)).toBe(true);
	});
});

describe('ensureNonEmpty', () => {
	it('returns steps unchanged when non-empty', () => {
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const steps = [builder.step('agent', 'hello')];
		const result = ensureNonEmpty(steps, builder);
		expect(result).toHaveLength(1);
		expect(result[0]?.message).toBe('hello');
	});

	it('inserts placeholder when empty', () => {
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const result = ensureNonEmpty([], builder);
		expect(result).toHaveLength(1);
		expect(result[0]?.source).toBe('user');
		expect(result[0]?.message).toBe('(empty)');
	});
});

describe('stepSourceLabel', () => {
	it('returns agent for agent', () => {
		expect(stepSourceLabel('agent')).toBe('agent');
	});

	it('returns user for user', () => {
		expect(stepSourceLabel('user')).toBe('user');
	});
});

describe('buildTrajectory', () => {
	it('constructs a complete trajectory', () => {
		const info = new AgentInfo({
			name: 'autoagent',
			version: '0.1.0',
			model_name: 'gpt-5.4'
		});
		const builder = new StepBuilder('2025-01-01T00:00:00Z');
		const steps = [builder.step('agent', 'done')];
		const metrics = new FinalMetrics({
			total_prompt_tokens: Option.some(100),
			total_completion_tokens: Option.some(50),
			total_cached_tokens: Option.none(),
			total_cost_usd: Option.none(),
			total_steps: 1
		});

		const traj = buildTrajectory({
			schemaVersion: 'ATIF-v1.6',
			sessionId: 'sess-1',
			agentInfo: info,
			steps,
			finalMetrics: Option.some(metrics)
		});

		expect(traj.schema_version).toBe('ATIF-v1.6');
		expect(traj.session_id).toBe('sess-1');
		expect(traj.agent.name).toBe('autoagent');
		expect(traj.steps).toHaveLength(1);
		expect(Option.isSome(traj.final_metrics)).toBe(true);
	});
});
