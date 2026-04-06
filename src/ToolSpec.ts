/**
 * Declarative tool specification schemas for the meta-agent optimizer.
 *
 * Instead of writing Effect AI `Tool.make(...)` calls in source code,
 * tools are described as Schema.Class instances that the framework
 * interprets at runtime. This is the foundation of the "declarative
 * optimization surface" — the meta-agent produces ToolSpec values
 * instead of editing TypeScript source.
 *
 * @since 0.3.0
 */
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

// =============================================================================
// Parameter Type
// =============================================================================

/**
 * The type of a tool parameter as presented to the LLM.
 *
 * @since 0.3.0
 */
export const ParamType = Schema.Literals([
	'string',
	'number',
	'boolean'
]).annotate({
	title: 'ParamType',
	description: 'The type of a tool parameter as presented to the LLM.'
});

export type ParamType = typeof ParamType.Type;

// =============================================================================
// Parameter Specification
// =============================================================================

/**
 * Declarative specification of a single tool parameter.
 *
 * @since 0.3.0
 */
export class ParamSpec extends Schema.Class<ParamSpec>('ParamSpec')(
	{
		name: Schema.String,
		description: Schema.String,
		type: ParamType.pipe(
			Schema.withDecodingDefault((): ParamType => 'string'),
			Schema.withConstructorDefault(
				(): Option.Option<ParamType> => Option.some('string')
			)
		),
		required: Schema.Boolean.pipe(
			Schema.withDecodingDefault(() => true),
			Schema.withConstructorDefault(() => Option.some(true))
		)
	},
	{
		description: 'Declarative specification of a single tool parameter.'
	}
) {}

// =============================================================================
// Tool Implementation Variants
// =============================================================================

/**
 * Raw shell command passthrough — the LLM provides the full command.
 *
 * @since 0.3.0
 */
export class RunShellImpl extends Schema.Class<RunShellImpl>('RunShellImpl')(
	{
		_tag: Schema.tag('RunShell')
	},
	{
		description:
			'Raw shell command passthrough — the LLM provides the full command.'
	}
) {}

/**
 * Shell command with {{param}} template interpolation.
 *
 * @since 0.3.0
 */
export class ShellCommandImpl extends Schema.Class<ShellCommandImpl>(
	'ShellCommandImpl'
)(
	{
		_tag: Schema.tag('ShellCommand'),
		template: Schema.String
	},
	{
		description: 'Shell command with {{param}} template interpolation.'
	}
) {}

/**
 * Read file contents at the path parameter.
 *
 * @since 0.3.0
 */
export class FileReadImpl extends Schema.Class<FileReadImpl>('FileReadImpl')(
	{
		_tag: Schema.tag('FileRead')
	},
	{
		description: 'Read file contents at the path parameter.'
	}
) {}

/**
 * Write content to a file at the path parameter.
 *
 * @since 0.3.0
 */
export class FileWriteImpl extends Schema.Class<FileWriteImpl>('FileWriteImpl')(
	{
		_tag: Schema.tag('FileWrite')
	},
	{
		description: 'Write content to a file at the path parameter.'
	}
) {}

/**
 * List directory contents at the path parameter.
 *
 * @since 0.3.0
 */
export class FileListImpl extends Schema.Class<FileListImpl>('FileListImpl')(
	{
		_tag: Schema.tag('FileList')
	},
	{
		description: 'List directory contents at the path parameter.'
	}
) {}

/**
 * HTTP GET with {{param}} URL template interpolation.
 *
 * @since 0.3.0
 */
export class HttpGetImpl extends Schema.Class<HttpGetImpl>('HttpGetImpl')(
	{
		_tag: Schema.tag('HttpGet'),
		urlTemplate: Schema.String
	},
	{
		description: 'HTTP GET with {{param}} URL template interpolation.'
	}
) {}

// =============================================================================
// Tool Implementation (discriminated union)
// =============================================================================

/**
 * How a tool executes — discriminated by _tag.
 *
 * @since 0.3.0
 */
export const ToolImplementation = Schema.Union([
	RunShellImpl,
	ShellCommandImpl,
	FileReadImpl,
	FileWriteImpl,
	FileListImpl,
	HttpGetImpl
]).annotate({
	title: 'ToolImplementation',
	description: 'How a tool executes — discriminated by _tag.'
});

export type ToolImplementation = typeof ToolImplementation.Type;

// =============================================================================
// Tool Specification
// =============================================================================

/**
 * Declarative specification of a tool that can be interpreted at runtime.
 *
 * @since 0.3.0
 */
export class ToolSpec extends Schema.Class<ToolSpec>('ToolSpec')(
	{
		name: Schema.String,
		description: Schema.String,
		parameters: Schema.Array(ParamSpec).pipe(
			Schema.withDecodingDefault((): ReadonlyArray<ParamSpec> => []),
			Schema.withConstructorDefault(
				(): Option.Option<ReadonlyArray<ParamSpec>> => Option.some([])
			)
		),
		implementation: ToolImplementation
	},
	{
		description:
			'Declarative specification of a tool that can be interpreted at runtime.'
	}
) {}

// =============================================================================
// Default Tool Specifications
// =============================================================================

/**
 * Default tool specifications providing a single RunShell tool.
 *
 * @since 0.3.0
 */
export const defaultToolSpecs: ReadonlyArray<ToolSpec> = [
	new ToolSpec({
		name: 'run_shell',
		description: 'Execute a shell command in the sandbox environment',
		parameters: [
			new ParamSpec({
				name: 'command',
				description: 'The shell command to execute'
			})
		],
		implementation: new RunShellImpl({})
	})
];

// =============================================================================
// Guards
// =============================================================================

/**
 * Type guard for the RunShell implementation variant.
 *
 * @since 0.3.0
 */
export const isRunShell: (self: ToolImplementation) => self is RunShellImpl =
	Schema.is(RunShellImpl);

/**
 * Type guard for the ShellCommand implementation variant.
 *
 * @since 0.3.0
 */
export const isShellCommand: (
	self: ToolImplementation
) => self is ShellCommandImpl = Schema.is(ShellCommandImpl);

/**
 * Type guard for the FileRead implementation variant.
 *
 * @since 0.3.0
 */
export const isFileRead: (self: ToolImplementation) => self is FileReadImpl =
	Schema.is(FileReadImpl);

/**
 * Type guard for the FileWrite implementation variant.
 *
 * @since 0.3.0
 */
export const isFileWrite: (self: ToolImplementation) => self is FileWriteImpl =
	Schema.is(FileWriteImpl);

/**
 * Type guard for the FileList implementation variant.
 *
 * @since 0.3.0
 */
export const isFileList: (self: ToolImplementation) => self is FileListImpl =
	Schema.is(FileListImpl);

/**
 * Type guard for the HttpGet implementation variant.
 *
 * @since 0.3.0
 */
export const isHttpGet: (self: ToolImplementation) => self is HttpGetImpl =
	Schema.is(HttpGetImpl);
