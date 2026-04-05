/**
 * Task directory reader for Harbor-compatible task format.
 *
 * Reads task directories containing `task.toml`, `instruction.md`,
 * and `tests/` to produce typed `TaskSpec` values for the native
 * benchmark runner.
 *
 * @since 0.3.0
 */
import { Effect, FileSystem, Result } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';
import { parse } from 'smol-toml';

import { TaskError } from './Errors.js';

// =============================================================================
// Task TOML Schemas
// =============================================================================

/**
 * Task identification metadata from `task.toml` `[task]` section.
 *
 * @since 0.3.0
 */
export class TaskMeta extends Schema.Class<TaskMeta>('TaskMeta')(
	{
		name: Schema.String,
		description: Schema.String.pipe(
			Schema.withDecodingDefault(() => ''),
			Schema.withConstructorDefault(() => Option.some(''))
		)
	},
	{
		description:
			'Task identification metadata from task.toml [task] section.'
	}
) {}

/**
 * Agent execution settings from `task.toml` `[agent]` section.
 *
 * @since 0.3.0
 */
export class AgentSettings extends Schema.Class<AgentSettings>('AgentSettings')(
	{
		timeout_sec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 120),
			Schema.withConstructorDefault(() => Option.some(120))
		)
	},
	{ description: 'Agent execution settings from task.toml [agent] section.' }
) {}

/**
 * Verifier settings from `task.toml` `[verifier]` section.
 *
 * @since 0.3.0
 */
export class VerifierSettings extends Schema.Class<VerifierSettings>(
	'VerifierSettings'
)(
	{
		timeout_sec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 600),
			Schema.withConstructorDefault(() => Option.some(600))
		)
	},
	{ description: 'Verifier settings from task.toml [verifier] section.' }
) {}

/**
 * Container environment settings from `task.toml` `[environment]` section.
 *
 * @since 0.3.0
 */
export class EnvironmentSettings extends Schema.Class<EnvironmentSettings>(
	'EnvironmentSettings'
)(
	{
		build_timeout_sec: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 600),
			Schema.withConstructorDefault(() => Option.some(600))
		),
		cpus: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 1),
			Schema.withConstructorDefault(() => Option.some(1))
		),
		memory_mb: Schema.Number.pipe(
			Schema.withDecodingDefault(() => 2048),
			Schema.withConstructorDefault(() => Option.some(2048))
		),
		allow_internet: Schema.Boolean.pipe(
			Schema.withDecodingDefault(() => true),
			Schema.withConstructorDefault(() => Option.some(true))
		)
	},
	{
		description:
			'Container environment settings from task.toml [environment] section.'
	}
) {}

/**
 * Full task configuration decoded from `task.toml`.
 *
 * @since 0.3.0
 */
export class TaskConfig extends Schema.Class<TaskConfig>('TaskConfig')(
	{
		schema_version: Schema.String.pipe(
			Schema.withDecodingDefault(() => '1.1'),
			Schema.withConstructorDefault(() => Option.some('1.1'))
		),
		task: TaskMeta,
		agent: AgentSettings.pipe(
			Schema.withDecodingDefault(() => new AgentSettings({})),
			Schema.withConstructorDefault(() =>
				Option.some(new AgentSettings({}))
			)
		),
		verifier: VerifierSettings.pipe(
			Schema.withDecodingDefault(() => new VerifierSettings({})),
			Schema.withConstructorDefault(() =>
				Option.some(new VerifierSettings({}))
			)
		),
		environment: EnvironmentSettings.pipe(
			Schema.withDecodingDefault(() => new EnvironmentSettings({})),
			Schema.withConstructorDefault(() =>
				Option.some(new EnvironmentSettings({}))
			)
		)
	},
	{ description: 'Full task configuration decoded from task.toml.' }
) {}

// =============================================================================
// Resolved Task Specification
// =============================================================================

/**
 * Fully resolved task specification from a task directory.
 *
 * @since 0.3.0
 */
export class TaskSpec extends Schema.Class<TaskSpec>('TaskSpec')(
	{
		config: TaskConfig,
		instruction: Schema.String,
		taskDir: Schema.String,
		dockerfilePath: Schema.OptionFromOptionalKey(Schema.String).pipe(
			Schema.withConstructorDefault(() => Option.some(Option.none()))
		),
		testScripts: Schema.Array(Schema.String)
	},
	{ description: 'Fully resolved task specification from a task directory.' }
) {}

// =============================================================================
// TOML Parsing
// =============================================================================

const decodeTaskConfig = Schema.decodeUnknownEffect(TaskConfig);

/**
 * Parse a `task.toml` string into a `TaskConfig`.
 *
 * @since 0.3.0
 */
export const parseTaskToml = (
	content: string
): Effect.Effect<TaskConfig, TaskError> =>
	Effect.try({
		try: () => parse(content),
		catch: (cause) =>
			new TaskError({
				operation: 'parseToml',
				message: 'Failed to parse task.toml',
				cause
			})
	}).pipe(
		Effect.flatMap((parsed) =>
			decodeTaskConfig(normalizeTomlData(parsed)).pipe(
				Effect.mapError(
					(cause) =>
						new TaskError({
							operation: 'decodeTaskConfig',
							message: 'Failed to decode task.toml data',
							cause
						})
				)
			)
		)
	);

/**
 * Normalize parsed TOML data to match the TaskConfig schema shape.
 * Fills in missing sections with empty objects so decoding defaults apply.
 */
const normalizeTomlData = (
	data: Record<string, unknown>
): Record<string, unknown> => ({
	schema_version: data['schema_version'],
	task: data['task'] ?? { name: 'unknown' },
	agent: data['agent'] ?? {},
	verifier: data['verifier'] ?? {},
	environment: data['environment'] ?? {}
});

// =============================================================================
// Task Discovery
// =============================================================================

/**
 * Discover all tasks in a directory. Each subdirectory is expected
 * to contain `task.toml` and `instruction.md`.
 *
 * @since 0.3.0
 */
export const discoverTasks = Effect.fn('TaskSpec.discoverTasks')(function* (
	tasksDir: string
) {
	const fs = yield* FileSystem.FileSystem;

	const exists = yield* fs.exists(tasksDir).pipe(
		Effect.mapError(
			(cause) =>
				new TaskError({
					operation: 'discoverTasks',
					message: `Tasks directory not found: ${tasksDir}`,
					cause
				})
		)
	);

	if (!exists) {
		return yield* new TaskError({
			operation: 'discoverTasks',
			message: `Tasks directory does not exist: ${tasksDir}`
		});
	}

	const entries = yield* fs.readDirectory(tasksDir).pipe(
		Effect.mapError(
			(cause) =>
				new TaskError({
					operation: 'discoverTasks',
					message: `Failed to read tasks directory: ${tasksDir}`,
					cause
				})
		)
	);

	const results = yield* Effect.forEach(
		entries,
		(entry) => discoverSingleTask(fs, tasksDir, entry),
		{ concurrency: 8 }
	);

	return Arr.filterMap(results, (r) =>
		Option.match(r, {
			onNone: () => Result.failVoid,
			onSome: Result.succeed
		})
	);
});

/**
 * Try to discover a single task from a directory entry.
 * Returns `Option.none()` if the entry is not a valid task directory.
 */
const discoverSingleTask = (
	fs: FileSystem.FileSystem,
	tasksDir: string,
	entry: string
): Effect.Effect<Option.Option<TaskSpec>, TaskError> =>
	Effect.gen(function* () {
		const taskDir = `${tasksDir}/${entry}`;

		// Check for task.toml
		const tomlPath = `${taskDir}/task.toml`;
		const hasToml = yield* fs
			.exists(tomlPath)
			.pipe(Effect.mapError(wrapFsError('discoverTask')));
		if (!hasToml) return Option.none();

		// Read and parse task.toml
		const tomlContent = yield* fs
			.readFileString(tomlPath)
			.pipe(Effect.mapError(wrapFsError('readTaskToml')));
		const config = yield* parseTaskToml(tomlContent);

		// Read instruction.md
		const instructionPath = `${taskDir}/instruction.md`;
		const hasInstruction = yield* fs
			.exists(instructionPath)
			.pipe(Effect.mapError(wrapFsError('discoverTask')));
		if (!hasInstruction) return Option.none();

		const instruction = yield* fs
			.readFileString(instructionPath)
			.pipe(Effect.mapError(wrapFsError('readInstruction')));

		// Discover test scripts
		const testsDir = `${taskDir}/tests`;
		const hasTests = yield* fs
			.exists(testsDir)
			.pipe(Effect.mapError(wrapFsError('discoverTask')));

		const testScripts: ReadonlyArray<string> = hasTests
			? yield* fs
					.readDirectory(testsDir)
					.pipe(
						Effect.map(
							Arr.filter(
								(f) =>
									Str.endsWith('.sh')(f) ||
									Str.endsWith('.py')(f)
							)
						),
						Effect.mapError(wrapFsError('readTests'))
					)
			: [];

		// Check for Dockerfile
		const dockerfilePath = `${taskDir}/environment/Dockerfile`;
		const hasDockerfile = yield* fs
			.exists(dockerfilePath)
			.pipe(Effect.mapError(wrapFsError('discoverTask')));

		return Option.some(
			new TaskSpec({
				config,
				instruction,
				taskDir,
				dockerfilePath: hasDockerfile
					? Option.some(dockerfilePath)
					: Option.none(),
				testScripts: Array.from(testScripts)
			})
		);
	});

const wrapFsError = (operation: string) => (cause: unknown) =>
	new TaskError({
		operation,
		message: `File system operation failed during ${operation}`,
		cause
	});
