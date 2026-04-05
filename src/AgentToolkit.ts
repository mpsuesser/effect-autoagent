/**
 * Effect AI tool definitions for the autoagent framework.
 *
 * Wraps the sandbox shell execution capability as a typed Effect AI
 * `Tool` and `Toolkit`, enabling integration with the `LanguageModel`
 * agentic loop. The toolkit is extensible — consumers can merge
 * additional tools via `Toolkit.merge`.
 *
 * @since 0.2.0
 */
import { Schema } from 'effect';
import * as Tool from 'effect/unstable/ai/Tool';
import * as Toolkit from 'effect/unstable/ai/Toolkit';

import { Environment } from './Environment.js';
import { runShell } from './ShellTool.js';

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Shell execution tool for the agent.
 *
 * Executes a command in the sandbox container and returns the combined
 * stdout/stderr output. On failure, returns an `"ERROR: ..."` string
 * (error-as-data) so the LLM can read and self-correct.
 *
 * @since 0.2.0
 */
export const RunShell = Tool.make('run_shell', {
	description:
		'Execute a shell command in the task container. Returns combined stdout/stderr. On failure returns an error string.',
	parameters: Schema.Struct({
		command: Schema.String.annotate({
			description: 'The shell command to execute'
		})
	}),
	success: Schema.String,
	dependencies: [Environment.Service]
});

// =============================================================================
// Toolkit
// =============================================================================

/**
 * Default agent toolkit containing the `run_shell` tool.
 *
 * Consumers can extend this with additional tools via `Toolkit.merge`:
 *
 * ```ts
 * const extended = Toolkit.merge(AgentTools, customToolkit)
 * ```
 *
 * @since 0.2.0
 */
export const AgentTools = Toolkit.make(RunShell);

// =============================================================================
// Handler Layer
// =============================================================================

/**
 * Handler layer that connects the `run_shell` tool to the sandbox
 * `Environment.Service`. Provide this layer (along with
 * `Environment.Service`) to enable tool execution.
 *
 * @since 0.2.0
 */
export const AgentToolsLayer = AgentTools.toLayer({
	run_shell: ({ command }) => runShell(command)
});
