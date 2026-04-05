/**
 * Agent metrics and trajectory serialization.
 *
 * Extracts token usage, timing, and cost metrics from ATIF
 * trajectories and provides JSON encoding for trajectory output.
 *
 * @since 0.1.0
 */
import { pipe } from 'effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { type AtifTrajectory } from './Atif.js';

// =============================================================================
// Agent Metrics
// =============================================================================

/**
 * Metrics extracted from an ATIF trajectory.
 *
 * @since 0.1.0
 */
export class AgentMetrics extends Schema.Class<AgentMetrics>('AgentMetrics')(
	{
		inputTokens: Schema.Number,
		outputTokens: Schema.Number,
		cachedTokens: Schema.Number,
		costUsd: Schema.OptionFromNullishOr(Schema.Number),
		durationMs: Schema.Number,
		numTurns: Schema.Number
	},
	{
		description:
			'Metrics extracted from a trajectory: token counts, timing, and cost.'
	}
) {}

/**
 * Extract metrics from an ATIF trajectory.
 *
 * @since 0.1.0
 */
export const extractMetrics = (
	trajectory: AtifTrajectory
): Option.Option<AgentMetrics> =>
	pipe(
		trajectory.final_metrics,
		Option.map((fm) => {
			const extra = fm.extra ?? {};
			return new AgentMetrics({
				inputTokens: Option.getOrElse(fm.total_prompt_tokens, () => 0),
				outputTokens: Option.getOrElse(
					fm.total_completion_tokens,
					() => 0
				),
				cachedTokens: Option.getOrElse(fm.total_cached_tokens, () => 0),
				costUsd: fm.total_cost_usd,
				durationMs:
					typeof extra['duration_ms'] === 'number'
						? extra['duration_ms']
						: 0,
				numTurns:
					typeof extra['num_turns'] === 'number'
						? extra['num_turns']
						: 0
			});
		})
	);

// =============================================================================
// Trajectory → Plain Object (for JSON serialization)
// =============================================================================

/**
 * Convert an optional value to an object with the given key, or
 * an empty object if none.
 */
const optionalField = <A>(
	key: string,
	value: Option.Option<A>
): Record<string, A> =>
	pipe(
		value,
		Option.match({
			onNone: () => ({}) satisfies Record<string, A>,
			onSome: (v) => ({ [key]: v }) satisfies Record<string, A>
		})
	);

/**
 * Convert an ATIF trajectory to a plain object suitable for JSON
 * serialization. Strips Option wrappers and converts to nullable.
 *
 * @since 0.1.0
 */
export const trajectoryToPlainObject = (
	trajectory: AtifTrajectory
): Record<string, unknown> => ({
	schema_version: trajectory.schema_version,
	session_id: trajectory.session_id,
	agent: {
		name: trajectory.agent.name,
		version: trajectory.agent.version,
		model_name: trajectory.agent.model_name
	},
	steps: trajectory.steps.map((step) => ({
		step_id: step.step_id,
		timestamp: step.timestamp,
		source: step.source,
		message: step.message,
		...optionalField('model_name', step.model_name),
		...optionalField('reasoning_content', step.reasoning_content),
		...optionalField(
			'tool_calls',
			pipe(
				step.tool_calls,
				Option.map((calls) =>
					calls.map((tc) => ({
						tool_call_id: tc.tool_call_id,
						function_name: tc.function_name,
						arguments: tc.arguments
					}))
				)
			)
		),
		...optionalField(
			'observation',
			pipe(
				step.observation,
				Option.map((obs) => ({
					results: obs.results.map((r) => ({
						source_call_id: r.source_call_id,
						content: r.content
					}))
				}))
			)
		)
	})),
	final_metrics: pipe(
		trajectory.final_metrics,
		Option.map((fm) => ({
			total_prompt_tokens: Option.getOrUndefined(fm.total_prompt_tokens),
			total_completion_tokens: Option.getOrUndefined(
				fm.total_completion_tokens
			),
			total_cached_tokens: Option.getOrUndefined(fm.total_cached_tokens),
			total_cost_usd: Option.getOrUndefined(fm.total_cost_usd),
			total_steps: fm.total_steps,
			extra: fm.extra
		})),
		Option.getOrUndefined
	)
});

// =============================================================================
// Trajectory JSON encoding
// =============================================================================

const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);

/**
 * Encode an ATIF trajectory to a JSON string suitable for writing
 * to `trajectory.json`.
 *
 * @since 0.1.0
 */
export const trajectoryToJson = (trajectory: AtifTrajectory): string =>
	encodeUnknownJson(trajectoryToPlainObject(trajectory));

// =============================================================================
// Summary Line
// =============================================================================

/**
 * Format a summary line for agent metrics output.
 *
 * @since 0.1.0
 */
export const formatSummary = (metrics: AgentMetrics): string => {
	const costPart = pipe(
		metrics.costUsd,
		Option.map((c) => `cost_usd=${c.toFixed(4)} `),
		Option.getOrElse(() => '')
	);
	return (
		`${costPart}turns=${metrics.numTurns} ` +
		`duration_ms=${metrics.durationMs} ` +
		`input=${metrics.inputTokens} output=${metrics.outputTokens}`
	);
};
