import { describe, expect, it } from '@effect/vitest';

import {
	AgentApi,
	AgentApiGroup,
	AgentHttpError,
	RunTaskMetrics,
	RunTaskPayload,
	RunTaskResponse
} from '../src/AgentHttpApi.js';

describe('AgentHttpError', () => {
	it('constructs with message', () => {
		const error = new AgentHttpError({ message: 'something went wrong' });
		expect(error._tag).toBe('AgentHttpError');
		expect(error.message).toBe('something went wrong');
	});
});

describe('RunTaskMetrics', () => {
	it('constructs with all fields', () => {
		const metrics = new RunTaskMetrics({
			inputTokens: 100,
			outputTokens: 200,
			durationMs: 1500,
			numTurns: 3
		});
		expect(metrics.inputTokens).toBe(100);
		expect(metrics.outputTokens).toBe(200);
		expect(metrics.durationMs).toBe(1500);
		expect(metrics.numTurns).toBe(3);
	});
});

describe('RunTaskResponse', () => {
	it('constructs with all fields', () => {
		const response = new RunTaskResponse({
			exitReason: 'completed',
			finalText: 'task done',
			metrics: new RunTaskMetrics({
				inputTokens: 50,
				outputTokens: 75,
				durationMs: 800,
				numTurns: 2
			})
		});
		expect(response.exitReason).toBe('completed');
		expect(response.finalText).toBe('task done');
		expect(response.metrics.inputTokens).toBe(50);
		expect(response.metrics.outputTokens).toBe(75);
		expect(response.metrics.durationMs).toBe(800);
		expect(response.metrics.numTurns).toBe(2);
	});
});

describe('RunTaskPayload', () => {
	it('constructs with instruction', () => {
		const payload = new RunTaskPayload({
			instruction: 'Write hello world'
		});
		expect(payload.instruction).toBe('Write hello world');
	});
});

describe('AgentApiGroup', () => {
	it('is defined', () => {
		expect(AgentApiGroup).toBeDefined();
	});
});

describe('AgentApi', () => {
	it('is defined', () => {
		expect(AgentApi).toBeDefined();
	});
});
