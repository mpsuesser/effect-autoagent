import { describe, expect, it } from '@effect/vitest';
import { Effect, pipe } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';

import { type AtifStep, AgentInfo } from '../src/Atif.js';

/** Safely get the first step or fail the test. */
const firstStep = (steps: ReadonlyArray<AtifStep>): AtifStep =>
	pipe(steps, Arr.get(0), Option.getOrThrow);
import { ResponseUsage } from '../src/UsageMetrics.js';
import {
	ClaudeAssistantMessage,
	ClaudeResultMessage,
	ClaudeUsageStats,
	ClaudeUserMessage,
	MessageItem,
	ReasoningItem,
	TextBlock,
	ThinkingBlock,
	ToolCallItem,
	ToolCallOutputItem,
	ToolResultBlock,
	ToolUseBlock,
	fromClaudeMessages,
	fromOpenAiItems
} from '../src/TrajectoryConverter.js';

const agentInfo = new AgentInfo({
	name: 'autoagent',
	version: '0.1.0',
	model_name: 'gpt-5.4'
});

const claudeAgentInfo = new AgentInfo({
	name: 'autoagent',
	version: '0.1.0',
	model_name: 'haiku'
});

describe('fromOpenAiItems', () => {
	it.effect('converts empty items to single empty step', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 1000,
				rawResponseUsages: []
			});
			expect(traj.schema_version).toBe('ATIF-v1.6');
			expect(traj.session_id).toBe('sess-1');
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('(empty)');
			expect(traj.steps[0]?.source).toBe('user');
		})
	);

	it.effect('converts message items', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [
					new MessageItem({ type: 'message', text: 'Hello world' })
				],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 500,
				rawResponseUsages: []
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('Hello world');
			expect(traj.steps[0]?.source).toBe('agent');
		})
	);

	it.effect('skips empty message text', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [new MessageItem({ type: 'message', text: '' })],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 0,
				rawResponseUsages: []
			});
			// Should get fallback empty step
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('(empty)');
		})
	);

	it.effect('converts reasoning items', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [
					new ReasoningItem({
						type: 'reasoning',
						summaryTexts: ['Step 1: analyze', 'Step 2: execute']
					})
				],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 0,
				rawResponseUsages: []
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('(thinking)');
			const reasoning = Option.getOrThrow(
				firstStep(traj.steps).reasoning_content
			);
			expect(reasoning).toBe('Step 1: analyze\nStep 2: execute');
		})
	);

	it.effect('pairs tool calls with outputs', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [
					new ToolCallItem({
						type: 'tool_call',
						name: 'run_shell',
						callId: 'tc-1',
						arguments: { command: 'ls' }
					}),
					new ToolCallOutputItem({
						type: 'tool_call_output',
						callId: 'tc-1',
						output: 'file1.txt\nfile2.txt'
					})
				],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 200,
				rawResponseUsages: []
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('Tool: run_shell');

			const step0 = firstStep(traj.steps);
			const calls = Option.getOrThrow(step0.tool_calls);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.function_name).toBe('run_shell');

			const obs = Option.getOrThrow(step0.observation);
			expect(obs.results[0]?.content).toBe('file1.txt\nfile2.txt');
		})
	);

	it.effect('handles trailing tool call without output', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [
					new ToolCallItem({
						type: 'tool_call',
						name: 'run_shell',
						callId: 'tc-orphan',
						arguments: { command: 'exit' }
					})
				],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 0,
				rawResponseUsages: []
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('Tool: run_shell');
			expect(Option.isNone(firstStep(traj.steps).observation)).toBe(true);
		})
	);

	it.effect('accumulates usage metrics', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [new MessageItem({ type: 'message', text: 'done' })],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 3000,
				rawResponseUsages: [
					new ResponseUsage({
						input_tokens: Option.some(100),
						output_tokens: Option.some(50),
						cache_read_input_tokens: Option.some(10)
					}),
					new ResponseUsage({
						input_tokens: Option.some(200),
						output_tokens: Option.some(75),
						cache_read_input_tokens: Option.none()
					})
				]
			});

			const metrics = Option.getOrThrow(traj.final_metrics);
			expect(Option.getOrThrow(metrics.total_prompt_tokens)).toBe(300);
			expect(Option.getOrThrow(metrics.total_completion_tokens)).toBe(
				125
			);
			expect(Option.getOrThrow(metrics.total_cached_tokens)).toBe(10);
			expect(metrics.extra?.['duration_ms']).toBe(3000);
			expect(metrics.extra?.['num_turns']).toBe(2);
		})
	);

	it.effect('handles mixed item sequence', () =>
		Effect.gen(function* () {
			const traj = yield* fromOpenAiItems({
				items: [
					new MessageItem({
						type: 'message',
						text: 'Let me check'
					}),
					new ReasoningItem({
						type: 'reasoning',
						summaryTexts: ['thinking about approach']
					}),
					new ToolCallItem({
						type: 'tool_call',
						name: 'run_shell',
						callId: 'tc-1',
						arguments: { command: 'ls' }
					}),
					new ToolCallOutputItem({
						type: 'tool_call_output',
						callId: 'tc-1',
						output: 'results'
					}),
					new MessageItem({
						type: 'message',
						text: 'Task complete'
					})
				],
				modelName: 'gpt-5.4',
				sessionId: 'sess-1',
				agentInfo,
				durationMs: 5000,
				rawResponseUsages: []
			});
			expect(traj.steps).toHaveLength(4);
			expect(traj.steps[0]?.message).toBe('Let me check');
			expect(traj.steps[1]?.message).toBe('(thinking)');
			expect(traj.steps[2]?.message).toBe('Tool: run_shell');
			expect(traj.steps[3]?.message).toBe('Task complete');
		})
	);
});

describe('fromClaudeMessages', () => {
	it.effect('converts empty messages to single empty step', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [],
				agentInfo: claudeAgentInfo
			});
			expect(traj.schema_version).toBe('ATIF-v1.2');
			expect(traj.session_id).toBe('unknown');
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('(empty)');
		})
	);

	it.effect('converts user text messages', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [
					new ClaudeUserMessage({
						role: 'user',
						content: 'Do the task'
					})
				],
				agentInfo: claudeAgentInfo
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.source).toBe('user');
			expect(traj.steps[0]?.message).toBe('Do the task');
		})
	);

	it.effect('converts assistant text blocks', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [
					new ClaudeAssistantMessage({
						role: 'assistant',
						content: [
							new TextBlock({
								type: 'text',
								text: 'I will help'
							})
						],
						model: Option.some('haiku')
					})
				],
				agentInfo: claudeAgentInfo
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('I will help');
			expect(Option.getOrThrow(firstStep(traj.steps).model_name)).toBe(
				'haiku'
			);
		})
	);

	it.effect('converts thinking blocks', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [
					new ClaudeAssistantMessage({
						role: 'assistant',
						content: [
							new ThinkingBlock({
								type: 'thinking',
								thinking: 'Let me analyze this'
							})
						],
						model: Option.none()
					})
				],
				agentInfo: claudeAgentInfo
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('(thinking)');
			expect(
				Option.getOrThrow(firstStep(traj.steps).reasoning_content)
			).toBe('Let me analyze this');
		})
	);

	it.effect('pairs tool uses with tool results', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [
					new ClaudeAssistantMessage({
						role: 'assistant',
						content: [
							new ToolUseBlock({
								type: 'tool_use',
								id: 'tu-1',
								name: 'bash',
								input: { command: 'ls' }
							})
						],
						model: Option.none()
					}),
					new ClaudeUserMessage({
						role: 'user',
						content: [
							new ToolResultBlock({
								type: 'tool_result',
								tool_use_id: 'tu-1',
								content: 'file1.txt'
							})
						]
					})
				],
				agentInfo: claudeAgentInfo
			});

			// Tool use + result = one step
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('Tool: bash');

			const step0 = firstStep(traj.steps);
			const calls = Option.getOrThrow(step0.tool_calls);
			expect(calls[0]?.function_name).toBe('bash');

			const obs = Option.getOrThrow(step0.observation);
			expect(obs.results[0]?.content).toBe('file1.txt');
		})
	);

	it.effect('extracts metrics from result message', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [
					new ClaudeAssistantMessage({
						role: 'assistant',
						content: [
							new TextBlock({
								type: 'text',
								text: 'Done'
							})
						],
						model: Option.none()
					}),
					new ClaudeResultMessage({
						role: 'result',
						session_id: Option.some('session-abc'),
						total_cost_usd: Option.some(0.0042),
						duration_ms: Option.some(15000),
						num_turns: Option.some(5),
						usage: Option.some(
							new ClaudeUsageStats({
								input_tokens: Option.some(500),
								output_tokens: Option.some(200),
								cache_read_input_tokens: Option.some(50)
							})
						)
					})
				],
				agentInfo: claudeAgentInfo
			});

			expect(traj.session_id).toBe('session-abc');
			const metrics = Option.getOrThrow(traj.final_metrics);
			expect(Option.getOrThrow(metrics.total_prompt_tokens)).toBe(500);
			expect(Option.getOrThrow(metrics.total_completion_tokens)).toBe(
				200
			);
			expect(Option.getOrThrow(metrics.total_cached_tokens)).toBe(50);
			expect(Option.getOrThrow(metrics.total_cost_usd)).toBe(0.0042);
			expect(metrics.extra?.['duration_ms']).toBe(15000);
			expect(metrics.extra?.['num_turns']).toBe(5);
		})
	);

	it.effect('handles unpaired tool uses', () =>
		Effect.gen(function* () {
			const traj = yield* fromClaudeMessages({
				messages: [
					new ClaudeAssistantMessage({
						role: 'assistant',
						content: [
							new ToolUseBlock({
								type: 'tool_use',
								id: 'tu-orphan',
								name: 'bash',
								input: { command: 'exit' }
							})
						],
						model: Option.none()
					})
				],
				agentInfo: claudeAgentInfo
			});
			expect(traj.steps).toHaveLength(1);
			expect(traj.steps[0]?.message).toBe('Tool: bash');
			expect(Option.isNone(firstStep(traj.steps).observation)).toBe(true);
		})
	);
});
