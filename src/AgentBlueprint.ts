/**
 * Central declarative agent configuration.
 *
 * A single, validated, serializable Schema.Class that completely describes
 * an agent. Replaces source-code editing as the optimization surface — the
 * meta-agent produces blueprint patches, and the framework interprets
 * blueprints at runtime to construct and run agents.
 *
 * @since 0.3.0
 */
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import {
	defaultOrchestration,
	OrchestrationSpec,
	type OrchestrationSpec as OrchestrationSpecType
} from './OrchestrationSpec.js';
import { defaultToolSpecs, ToolSpec } from './ToolSpec.js';

// =============================================================================
// ModelProvider
// =============================================================================

/**
 * LLM provider for the agent.
 *
 * @since 0.3.0
 */
export const ModelProvider = Schema.Literals(['openai', 'anthropic']).annotate({
	title: 'ModelProvider',
	description: 'LLM provider for the agent.'
});

export type ModelProvider = typeof ModelProvider.Type;

// =============================================================================
// ThinkingConfig
// =============================================================================

/**
 * Extended thinking configuration for models that support it.
 *
 * @since 0.3.0
 */
export class ThinkingConfig extends Schema.Class<ThinkingConfig>(
	'ThinkingConfig'
)(
	{
		type: Schema.Literals(['enabled', 'disabled']).pipe(
			Schema.withDecodingDefault(
				(): 'enabled' | 'disabled' => 'disabled'
			),
			Schema.withConstructorDefault(() =>
				Option.some<'enabled' | 'disabled'>('disabled')
			)
		),
		budgetTokens: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 0),
			Schema.withConstructorDefault(() => Option.some(0))
		)
	},
	{
		description:
			'Extended thinking configuration for models that support it.'
	}
) {}

// =============================================================================
// ModelConfig
// =============================================================================

/**
 * LLM model configuration for the agent.
 *
 * @since 0.3.0
 */
export class ModelConfig extends Schema.Class<ModelConfig>('ModelConfig')(
	{
		provider: ModelProvider.pipe(
			Schema.withDecodingDefault((): ModelProvider => 'openai'),
			Schema.withConstructorDefault(() =>
				Option.some<ModelProvider>('openai')
			)
		),
		modelName: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'gpt-5.4'),
			Schema.withConstructorDefault(() => Option.some('gpt-5.4'))
		),
		thinking: ThinkingConfig.pipe(
			Schema.withDecodingDefault(() => new ThinkingConfig({})),
			Schema.withConstructorDefault(() =>
				Option.some(new ThinkingConfig({}))
			)
		)
	},
	{ description: 'LLM model configuration for the agent.' }
) {}

// =============================================================================
// AgentConstraints
// =============================================================================

/**
 * Resource constraints for agent execution.
 *
 * @since 0.3.0
 */
export class AgentConstraints extends Schema.Class<AgentConstraints>(
	'AgentConstraints'
)(
	{
		maxTurns: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 100),
			Schema.withConstructorDefault(() => Option.some(100))
		),
		shellTimeoutSec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 120),
			Schema.withConstructorDefault(() => Option.some(120))
		),
		containerTimeoutSec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 600),
			Schema.withConstructorDefault(() => Option.some(600))
		),
		maxBudgetUsd: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 10),
			Schema.withConstructorDefault(() => Option.some(10))
		)
	},
	{ description: 'Resource constraints for agent execution.' }
) {}

// =============================================================================
// AgentBlueprint
// =============================================================================

/**
 * Complete declarative agent specification — the single source of truth
 * for what an agent is.
 *
 * @since 0.3.0
 */
export class AgentBlueprint extends Schema.Class<AgentBlueprint>(
	'AgentBlueprint'
)(
	{
		name: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'autoagent'),
			Schema.withConstructorDefault(() => Option.some('autoagent'))
		),
		version: Schema.String.pipe(
			Schema.withDecodingDefault(() => '0.1.0'),
			Schema.withConstructorDefault(() => Option.some('0.1.0'))
		),
		systemPrompt: Schema.String.pipe(
			Schema.withDecodingDefault(
				() => 'You are an agent that executes tasks'
			),
			Schema.withConstructorDefault(() =>
				Option.some('You are an agent that executes tasks')
			)
		),
		model: ModelConfig.pipe(
			Schema.withDecodingDefault(() => new ModelConfig({})),
			Schema.withConstructorDefault(() =>
				Option.some(new ModelConfig({}))
			)
		),
		tools: Schema.Array(ToolSpec).pipe(
			Schema.withDecodingDefault(
				(): ReadonlyArray<ToolSpec> => defaultToolSpecs
			),
			Schema.withConstructorDefault(
				(): Option.Option<ReadonlyArray<ToolSpec>> =>
					Option.some(defaultToolSpecs)
			)
		),
		orchestration: OrchestrationSpec.pipe(
			Schema.withDecodingDefault(
				(): OrchestrationSpecType => defaultOrchestration
			),
			Schema.withConstructorDefault(
				(): Option.Option<OrchestrationSpecType> =>
					Option.some(defaultOrchestration)
			)
		),
		constraints: AgentConstraints.pipe(
			Schema.withDecodingDefault(() => new AgentConstraints({})),
			Schema.withConstructorDefault(() =>
				Option.some(new AgentConstraints({}))
			)
		),
		description: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'Default agent blueprint'),
			Schema.withConstructorDefault(() =>
				Option.some('Default agent blueprint')
			)
		)
	},
	{
		description:
			'Complete declarative agent specification — the single source of truth for what an agent is.'
	}
) {}

// =============================================================================
// Default Blueprint
// =============================================================================

/**
 * Default agent blueprint with all defaults applied.
 *
 * @since 0.3.0
 */
export const defaultBlueprint: AgentBlueprint = new AgentBlueprint({});

// =============================================================================
// JSON Codec
// =============================================================================

/**
 * JSON string codec for AgentBlueprint — decodes from/encodes to a JSON string.
 *
 * @since 0.3.0
 */
export const BlueprintJson = Schema.fromJsonString(AgentBlueprint);

/**
 * Decode an unknown value (expected to be a JSON string) into an AgentBlueprint.
 *
 * @since 0.3.0
 */
export const decodeBlueprintJson = Schema.decodeUnknownEffect(BlueprintJson);

/**
 * Encode an AgentBlueprint into a JSON string.
 *
 * @since 0.3.0
 */
export const encodeBlueprintJson = Schema.encodeUnknownEffect(BlueprintJson);
