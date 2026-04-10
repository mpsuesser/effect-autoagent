/**
 * Agent orchestration strategy specifications.
 *
 * Defines agent execution strategies as data — instead of a hardcoded
 * agentic loop, the agent's topology/strategy is a discriminated union
 * that the framework interprets at runtime. This lets the meta-agent
 * change HOW the agent runs (single loop, plan-and-execute,
 * verify-and-retry, model fallback) without editing source code.
 *
 * @since 0.3.0
 */
import { Effect, Match } from 'effect';
import * as Schema from 'effect/Schema';

// =============================================================================
// SingleLoop
// =============================================================================

/**
 * Standard agentic loop strategy.
 *
 * Send instruction, call tools, iterate until done or max turns.
 * This is the default strategy used when no other orchestration is specified.
 *
 * @since 0.3.0
 */
export class SingleLoop extends Schema.TaggedClass<SingleLoop>()(
	'SingleLoop',
	{},
	{
		description:
			'Standard agentic loop — send instruction, call tools, iterate until done or max turns.'
	}
) {}

// =============================================================================
// PlanAndExecute
// =============================================================================

/**
 * Two-phase plan-and-execute strategy.
 *
 * A planner agent produces steps, then an executor agent runs each step
 * sequentially. Useful for complex tasks that benefit from upfront
 * decomposition.
 *
 * @since 0.3.0
 */
export class PlanAndExecute extends Schema.TaggedClass<PlanAndExecute>()(
	'PlanAndExecute',
	{
		plannerPrompt: Schema.String,
		maxPlanSteps: Schema.Number.pipe(
			Schema.withDecodingDefault(Effect.succeed(10)),
			Schema.withConstructorDefault(Effect.succeed(10))
		)
	},
	{
		description:
			'Two-phase strategy — a planner agent produces steps, then an executor agent runs each step.'
	}
) {}

// =============================================================================
// WithVerifier
// =============================================================================

/**
 * Verify-and-retry strategy.
 *
 * Run the agent, then verify the output using a separate verifier prompt.
 * If verification fails, retry up to `maxRetries` times.
 *
 * @since 0.3.0
 */
export class WithVerifier extends Schema.TaggedClass<WithVerifier>()(
	'WithVerifier',
	{
		verifierPrompt: Schema.String,
		maxRetries: Schema.Number.pipe(
			Schema.withDecodingDefault(Effect.succeed(2)),
			Schema.withConstructorDefault(Effect.succeed(2))
		)
	},
	{
		description:
			'Run the agent, then verify the output. Retry if verification fails.'
	}
) {}

// =============================================================================
// FallbackModels
// =============================================================================

/**
 * Model fallback strategy.
 *
 * Try models in order — if the first fails or produces poor results,
 * fall back to the next model in the list.
 *
 * @since 0.3.0
 */
export class FallbackModels extends Schema.TaggedClass<FallbackModels>()(
	'FallbackModels',
	{
		models: Schema.NonEmptyArray(Schema.String)
	},
	{
		description:
			'Try models in order — if the first fails or produces poor results, fall back to the next.'
	}
) {}

// =============================================================================
// OrchestrationSpec (union)
// =============================================================================

/**
 * Agent execution strategy — discriminated union of all supported
 * orchestration topologies.
 *
 * @since 0.3.0
 */
export const OrchestrationSpec = Schema.Union([
	SingleLoop,
	PlanAndExecute,
	WithVerifier,
	FallbackModels
]).annotate({
	title: 'OrchestrationSpec',
	description: 'Agent execution strategy — discriminated by _tag.'
});

export type OrchestrationSpec = typeof OrchestrationSpec.Type;

// =============================================================================
// Default
// =============================================================================

/**
 * Default orchestration strategy — a standard single agentic loop.
 *
 * @since 0.3.0
 */
export const defaultOrchestration: OrchestrationSpec = new SingleLoop({});

// =============================================================================
// Guards
// =============================================================================

/**
 * Type guard for the `SingleLoop` variant.
 *
 * @since 0.3.0
 */
export const isSingleLoop: (self: OrchestrationSpec) => self is SingleLoop =
	Schema.is(SingleLoop);

/**
 * Type guard for the `PlanAndExecute` variant.
 *
 * @since 0.3.0
 */
export const isPlanAndExecute: (
	self: OrchestrationSpec
) => self is PlanAndExecute = Schema.is(PlanAndExecute);

/**
 * Type guard for the `WithVerifier` variant.
 *
 * @since 0.3.0
 */
export const isWithVerifier: (self: OrchestrationSpec) => self is WithVerifier =
	Schema.is(WithVerifier);

/**
 * Type guard for the `FallbackModels` variant.
 *
 * @since 0.3.0
 */
export const isFallbackModels: (
	self: OrchestrationSpec
) => self is FallbackModels = Schema.is(FallbackModels);

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Exhaustive pattern match over `OrchestrationSpec` variants.
 *
 * @since 0.3.0
 */
export const match = Match.typeTags<OrchestrationSpec>();
