/**
 * Agent configuration model with schema defaults.
 *
 * Represents the configurable surface of an autoagent harness — system
 * prompt, model, turn limits, thinking budget, and tool presets. The
 * meta-agent modifies these values between benchmark runs.
 *
 * @since 0.1.0
 */
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

// =============================================================================
// Thinking Configuration
// =============================================================================

/**
 * Extended thinking configuration for the agent.
 *
 * @since 0.1.0
 */
export class ThinkingConfig extends Schema.Class<ThinkingConfig>(
	'ThinkingConfig'
)(
	{
		type: Schema.Literal('enabled'),
		budget_tokens: Schema.Number
	},
	{
		description: 'Extended thinking configuration with token budget.'
	}
) {}

// =============================================================================
// Tool Preset
// =============================================================================

/**
 * A preset tool configuration for the agent SDK.
 *
 * @since 0.1.0
 */
export class ToolPreset extends Schema.Class<ToolPreset>('ToolPreset')(
	{
		type: Schema.Literal('preset'),
		preset: Schema.String
	},
	{ description: 'A preset tool configuration for the agent SDK.' }
) {}

// =============================================================================
// Agent Config
// =============================================================================

/**
 * Complete agent harness configuration.
 *
 * Schema defaults mirror the Python source defaults, ensuring
 * behavioral parity when no overrides are provided.
 *
 * @since 0.1.0
 */
export class AgentConfig extends Schema.Class<AgentConfig>('AgentConfig')(
	{
		systemPrompt: Schema.String.pipe(
			Schema.withDecodingDefault(
				() => 'You are an agent that executes tasks'
			),
			Schema.withConstructorDefault(() =>
				Option.some('You are an agent that executes tasks')
			)
		),
		model: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'gpt-5.4'),
			Schema.withConstructorDefault(() => Option.some('gpt-5.4'))
		),
		maxTurns: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 30),
			Schema.withConstructorDefault(() => Option.some(30))
		),
		name: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'autoagent'),
			Schema.withConstructorDefault(() => Option.some('autoagent'))
		),
		version: Schema.String.pipe(
			Schema.withDecodingDefault(() => '0.1.0'),
			Schema.withConstructorDefault(() => Option.some('0.1.0'))
		),
		thinking: Schema.OptionFromOptionalKey(ThinkingConfig).pipe(
			Schema.withConstructorDefault(() => Option.some(Option.none()))
		),
		toolPreset: Schema.OptionFromOptionalKey(ToolPreset).pipe(
			Schema.withConstructorDefault(() => Option.some(Option.none()))
		),
		shellTimeoutSec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 120),
			Schema.withConstructorDefault(() => Option.some(120))
		),
		containerTimeoutSec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 600),
			Schema.withConstructorDefault(() => Option.some(600))
		),
		maxBudgetUsd: Schema.OptionFromOptionalKey(Schema.Number).pipe(
			Schema.withConstructorDefault(() => Option.some(Option.none()))
		),
		permissionMode: Schema.String.pipe(
			Schema.withDecodingDefault(() => 'bypassPermissions'),
			Schema.withConstructorDefault(() =>
				Option.some('bypassPermissions')
			)
		)
	},
	{
		description:
			'Complete agent harness configuration with sensible defaults.'
	}
) {}

// =============================================================================
// Preset Configurations
// =============================================================================

/**
 * Default configuration matching the Python `agent.py` (OpenAI variant).
 *
 * @category Presets
 * @since 0.1.0
 */
export const openAiDefault = new AgentConfig({});

/**
 * Default configuration matching the Python `agent-claude.py` (Claude variant).
 *
 * @category Presets
 * @since 0.1.0
 */
export const claudeDefault = new AgentConfig({
	systemPrompt: `You are a highly capable task-completion agent. You solve tasks by reading instructions, analyzing the problem, writing and executing code, and producing the required output files.

## Approach
1. Read /task/instruction.md to understand what's required.
2. Explore the working environment — check what files, tools, and libraries are available.
3. Plan your approach, then execute step by step.
4. Write output files to the exact paths specified in the instructions.
5. Verify your output before finishing.

## Key rules
- Use python3 (not python) for running scripts.
- Use Bash to run shell commands, install packages, inspect files.
- For data analysis: pandas, numpy, openpyxl are available.
- For file manipulation: use standard Python or shell tools.
- Always verify output files exist and contain valid content before finishing.
- If a task involves git repos, use git commands directly.
- If a task involves databases, use sqlite3 CLI or Python sqlite3 module.
- If a task involves images, use PIL/Pillow.
- Read error messages carefully and fix issues iteratively.
- Never give up — try multiple approaches if one fails.`,
	model: 'haiku',
	thinking: Option.some(
		new ThinkingConfig({ type: 'enabled', budget_tokens: 10000 })
	),
	toolPreset: Option.some(
		new ToolPreset({ type: 'preset', preset: 'claude_code' })
	)
});
