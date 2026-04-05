/**
 * Typed error classes for the autoagent framework.
 *
 * All domain errors are modeled as `Schema.TaggedErrorClass` instances,
 * enabling precise recovery via `Effect.catchTag` and exhaustive matching.
 *
 * @since 0.1.0
 */
import * as Schema from 'effect/Schema';

/**
 * A shell command executed in the sandbox environment failed or timed out.
 *
 * @since 0.1.0
 */
export class ShellExecError extends Schema.TaggedErrorClass<ShellExecError>()(
	'ShellExecError',
	{
		command: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description:
			'A shell command executed in the sandbox environment failed or timed out.'
	}
) {}

/**
 * Interaction with the sandbox environment (exec, upload, mkdir) failed.
 *
 * @since 0.1.0
 */
export class EnvironmentError extends Schema.TaggedErrorClass<EnvironmentError>()(
	'EnvironmentError',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description:
			'Interaction with the sandbox environment (exec, upload, mkdir) failed.'
	}
) {}

/**
 * The agent run failed to complete within configured constraints.
 *
 * @since 0.1.0
 */
export class AgentRunError extends Schema.TaggedErrorClass<AgentRunError>()(
	'AgentRunError',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description:
			'The agent run failed to complete within configured constraints.'
	}
) {}

/**
 * Converting raw SDK messages to ATIF trajectory format failed.
 *
 * @since 0.1.0
 */
export class TrajectoryConversionError extends Schema.TaggedErrorClass<TrajectoryConversionError>()(
	'TrajectoryConversionError',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description:
			'Converting raw SDK messages to ATIF trajectory format failed.'
	}
) {}

/**
 * A Docker container operation (build, exec, remove) failed.
 *
 * @since 0.2.0
 */
export class ContainerError extends Schema.TaggedErrorClass<ContainerError>()(
	'ContainerError',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description:
			'A Docker container operation (build, exec, remove) failed.'
	}
) {}

/**
 * A benchmark orchestration operation failed.
 *
 * @since 0.2.0
 */
export class BenchmarkError extends Schema.TaggedErrorClass<BenchmarkError>()(
	'BenchmarkError',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description: 'A benchmark orchestration operation failed.'
	}
) {}

/**
 * An experiment log operation (read, write, init) failed.
 *
 * @since 0.2.0
 */
export class ExperimentLogError extends Schema.TaggedErrorClass<ExperimentLogError>()(
	'ExperimentLogError',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description: 'An experiment log operation (read, write, init) failed.'
	}
) {}

/**
 * The meta-agent optimization loop encountered a failure.
 *
 * @since 0.2.0
 */
export class MetaAgentError extends Schema.TaggedErrorClass<MetaAgentError>()(
	'MetaAgentError',
	{
		phase: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description: 'The meta-agent optimization loop encountered a failure.'
	}
) {}

/**
 * A task discovery or execution operation failed.
 *
 * @since 0.3.0
 */
export class TaskError extends Schema.TaggedErrorClass<TaskError>()(
	'TaskError',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{
		description: 'Error during task discovery or execution.'
	}
) {}
