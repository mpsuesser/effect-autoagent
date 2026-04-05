/**
 * ATIF (Agent Trajectory Interchange Format) domain model and trajectory
 * builder.
 *
 * Models the standardized trajectory format used by Harbor for recording
 * agent execution traces. Supports both ATIF v1.2 (Claude) and v1.6
 * (OpenAI) schema versions.
 *
 * @since 0.1.0
 */
import { Match, pipe } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

// =============================================================================
// Tool Call / Observation schemas
// =============================================================================

/**
 * A single tool invocation recorded in a trajectory step.
 *
 * @since 0.1.0
 */
export class ToolCall extends Schema.Class<ToolCall>('ToolCall')(
	{
		tool_call_id: Schema.String,
		function_name: Schema.String,
		arguments: Schema.Unknown
	},
	{ description: 'A single tool invocation recorded in a trajectory step.' }
) {}

/**
 * A single tool result captured in a trajectory step observation.
 *
 * @since 0.1.0
 */
export class ObservationResult extends Schema.Class<ObservationResult>(
	'ObservationResult'
)(
	{
		source_call_id: Schema.String,
		content: Schema.String
	},
	{
		description:
			'A single tool result captured in a trajectory step observation.'
	}
) {}

/**
 * Observation block containing tool execution results.
 *
 * @since 0.1.0
 */
export class Observation extends Schema.Class<Observation>('Observation')(
	{
		results: Schema.Array(ObservationResult)
	},
	{ description: 'Observation block containing tool execution results.' }
) {}

// =============================================================================
// ATIF Step
// =============================================================================

/**
 * A single step in an ATIF trajectory.
 *
 * @since 0.1.0
 */
export class AtifStep extends Schema.Class<AtifStep>('AtifStep')(
	{
		step_id: Schema.Number,
		timestamp: Schema.String,
		source: Schema.String,
		message: Schema.String,
		model_name: Schema.OptionFromOptionalKey(Schema.String),
		reasoning_content: Schema.OptionFromOptionalKey(Schema.String),
		tool_calls: Schema.OptionFromOptionalKey(Schema.Array(ToolCall)),
		observation: Schema.OptionFromOptionalKey(Observation)
	},
	{ description: 'A single step in an ATIF trajectory.' }
) {}

// =============================================================================
// Final Metrics
// =============================================================================

/**
 * Aggregated metrics for the entire agent run.
 *
 * @since 0.1.0
 */
export class FinalMetrics extends Schema.Class<FinalMetrics>('FinalMetrics')(
	{
		total_prompt_tokens: Schema.OptionFromNullishOr(Schema.Number),
		total_completion_tokens: Schema.OptionFromNullishOr(Schema.Number),
		total_cached_tokens: Schema.OptionFromNullishOr(Schema.Number),
		total_cost_usd: Schema.OptionFromNullishOr(Schema.Number),
		total_steps: Schema.Number,
		extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
	},
	{ description: 'Aggregated metrics for the entire agent run.' }
) {}

// =============================================================================
// Agent Info
// =============================================================================

/**
 * Metadata about the agent that produced the trajectory.
 *
 * @since 0.1.0
 */
export class AgentInfo extends Schema.Class<AgentInfo>('AgentInfo')(
	{
		name: Schema.String,
		version: Schema.String,
		model_name: Schema.String
	},
	{
		description: 'Metadata about the agent that produced the trajectory.'
	}
) {}

// =============================================================================
// ATIF Schema Version
// =============================================================================

/**
 * Supported ATIF schema versions.
 *
 * @since 0.1.0
 */
export const AtifSchemaVersion = Schema.Literals([
	'ATIF-v1.2',
	'ATIF-v1.6'
]).annotate({
	title: 'AtifSchemaVersion',
	description: 'Supported ATIF schema versions.'
});

export type AtifSchemaVersion = typeof AtifSchemaVersion.Type;

// =============================================================================
// ATIF Trajectory
// =============================================================================

/**
 * A complete ATIF trajectory document.
 *
 * @since 0.1.0
 */
export class AtifTrajectory extends Schema.Class<AtifTrajectory>(
	'AtifTrajectory'
)(
	{
		schema_version: AtifSchemaVersion,
		session_id: Schema.String,
		agent: AgentInfo,
		steps: Schema.Array(AtifStep),
		final_metrics: Schema.OptionFromNullishOr(FinalMetrics)
	},
	{ description: 'A complete ATIF trajectory document.' }
) {}

// =============================================================================
// Step Builder
// =============================================================================

/**
 * Mutable step builder that auto-increments step IDs and stamps
 * timestamps, matching the Python `_step()` helper pattern.
 *
 * @since 0.1.0
 */
export class StepBuilder {
	private stepId = 0;
	private readonly timestamp: string;

	constructor(timestamp: string) {
		this.timestamp = timestamp;
	}

	/**
	 * Create a new ATIF step with auto-incremented ID.
	 *
	 * @since 0.1.0
	 */
	step(
		source: string,
		message: string,
		options?: {
			readonly modelName?: string;
			readonly reasoningContent?: string;
			readonly toolCalls?: ReadonlyArray<ToolCall>;
			readonly observation?: Observation;
		}
	): AtifStep {
		this.stepId += 1;
		return new AtifStep({
			step_id: this.stepId,
			timestamp: this.timestamp,
			source,
			message,
			model_name: Option.fromNullishOr(options?.modelName),
			reasoning_content: Option.fromNullishOr(options?.reasoningContent),
			tool_calls: pipe(
				Option.fromNullishOr(options?.toolCalls),
				Option.map(Arr.fromIterable)
			),
			observation: Option.fromNullishOr(options?.observation)
		});
	}
}

// =============================================================================
// Trajectory Assembly Helpers
// =============================================================================

/**
 * Source discriminator for ATIF steps.
 *
 * @since 0.1.0
 */
export type StepSource = 'agent' | 'user';

/**
 * Get the step source label.
 *
 * @since 0.1.0
 */
export const stepSourceLabel = (source: StepSource): string =>
	Match.value(source).pipe(
		Match.when('agent', () => 'agent'),
		Match.when('user', () => 'user'),
		Match.exhaustive
	);

/**
 * Ensure a steps array has at least one entry, inserting a placeholder
 * empty step if needed. Mirrors the Python fallback pattern.
 *
 * @since 0.1.0
 */
export const ensureNonEmpty = (
	steps: Array<AtifStep>,
	builder: StepBuilder
): Array<AtifStep> =>
	Arr.match(steps, {
		onEmpty: () => [builder.step('user', '(empty)')],
		onNonEmpty: (values) => Array.from(values)
	});

/**
 * Build a complete ATIF trajectory document.
 *
 * @since 0.1.0
 */
export const buildTrajectory = (options: {
	readonly schemaVersion: AtifSchemaVersion;
	readonly sessionId: string;
	readonly agentInfo: AgentInfo;
	readonly steps: Array<AtifStep>;
	readonly finalMetrics: Option.Option<FinalMetrics>;
}): AtifTrajectory =>
	new AtifTrajectory({
		schema_version: options.schemaVersion,
		session_id: options.sessionId,
		agent: options.agentInfo,
		steps: options.steps,
		final_metrics: options.finalMetrics
	});
