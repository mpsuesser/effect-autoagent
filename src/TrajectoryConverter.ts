/**
 * Trajectory conversion from raw SDK message formats to ATIF.
 *
 * Provides two converters matching the Python codebase:
 * - `fromOpenAiItems` — converts OpenAI Agents SDK `RunResult.new_items`
 * - `fromClaudeMessages` — converts Claude SDK conversation messages
 *
 * Both produce a standardized `AtifTrajectory`.
 *
 * @since 0.1.0
 */
import { Effect, pipe } from 'effect';
import * as Arr from 'effect/Array';
import * as DateTime from 'effect/DateTime';
import * as Option from 'effect/Option';
import * as P from 'effect/Predicate';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';

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
import { ResponseUsage, UsageAccumulator } from './UsageMetrics.js';

// =============================================================================
// JSON encoding for unknown values (replaces direct JSON.stringify)
// =============================================================================

const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);

// =============================================================================
// OpenAI Message Item Schemas (boundary types)
// =============================================================================

/**
 * Discriminated item types from the OpenAI Agents SDK.
 * These are boundary schemas — decoded at the edge from unknown SDK objects.
 *
 * @since 0.1.0
 */
export class MessageItem extends Schema.Class<MessageItem>('MessageItem')(
	{
		type: Schema.Literal('message'),
		text: Schema.String
	},
	{ description: 'A text message output from the OpenAI agent.' }
) {}

export class ReasoningItem extends Schema.Class<ReasoningItem>('ReasoningItem')(
	{
		type: Schema.Literal('reasoning'),
		summaryTexts: Schema.Array(Schema.String)
	},
	{ description: 'A reasoning/thinking block from the OpenAI agent.' }
) {}

export class ToolCallItem extends Schema.Class<ToolCallItem>('ToolCallItem')(
	{
		type: Schema.Literal('tool_call'),
		name: Schema.String,
		callId: Schema.String,
		arguments: Schema.Unknown
	},
	{ description: 'A tool invocation from the OpenAI agent.' }
) {}

export class ToolCallOutputItem extends Schema.Class<ToolCallOutputItem>(
	'ToolCallOutputItem'
)(
	{
		type: Schema.Literal('tool_call_output'),
		callId: Schema.String,
		output: Schema.String
	},
	{ description: 'The output of a tool invocation.' }
) {}

/**
 * Union of all OpenAI agent item types.
 *
 * @since 0.1.0
 */
export const OpenAiItem = Schema.Union([
	MessageItem,
	ReasoningItem,
	ToolCallItem,
	ToolCallOutputItem
]).annotate({
	title: 'OpenAiItem',
	description: 'Discriminated union of OpenAI agent SDK output items.'
});

export type OpenAiItem = typeof OpenAiItem.Type;

// =============================================================================
// Claude Message Schemas (boundary types)
// =============================================================================

/**
 * Claude SDK content block types.
 *
 * @since 0.1.0
 */
export class TextBlock extends Schema.Class<TextBlock>('TextBlock')(
	{
		type: Schema.Literal('text'),
		text: Schema.String
	},
	{ description: 'A text content block from Claude.' }
) {}

export class ThinkingBlock extends Schema.Class<ThinkingBlock>('ThinkingBlock')(
	{
		type: Schema.Literal('thinking'),
		thinking: Schema.String
	},
	{ description: 'A thinking/reasoning block from Claude.' }
) {}

export class ToolUseBlock extends Schema.Class<ToolUseBlock>('ToolUseBlock')(
	{
		type: Schema.Literal('tool_use'),
		id: Schema.String,
		name: Schema.String,
		input: Schema.Unknown
	},
	{ description: 'A tool invocation block from Claude.' }
) {}

export class ToolResultBlock extends Schema.Class<ToolResultBlock>(
	'ToolResultBlock'
)(
	{
		type: Schema.Literal('tool_result'),
		tool_use_id: Schema.String,
		content: Schema.Unknown
	},
	{ description: 'A tool result block from a user message.' }
) {}

/**
 * Union of Claude content block types.
 *
 * @since 0.1.0
 */
export const ClaudeContentBlock = Schema.Union([
	TextBlock,
	ThinkingBlock,
	ToolUseBlock,
	ToolResultBlock
]).annotate({
	title: 'ClaudeContentBlock',
	description: 'Discriminated union of Claude SDK content blocks.'
});

export type ClaudeContentBlock = typeof ClaudeContentBlock.Type;

/**
 * Claude SDK message types.
 *
 * @since 0.1.0
 */
export class ClaudeUserMessage extends Schema.Class<ClaudeUserMessage>(
	'ClaudeUserMessage'
)(
	{
		role: Schema.Literal('user'),
		content: Schema.Union([Schema.String, Schema.Array(ClaudeContentBlock)])
	},
	{ description: 'A user message from the Claude SDK.' }
) {}

export class ClaudeAssistantMessage extends Schema.Class<ClaudeAssistantMessage>(
	'ClaudeAssistantMessage'
)(
	{
		role: Schema.Literal('assistant'),
		content: Schema.Array(ClaudeContentBlock),
		model: Schema.OptionFromOptionalKey(Schema.String)
	},
	{ description: 'An assistant message from the Claude SDK.' }
) {}

/**
 * Usage stats within a Claude result message.
 *
 * @since 0.1.0
 */
export class ClaudeUsageStats extends Schema.Class<ClaudeUsageStats>(
	'ClaudeUsageStats'
)(
	{
		input_tokens: Schema.OptionFromNullishOr(Schema.Number),
		output_tokens: Schema.OptionFromNullishOr(Schema.Number),
		cache_read_input_tokens: Schema.OptionFromNullishOr(Schema.Number)
	},
	{
		description: 'Token usage stats from a Claude result message.'
	}
) {}

export class ClaudeResultMessage extends Schema.Class<ClaudeResultMessage>(
	'ClaudeResultMessage'
)(
	{
		role: Schema.Literal('result'),
		session_id: Schema.OptionFromOptionalKey(Schema.String),
		total_cost_usd: Schema.OptionFromNullishOr(Schema.Number),
		duration_ms: Schema.OptionFromNullishOr(Schema.Number),
		num_turns: Schema.OptionFromNullishOr(Schema.Number),
		usage: Schema.OptionFromOptionalKey(ClaudeUsageStats)
	},
	{ description: 'A result/summary message from the Claude SDK.' }
) {}

/**
 * Union of all Claude SDK message types.
 *
 * @since 0.1.0
 */
export const ClaudeMessage = Schema.Union([
	ClaudeUserMessage,
	ClaudeAssistantMessage,
	ClaudeResultMessage
]).annotate({
	title: 'ClaudeMessage',
	description: 'Discriminated union of Claude SDK message types.'
});

export type ClaudeMessage = typeof ClaudeMessage.Type;

// =============================================================================
// Internal: state machine types for reduce-based conversion
// =============================================================================

interface OpenAiAccumulator {
	readonly steps: Array<AtifStep>;
	readonly pendingToolCall: ToolCallItem | undefined;
}

interface ClaudeAccumulator {
	readonly steps: Array<AtifStep>;
	readonly pending: Map<string, ToolUseBlock>;
	readonly resultMessage: ClaudeResultMessage | undefined;
}

// =============================================================================
// Internal: tool call/observation step builders
// =============================================================================

const buildToolStep = (
	builder: StepBuilder,
	toolCallId: string,
	functionName: string,
	args: unknown,
	observationContent?: string
): AtifStep => {
	const toolCall = new ToolCall({
		tool_call_id: toolCallId,
		function_name: functionName,
		arguments: args
	});
	return observationContent !== undefined
		? builder.step('agent', `Tool: ${functionName}`, {
				toolCalls: [toolCall],
				observation: new Observation({
					results: [
						new ObservationResult({
							source_call_id: toolCallId,
							content: observationContent
						})
					]
				})
			})
		: builder.step('agent', `Tool: ${functionName}`, {
				toolCalls: [toolCall]
			});
};

/**
 * Serialize unknown content to a string at the SDK boundary.
 * Uses Schema-based JSON encoding instead of direct JSON.stringify.
 *
 * @since 0.1.0
 */
const unknownToString = (value: unknown): string => {
	if (P.isString(value)) return value;
	if (P.isNull(value) || P.isUndefined(value)) return '';
	return encodeUnknownJson(value);
};

// =============================================================================
// OpenAI Items → ATIF Conversion
// =============================================================================

/**
 * Input for the OpenAI trajectory converter.
 *
 * @since 0.1.0
 */
export interface OpenAiConversionInput {
	readonly items: ReadonlyArray<OpenAiItem>;
	readonly modelName: string;
	readonly sessionId: string;
	readonly agentInfo: AgentInfo;
	readonly durationMs: number;
	readonly rawResponseUsages: ReadonlyArray<ResponseUsage>;
}

/**
 * Convert OpenAI Agents SDK items to an ATIF trajectory.
 *
 * Implements the same state machine as the Python `to_atif()` function:
 * tracks pending tool calls and pairs them with their outputs.
 *
 * @since 0.1.0
 */
export const fromOpenAiItems = Effect.fn('TrajectoryConverter.fromOpenAiItems')(
	function* (input: OpenAiConversionInput) {
		const now = yield* DateTime.now;
		const timestamp = DateTime.formatIso(now);
		const builder = new StepBuilder(timestamp);

		const initial: OpenAiAccumulator = {
			steps: [],
			pendingToolCall: undefined
		};
		const { steps, pendingToolCall } = Arr.reduce(
			input.items,
			initial,
			(acc, item) => {
				if (item instanceof MessageItem) {
					if (Str.isNonEmpty(item.text)) {
						acc.steps.push(
							builder.step('agent', item.text, {
								modelName: input.modelName
							})
						);
					}
					return acc;
				}
				if (item instanceof ReasoningItem) {
					const reasoning = pipe(
						item.summaryTexts,
						Arr.filter(Str.isNonEmpty),
						Arr.join('\n')
					);
					if (Str.isNonEmpty(reasoning)) {
						acc.steps.push(
							builder.step('agent', '(thinking)', {
								reasoningContent: reasoning,
								modelName: input.modelName
							})
						);
					}
					return acc;
				}
				if (item instanceof ToolCallItem) {
					return { steps: acc.steps, pendingToolCall: item };
				}
				if (
					item instanceof ToolCallOutputItem &&
					acc.pendingToolCall !== undefined
				) {
					acc.steps.push(
						buildToolStep(
							builder,
							acc.pendingToolCall.callId,
							acc.pendingToolCall.name,
							acc.pendingToolCall.arguments,
							item.output
						)
					);
					return { steps: acc.steps, pendingToolCall: undefined };
				}
				return acc;
			}
		);

		// Handle trailing tool call without output
		if (pendingToolCall !== undefined) {
			steps.push(
				buildToolStep(
					builder,
					pendingToolCall.callId,
					pendingToolCall.name,
					pendingToolCall.arguments
				)
			);
		}

		const finalSteps = ensureNonEmpty(steps, builder);

		// Accumulate usage across raw responses
		const accumulator = new UsageAccumulator();
		Arr.forEach(input.rawResponseUsages, (usage) => accumulator.add(usage));
		const snapshot = accumulator.snapshot();

		return buildTrajectory({
			schemaVersion: 'ATIF-v1.6',
			sessionId: input.sessionId,
			agentInfo: input.agentInfo,
			steps: finalSteps,
			finalMetrics: Option.some(
				new FinalMetrics({
					total_prompt_tokens: Option.some(snapshot.inputTokens),
					total_completion_tokens: Option.some(snapshot.outputTokens),
					total_cached_tokens: Option.some(snapshot.cachedTokens),
					total_cost_usd: Option.none(),
					total_steps: finalSteps.length,
					extra: {
						duration_ms: input.durationMs,
						num_turns: input.rawResponseUsages.length
					}
				})
			)
		});
	}
);

// =============================================================================
// Claude Messages → ATIF Conversion
// =============================================================================

/**
 * Input for the Claude trajectory converter.
 *
 * @since 0.1.0
 */
export interface ClaudeConversionInput {
	readonly messages: ReadonlyArray<ClaudeMessage>;
	readonly agentInfo: AgentInfo;
}

/**
 * Process a single user message content block against the pending tool
 * use map. Returns whether the block was a matched tool result.
 */
const processUserBlock = (
	block: ClaudeContentBlock,
	pending: Map<string, ToolUseBlock>,
	builder: StepBuilder,
	steps: Array<AtifStep>
): boolean => {
	if (block instanceof ToolResultBlock) {
		const toolUse = pending.get(block.tool_use_id);
		if (toolUse !== undefined) {
			pending.delete(block.tool_use_id);
			steps.push(
				buildToolStep(
					builder,
					toolUse.id,
					toolUse.name,
					toolUse.input,
					unknownToString(block.content)
				)
			);
			return true;
		}
	}
	return false;
};

/**
 * Process an assistant message, extracting text, thinking, and tool use
 * blocks.
 */
const processAssistantContent = (
	content: ReadonlyArray<ClaudeContentBlock>
): {
	readonly texts: ReadonlyArray<string>;
	readonly reasoning: Option.Option<string>;
	readonly toolUses: ReadonlyArray<ToolUseBlock>;
} => {
	const texts: Array<string> = [];
	let reasoning: Option.Option<string> = Option.none();
	const toolUses: Array<ToolUseBlock> = [];

	for (const block of content) {
		if (block instanceof TextBlock) {
			texts.push(block.text);
		} else if (block instanceof ThinkingBlock) {
			reasoning = Option.some(block.thinking);
		} else if (block instanceof ToolUseBlock) {
			toolUses.push(block);
		}
	}
	return { texts, reasoning, toolUses };
};

/**
 * Convert Claude SDK messages to an ATIF trajectory.
 *
 * Implements the same state machine as the Python
 * `_trajectory_to_atif()` function: tracks pending tool uses by ID and
 * pairs them with tool results from user messages.
 *
 * @since 0.1.0
 */
export const fromClaudeMessages = Effect.fn(
	'TrajectoryConverter.fromClaudeMessages'
)(function* (input: ClaudeConversionInput) {
	const now = yield* DateTime.now;
	const timestamp = DateTime.formatIso(now);
	const builder = new StepBuilder(timestamp);

	const initial: ClaudeAccumulator = {
		steps: [],
		pending: new Map(),
		resultMessage: undefined
	};

	const acc = Arr.reduce(input.messages, initial, (acc, msg) => {
		if (msg instanceof ClaudeResultMessage) {
			return { ...acc, resultMessage: msg };
		}

		if (msg instanceof ClaudeUserMessage) {
			if (P.isString(msg.content)) {
				if (Str.isNonEmpty(msg.content)) {
					acc.steps.push(builder.step('user', msg.content));
				}
				return acc;
			}

			// Array content — check for tool results
			const matchResults = Arr.map(msg.content, (block) =>
				processUserBlock(block, acc.pending, builder, acc.steps)
			);
			const allMatched = Arr.every(matchResults, Boolean);

			if (!allMatched) {
				const text = unknownToString(msg.content);
				if (Str.isNonEmpty(text)) {
					acc.steps.push(builder.step('user', text));
				}
			}
			return acc;
		}

		if (msg instanceof ClaudeAssistantMessage) {
			const { texts, reasoning, toolUses } = processAssistantContent(
				msg.content
			);

			// Register pending tool uses
			Arr.forEach(toolUses, (tu) => acc.pending.set(tu.id, tu));

			const combinedText = Arr.join(texts, '\n');
			if (Str.isNonEmpty(combinedText) || Option.isSome(reasoning)) {
				const displayMessage = Str.isNonEmpty(combinedText)
					? combinedText
					: '(thinking)';
				acc.steps.push(
					builder.step('agent', displayMessage, {
						...(Option.isSome(reasoning)
							? { reasoningContent: reasoning.value }
							: {}),
						...(Option.isSome(msg.model)
							? { modelName: msg.model.value }
							: {})
					})
				);
			}
		}

		return acc;
	});

	// Handle remaining unpaired tool uses
	for (const toolUse of acc.pending.values()) {
		acc.steps.push(
			buildToolStep(builder, toolUse.id, toolUse.name, toolUse.input)
		);
	}

	const finalSteps = ensureNonEmpty(acc.steps, builder);

	// Extract metrics from result message if present
	const emptyUsage = new ClaudeUsageStats({
		input_tokens: Option.none(),
		output_tokens: Option.none(),
		cache_read_input_tokens: Option.none()
	});

	const finalMetrics = pipe(
		Option.fromNullishOr(acc.resultMessage),
		Option.map((rm) => {
			const usage = pipe(
				rm.usage,
				Option.getOrElse(() => emptyUsage)
			);
			return new FinalMetrics({
				total_prompt_tokens: usage.input_tokens,
				total_completion_tokens: usage.output_tokens,
				total_cached_tokens: usage.cache_read_input_tokens,
				total_cost_usd: rm.total_cost_usd,
				total_steps: finalSteps.length,
				extra: {
					duration_ms: pipe(
						rm.duration_ms,
						Option.getOrElse(() => 0)
					),
					num_turns: pipe(
						rm.num_turns,
						Option.getOrElse(() => 0)
					)
				}
			});
		})
	);

	const sessionId = pipe(
		Option.fromNullishOr(acc.resultMessage),
		Option.flatMap((rm) => rm.session_id),
		Option.getOrElse(() => 'unknown')
	);

	return buildTrajectory({
		schemaVersion: 'ATIF-v1.2',
		sessionId,
		agentInfo: input.agentInfo,
		steps: finalSteps,
		finalMetrics
	});
});
