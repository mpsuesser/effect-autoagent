/**
 * Agent execution result schema.
 *
 * Captures the full outcome of running an agent against a task:
 * the ATIF trajectory, agent metrics, the reason the
 * run terminated, and the final text output (if any).
 *
 * @since 0.2.0
 */
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { AtifTrajectory } from './Atif.js';
import { AgentMetrics } from './Metrics.js';

// =============================================================================
// Exit Reason
// =============================================================================

/**
 * Reason the agent run terminated.
 *
 * @since 0.2.0
 */
export const ExitReason = Schema.Literals([
	'completed',
	'max_turns',
	'timeout',
	'budget_exceeded'
]).annotate({
	title: 'ExitReason',
	description: 'Reason the agent run terminated.'
});

export type ExitReason = typeof ExitReason.Type;

// =============================================================================
// Agent Run Result
// =============================================================================

/**
 * Complete result of executing an agent against a task instruction.
 *
 * @since 0.2.0
 */
export class AgentRunResult extends Schema.Class<AgentRunResult>(
	'AgentRunResult'
)(
	{
		trajectory: AtifTrajectory,
		metrics: AgentMetrics,
		exitReason: ExitReason,
		finalText: Schema.OptionFromNullishOr(Schema.String)
	},
	{
		description:
			'Complete result of executing an agent against a task instruction.'
	}
) {
	/**
	 * Whether the agent completed its task (did not hit turn/time/budget limits).
	 *
	 * @since 0.2.0
	 */
	get isCompleted(): boolean {
		return this.exitReason === 'completed';
	}

	/**
	 * The final text or a fallback indicating the exit reason.
	 *
	 * @since 0.2.0
	 */
	get finalTextOrReason(): string {
		return Option.getOrElse(
			this.finalText,
			() => `(agent exited: ${this.exitReason})`
		);
	}
}
