/**
 * Shell command execution tool for the agent.
 *
 * Implements the `run_shell` pattern from the Python agent — commands
 * execute in the sandbox with a timeout, and errors are returned as
 * human-readable strings (error-as-data) so the LLM can self-correct.
 *
 * @since 0.1.0
 */
import { Effect } from 'effect';

import { Environment } from './Environment.js';

// =============================================================================
// Shell Tool
// =============================================================================

/**
 * Execute a shell command in the sandbox environment, returning combined
 * stdout/stderr as a string. On failure, returns an error message string
 * rather than failing the Effect — this matches the Python agent's
 * error-as-data pattern that lets the LLM read and react to errors.
 *
 * @since 0.1.0
 */
export const runShell = Effect.fn('ShellTool.runShell')(function* (
	command: string,
	timeoutSec: number = 120
) {
	const env = yield* Environment.Service;
	const result = yield* env.exec({ command, timeoutSec }).pipe(
		Effect.map((execResult) => execResult.combinedOutput),
		Effect.catchTag('EnvironmentError', (error) =>
			Effect.succeed(`ERROR: ${error.message}`)
		)
	);
	return result;
});
