/**
 * Structured mutations to an AgentBlueprint.
 *
 * Instead of the meta-agent producing a complete new blueprint each
 * iteration, it produces an array of patches. The framework applies
 * them to the current blueprint, validates the result, and benchmarks it.
 *
 * @since 0.3.0
 */
import { Match } from 'effect';
import * as Arr from 'effect/Array';
import * as Schema from 'effect/Schema';

import {
	AgentBlueprint,
	AgentConstraints,
	ModelConfig,
	ModelProvider,
	ThinkingConfig
} from './AgentBlueprint.js';
import { OrchestrationSpec } from './OrchestrationSpec.js';
import { ParamSpec, ToolImplementation, ToolSpec } from './ToolSpec.js';

// =============================================================================
// SetSystemPrompt
// =============================================================================

/**
 * Replace the agent's system prompt.
 *
 * @since 0.3.0
 */
export class SetSystemPrompt extends Schema.TaggedClass<SetSystemPrompt>()(
	'SetSystemPrompt',
	{
		prompt: Schema.String
	},
	{ description: "Replace the agent's system prompt." }
) {}

// =============================================================================
// SetModel
// =============================================================================

/**
 * Update model configuration. Only specified fields are changed.
 *
 * @since 0.3.0
 */
export class SetModel extends Schema.TaggedClass<SetModel>()(
	'SetModel',
	{
		provider: Schema.optionalKey(ModelProvider),
		modelName: Schema.optionalKey(Schema.String),
		thinkingType: Schema.optionalKey(
			Schema.Literals(['enabled', 'disabled'])
		),
		thinkingBudgetTokens: Schema.optionalKey(Schema.Number)
	},
	{
		description:
			'Update model configuration. Only specified fields are changed.'
	}
) {}

// =============================================================================
// AddTool
// =============================================================================

/**
 * Add a new tool to the agent's toolkit.
 *
 * @since 0.3.0
 */
export class AddTool extends Schema.TaggedClass<AddTool>()(
	'AddTool',
	{
		tool: ToolSpec
	},
	{ description: "Add a new tool to the agent's toolkit." }
) {}

// =============================================================================
// RemoveTool
// =============================================================================

/**
 * Remove a tool by name from the agent's toolkit.
 *
 * @since 0.3.0
 */
export class RemoveTool extends Schema.TaggedClass<RemoveTool>()(
	'RemoveTool',
	{
		toolName: Schema.String
	},
	{ description: "Remove a tool by name from the agent's toolkit." }
) {}

// =============================================================================
// ModifyTool
// =============================================================================

/**
 * Modify an existing tool. Only specified fields are updated.
 *
 * @since 0.3.0
 */
export class ModifyTool extends Schema.TaggedClass<ModifyTool>()(
	'ModifyTool',
	{
		toolName: Schema.String,
		description: Schema.optionalKey(Schema.String),
		parameters: Schema.optionalKey(Schema.Array(ParamSpec)),
		implementation: Schema.optionalKey(ToolImplementation)
	},
	{
		description:
			'Modify an existing tool. Only specified fields are updated.'
	}
) {}

// =============================================================================
// SetOrchestration
// =============================================================================

/**
 * Replace the agent's orchestration strategy.
 *
 * @since 0.3.0
 */
export class SetOrchestration extends Schema.TaggedClass<SetOrchestration>()(
	'SetOrchestration',
	{
		strategy: OrchestrationSpec
	},
	{ description: "Replace the agent's orchestration strategy." }
) {}

// =============================================================================
// SetConstraints
// =============================================================================

/**
 * Update resource constraints. Only specified fields are changed.
 *
 * @since 0.3.0
 */
export class SetConstraints extends Schema.TaggedClass<SetConstraints>()(
	'SetConstraints',
	{
		maxTurns: Schema.optionalKey(Schema.Number),
		shellTimeoutSec: Schema.optionalKey(Schema.Number),
		containerTimeoutSec: Schema.optionalKey(Schema.Number),
		maxBudgetUsd: Schema.optionalKey(Schema.Number)
	},
	{
		description:
			'Update resource constraints. Only specified fields are changed.'
	}
) {}

// =============================================================================
// BlueprintPatch (union)
// =============================================================================

/**
 * A single mutation to apply to an AgentBlueprint.
 *
 * @since 0.3.0
 */
export const BlueprintPatch = Schema.Union([
	SetSystemPrompt,
	SetModel,
	AddTool,
	RemoveTool,
	ModifyTool,
	SetOrchestration,
	SetConstraints
]).annotate({
	title: 'BlueprintPatch',
	description: 'A single mutation to apply to an AgentBlueprint.'
});

export type BlueprintPatch = typeof BlueprintPatch.Type;

// =============================================================================
// Internal helpers
// =============================================================================

/** Extract plain fields from an AgentBlueprint for reconstruction. */
const blueprintFields = (b: AgentBlueprint) => ({
	name: b.name,
	version: b.version,
	systemPrompt: b.systemPrompt,
	model: b.model,
	tools: b.tools,
	orchestration: b.orchestration,
	constraints: b.constraints,
	description: b.description
});

/** Extract plain fields from a ToolSpec for reconstruction. */
const toolFields = (t: ToolSpec) => ({
	name: t.name,
	description: t.description,
	parameters: t.parameters,
	implementation: t.implementation
});

// =============================================================================
// applyPatch (internal)
// =============================================================================

/**
 * Apply a single patch to a blueprint, returning a new blueprint.
 *
 * Non-applicable patches (e.g., RemoveTool for a non-existent tool) are
 * silently skipped — the original blueprint is returned unchanged.
 */
const applyPatch = (
	blueprint: AgentBlueprint,
	patch: BlueprintPatch
): AgentBlueprint =>
	Match.valueTags(patch, {
		SetSystemPrompt: (p) =>
			new AgentBlueprint({
				...blueprintFields(blueprint),
				systemPrompt: p.prompt
			}),

		SetModel: (p) => {
			const newModel = new ModelConfig({
				provider: p.provider ?? blueprint.model.provider,
				modelName: p.modelName ?? blueprint.model.modelName,
				thinking: new ThinkingConfig({
					type: p.thinkingType ?? blueprint.model.thinking.type,
					budgetTokens:
						p.thinkingBudgetTokens ??
						blueprint.model.thinking.budgetTokens
				})
			});
			return new AgentBlueprint({
				...blueprintFields(blueprint),
				model: newModel
			});
		},

		AddTool: (p) =>
			new AgentBlueprint({
				...blueprintFields(blueprint),
				tools: [...blueprint.tools, p.tool]
			}),

		RemoveTool: (p) =>
			new AgentBlueprint({
				...blueprintFields(blueprint),
				tools: Arr.filter(blueprint.tools, (t) => t.name !== p.toolName)
			}),

		ModifyTool: (p) => {
			const newTools = Arr.map(blueprint.tools, (t) =>
				t.name === p.toolName
					? new ToolSpec({
							...toolFields(t),
							...(p.description !== undefined
								? { description: p.description }
								: {}),
							...(p.parameters !== undefined
								? { parameters: p.parameters }
								: {}),
							...(p.implementation !== undefined
								? { implementation: p.implementation }
								: {})
						})
					: t
			);
			return new AgentBlueprint({
				...blueprintFields(blueprint),
				tools: newTools
			});
		},

		SetOrchestration: (p) =>
			new AgentBlueprint({
				...blueprintFields(blueprint),
				orchestration: p.strategy
			}),

		SetConstraints: (p) => {
			const newConstraints = new AgentConstraints({
				maxTurns: p.maxTurns ?? blueprint.constraints.maxTurns,
				shellTimeoutSec:
					p.shellTimeoutSec ?? blueprint.constraints.shellTimeoutSec,
				containerTimeoutSec:
					p.containerTimeoutSec ??
					blueprint.constraints.containerTimeoutSec,
				maxBudgetUsd:
					p.maxBudgetUsd ?? blueprint.constraints.maxBudgetUsd
			});
			return new AgentBlueprint({
				...blueprintFields(blueprint),
				constraints: newConstraints
			});
		}
	});

// =============================================================================
// applyPatches (exported)
// =============================================================================

/**
 * Apply an array of patches to a blueprint, returning a new blueprint.
 *
 * Patches are applied in order via left fold. Non-applicable patches
 * are silently skipped.
 *
 * @since 0.3.0
 */
export const applyPatches = (
	blueprint: AgentBlueprint,
	patches: ReadonlyArray<BlueprintPatch>
): AgentBlueprint => Arr.reduce(patches, blueprint, applyPatch);
