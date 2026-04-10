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
import { Effect } from 'effect';
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
				Effect.succeed<'enabled' | 'disabled'>('disabled')
			),
			Schema.withConstructorDefault(
				Effect.succeed<'enabled' | 'disabled'>('disabled')
			)
		),
		budgetTokens: Schema.Number.pipe(
			Schema.withDecodingDefault(Effect.succeed(0)),
			Schema.withConstructorDefault(Effect.succeed(0))
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
			Schema.withDecodingDefault(Effect.succeed<ModelProvider>('openai')),
			Schema.withConstructorDefault(
				Effect.succeed<ModelProvider>('openai')
			)
		),
		modelName: Schema.String.pipe(
			Schema.withDecodingDefault(Effect.succeed('gpt-5.4')),
			Schema.withConstructorDefault(Effect.succeed('gpt-5.4'))
		),
		thinking: ThinkingConfig.pipe(
			Schema.withDecodingDefault(Effect.succeed(new ThinkingConfig({}))),
			Schema.withConstructorDefault(
				Effect.succeed(new ThinkingConfig({}))
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
			Schema.withDecodingDefault(Effect.succeed(100)),
			Schema.withConstructorDefault(Effect.succeed(100))
		),
		shellTimeoutSec: Schema.Number.pipe(
			Schema.withDecodingDefault(Effect.succeed(120)),
			Schema.withConstructorDefault(Effect.succeed(120))
		),
		containerTimeoutSec: Schema.Number.pipe(
			Schema.withDecodingDefault(Effect.succeed(600)),
			Schema.withConstructorDefault(Effect.succeed(600))
		),
		maxBudgetUsd: Schema.Number.pipe(
			Schema.withDecodingDefault(Effect.succeed(10)),
			Schema.withConstructorDefault(Effect.succeed(10))
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
			Schema.withDecodingDefault(Effect.succeed('autoagent')),
			Schema.withConstructorDefault(Effect.succeed('autoagent'))
		),
		version: Schema.String.pipe(
			Schema.withDecodingDefault(Effect.succeed('0.1.0')),
			Schema.withConstructorDefault(Effect.succeed('0.1.0'))
		),
		systemPrompt: Schema.String.pipe(
			Schema.withDecodingDefault(
				Effect.succeed('You are an agent that executes tasks')
			),
			Schema.withConstructorDefault(
				Effect.succeed('You are an agent that executes tasks')
			)
		),
		model: ModelConfig.pipe(
			Schema.withDecodingDefault(Effect.succeed(new ModelConfig({}))),
			Schema.withConstructorDefault(Effect.succeed(new ModelConfig({})))
		),
		tools: Schema.Array(ToolSpec).pipe(
			Schema.withDecodingDefault(
				Effect.succeed<ReadonlyArray<ToolSpec>>(defaultToolSpecs)
			),
			Schema.withConstructorDefault(
				Effect.succeed<ReadonlyArray<ToolSpec>>(defaultToolSpecs)
			)
		),
		orchestration: OrchestrationSpec.pipe(
			Schema.withDecodingDefault(
				Effect.succeed<OrchestrationSpecType>(defaultOrchestration)
			),
			Schema.withConstructorDefault(
				Effect.succeed<OrchestrationSpecType>(defaultOrchestration)
			)
		),
		constraints: AgentConstraints.pipe(
			Schema.withDecodingDefault(
				Effect.succeed(new AgentConstraints({}))
			),
			Schema.withConstructorDefault(
				Effect.succeed(new AgentConstraints({}))
			)
		),
		description: Schema.String.pipe(
			Schema.withDecodingDefault(
				Effect.succeed('Default agent blueprint')
			),
			Schema.withConstructorDefault(
				Effect.succeed('Default agent blueprint')
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
