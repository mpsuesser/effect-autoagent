/**
 * Effect AI conversation history to ATIF trajectory converter.
 *
 * Converts the native Effect AI `Prompt.Prompt` (conversation history)
 * produced by the `Chat` module into the ATIF interchange format. This
 * is the Effect-native path — use the existing `fromOpenAiItems` and
 * `fromClaudeMessages` when wrapping raw SDK output directly.
 *
 * @since 0.2.0
 */
import { Effect, pipe, Result } from 'effect';
import * as Arr from 'effect/Array';
import * as DateTime from 'effect/DateTime';
import * as Option from 'effect/Option';
import * as P from 'effect/Predicate';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';
import type * as Prompt from 'effect/unstable/ai/Prompt';

import {
	type AgentInfo,
	type AtifStep,
	FinalMetrics,
	Observation,
	ObservationResult,
	StepBuilder,
	ToolCall,
	buildTrajectory,
	ensureNonEmpty
} from './Atif.js';
import { type UsageSnapshot } from './UsageMetrics.js';

// =============================================================================
// JSON encoding for unknown values (replaces direct JSON.stringify)
// =============================================================================

const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Serialize unknown content to a string at the boundary.
 */
const unknownToString = (value: unknown): string => {
	if (P.isString(value)) return value;
	if (P.isNull(value) || P.isUndefined(value)) return '';
	return encodeUnknownJson(value);
};

/**
 * Convert a ToolCallPart to an ATIF ToolCall.
 */
const toAtifToolCall = (tc: Prompt.ToolCallPart): ToolCall =>
	new ToolCall({
		tool_call_id: tc.id,
		function_name: tc.name,
		arguments: tc.params
	});

/**
 * Build an ATIF step for a paired tool call + result.
 */
const buildPairedToolStep = (
	builder: StepBuilder,
	pending: Prompt.ToolCallPart,
	result: Prompt.ToolResultPart
): AtifStep =>
	builder.step('agent', `Result: ${pending.name}`, {
		toolCalls: [toAtifToolCall(pending)],
		observation: new Observation({
			results: [
				new ObservationResult({
					source_call_id: result.id,
					content: unknownToString(result.result)
				})
			]
		})
	});

/**
 * Build an ATIF step for an unpaired tool call (no result received).
 */
const buildUnpairedToolStep = (
	builder: StepBuilder,
	pending: Prompt.ToolCallPart
): AtifStep =>
	builder.step('agent', `Tool: ${pending.name}`, {
		toolCalls: [toAtifToolCall(pending)]
	});

// =============================================================================
// Type guards for Prompt parts
// =============================================================================

/** Narrows a Prompt part to TextPart. */
const isTextPart = (
	part: Prompt.Part | Prompt.UserMessagePart | Prompt.AssistantMessagePart
): part is Prompt.TextPart => part.type === 'text';

/** Narrows a Prompt part to ReasoningPart. */
const isReasoningPart = (
	part: Prompt.Part | Prompt.AssistantMessagePart
): part is Prompt.ReasoningPart => part.type === 'reasoning';

/** Narrows a Prompt part to ToolCallPart. */
const isToolCallPart = (
	part: Prompt.Part | Prompt.AssistantMessagePart
): part is Prompt.ToolCallPart => part.type === 'tool-call';

/** Narrows a Prompt part to ToolResultPart. */
const isToolResultPart = (
	part: Prompt.Part | Prompt.ToolMessagePart
): part is Prompt.ToolResultPart => part.type === 'tool-result';

// =============================================================================
// Conversion Input
// =============================================================================

/**
 * Input for the Effect AI trajectory converter.
 *
 * @since 0.2.0
 */
export interface EffectAiConversionInput {
	/** The full conversation history from `Chat.history`. */
	readonly history: Prompt.Prompt;
	/** Agent identity metadata. */
	readonly agentInfo: AgentInfo;
	/** Session identifier for the trajectory. */
	readonly sessionId: string;
	/** Model name used during the run. */
	readonly modelName: string;
	/** Accumulated token usage. */
	readonly usage: UsageSnapshot;
	/** Total duration of the agent run in milliseconds. */
	readonly durationMs: number;
	/** Number of LLM generation turns. */
	readonly numTurns: number;
	/** Total cost in USD (if known). */
	readonly costUsd?: number;
}

// =============================================================================
// Accumulator
// =============================================================================

interface Accumulator {
	readonly steps: Array<AtifStep>;
	readonly pendingToolCalls: Map<string, Prompt.ToolCallPart>;
}

// =============================================================================
// Reduce step: process one message
// =============================================================================

/**
 * Process a single Prompt.Message into the accumulator.
 *
 * Dispatches on `message.role` using the string discriminant. Parts
 * within each message are filtered by their `type` field — we avoid
 * casting to specific part array types by checking part properties
 * directly.
 */
const processMessage = (
	acc: Accumulator,
	message: Prompt.Message,
	builder: StepBuilder,
	modelName: string
): Accumulator => {
	if (message.role === 'system') {
		return acc;
	}

	if (message.role === 'user') {
		const text = pipe(
			message.content,
			Arr.filterMap((part) =>
				isTextPart(part) && Str.isNonEmpty(part.text)
					? Result.succeed(part.text)
					: Result.failVoid
			),
			Arr.join('\n')
		);
		if (Str.isNonEmpty(text)) {
			acc.steps.push(builder.step('user', text));
		}
		return acc;
	}

	if (message.role === 'assistant') {
		const parts = message.content;

		const text = pipe(
			parts,
			Arr.filterMap((part) =>
				isTextPart(part) && Str.isNonEmpty(part.text)
					? Result.succeed(part.text)
					: Result.failVoid
			),
			Arr.join('\n')
		);

		const reasoning = pipe(
			parts,
			Arr.filterMap((part) =>
				isReasoningPart(part) && Str.isNonEmpty(part.text)
					? Result.succeed(part.text)
					: Result.failVoid
			),
			Arr.join('\n'),
			(r) => (Str.isNonEmpty(r) ? Option.some(r) : Option.none())
		);

		const toolCalls = Arr.filter(parts, isToolCallPart);

		// Register pending tool calls
		Arr.forEach(toolCalls, (tc) => acc.pendingToolCalls.set(tc.id, tc));

		if (Str.isNonEmpty(text) || Option.isSome(reasoning)) {
			const displayMessage = Str.isNonEmpty(text) ? text : '(thinking)';
			acc.steps.push(
				builder.step('agent', displayMessage, {
					modelName,
					...(Option.isSome(reasoning)
						? { reasoningContent: reasoning.value }
						: {}),
					...(toolCalls.length > 0
						? {
								toolCalls: Arr.map(toolCalls, toAtifToolCall)
							}
						: {})
				})
			);
		} else if (toolCalls.length > 0) {
			acc.steps.push(
				builder.step(
					'agent',
					`Tool: ${pipe(
						toolCalls,
						Arr.map((tc) => tc.name),
						Arr.join(', ')
					)}`,
					{
						modelName,
						toolCalls: Arr.map(toolCalls, toAtifToolCall)
					}
				)
			);
		}
		return acc;
	}

	if (message.role === 'tool') {
		const results = Arr.filter(message.content, isToolResultPart);

		Arr.forEach(results, (result) => {
			const pending = acc.pendingToolCalls.get(result.id);
			if (pending !== undefined) {
				acc.pendingToolCalls.delete(result.id);
				acc.steps.push(buildPairedToolStep(builder, pending, result));
			}
		});
		return acc;
	}

	return acc;
};

// =============================================================================
// Conversion
// =============================================================================

/**
 * Convert an Effect AI conversation history (Prompt) to an ATIF trajectory.
 *
 * Walks the `Prompt.content` messages in order:
 * - `system` messages are skipped (they're configuration, not trajectory)
 * - `user` messages become user steps
 * - `assistant` messages produce agent steps with text/reasoning/tool calls
 * - `tool` messages pair tool results with pending tool calls
 *
 * Produces an `ATIF-v1.6` trajectory.
 *
 * @since 0.2.0
 */
export const fromEffectAiHistory = Effect.fn(
	'EffectAiConverter.fromEffectAiHistory'
)(function* (input: EffectAiConversionInput) {
	const now = yield* DateTime.now;
	const timestamp = DateTime.formatIso(now);
	const builder = new StepBuilder(timestamp);

	const initial: Accumulator = {
		steps: [],
		pendingToolCalls: new Map()
	};

	const acc = Arr.reduce(input.history.content, initial, (acc, message) =>
		processMessage(acc, message, builder, input.modelName)
	);

	// Emit remaining unpaired tool calls
	Arr.forEach(Array.from(acc.pendingToolCalls.values()), (pending) => {
		acc.steps.push(buildUnpairedToolStep(builder, pending));
	});

	const finalSteps = ensureNonEmpty(acc.steps, builder);

	return buildTrajectory({
		schemaVersion: 'ATIF-v1.6',
		sessionId: input.sessionId,
		agentInfo: input.agentInfo,
		steps: finalSteps,
		finalMetrics: Option.some(
			new FinalMetrics({
				total_prompt_tokens: Option.some(input.usage.inputTokens),
				total_completion_tokens: Option.some(input.usage.outputTokens),
				total_cached_tokens: Option.some(input.usage.cachedTokens),
				total_cost_usd: Option.fromNullishOr(input.costUsd),
				total_steps: finalSteps.length,
				extra: {
					duration_ms: input.durationMs,
					num_turns: input.numTurns
				}
			})
		)
	});
});
