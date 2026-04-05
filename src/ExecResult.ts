/**
 * Schema for the result of executing a command in the sandbox environment.
 *
 * @since 0.1.0
 */
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

/**
 * Represents the stdout/stderr output of a command execution in the
 * container environment. Mirrors Harbor's exec result shape.
 *
 * @since 0.1.0
 */
export class ExecResult extends Schema.Class<ExecResult>('ExecResult')(
	{
		stdout: Schema.OptionFromNullishOr(Schema.String),
		stderr: Schema.OptionFromNullishOr(Schema.String)
	},
	{
		description: 'Result of executing a command in the sandbox container.'
	}
) {
	/**
	 * Combine stdout and stderr into a single output string,
	 * matching the Python `run_shell` formatting.
	 *
	 * @since 0.1.0
	 */
	get combinedOutput(): string {
		const stdout = Option.getOrElse(this.stdout, () => '');
		const stderr = Option.getOrElse(this.stderr, () => '');

		if (stdout.length > 0 && stderr.length > 0) {
			return `${stdout}\nSTDERR:\n${stderr}`;
		}
		if (stderr.length > 0) {
			return `STDERR:\n${stderr}`;
		}
		if (stdout.length > 0) {
			return stdout;
		}
		return '(no output)';
	}
}
