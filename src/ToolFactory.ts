/**
 * Service that interprets ToolSpec arrays into Effect AI Toolkits at runtime.
 *
 * Instead of tools being defined as compile-time `Tool.make(...)` calls,
 * they are described as `ToolSpec` data and the ToolFactory builds the
 * real toolkit dynamically. This is the bridge between the declarative
 * blueprint and the Effect AI runtime.
 *
 * @since 0.3.0
 */
import { Effect, Layer, Result, ServiceMap } from 'effect';
import * as Arr from 'effect/Array';
import * as P from 'effect/Predicate';
import * as R from 'effect/Record';
import * as Schema from 'effect/Schema';
import * as Tool from 'effect/unstable/ai/Tool';
import * as Toolkit from 'effect/unstable/ai/Toolkit';

import { Environment } from './Environment.js';
import { EnvironmentError } from './Errors.js';
import type { ExecResult } from './ExecResult.js';
import {
	isFileList,
	isFileRead,
	isFileWrite,
	isRunShell,
	isShellCommand,
	type ParamSpec,
	type ToolImplementation,
	type ToolSpec
} from './ToolSpec.js';

// =============================================================================
// Error
// =============================================================================

/**
 * Failed to build a toolkit from tool specifications.
 *
 * @since 0.3.0
 */
export class ToolFactoryError extends Schema.TaggedErrorClass<ToolFactoryError>()(
	'ToolFactoryError',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{ description: 'Failed to build toolkit from tool specifications.' }
) {}

// =============================================================================
// BuiltToolkit
// =============================================================================

/**
 * The result of building a toolkit from ToolSpec data. Contains both the
 * toolkit (for passing to `chat.generateText`) and the handler layer
 * (for providing tool execution capability).
 *
 * @since 0.3.0
 */
export interface BuiltToolkit {
	/** The toolkit to pass to the language model. */
	readonly toolkit: Toolkit.Any;
	/** Layer that provides handler implementations for each tool. */
	readonly handlerLayer: Layer.Layer<never>;
}

// =============================================================================
// Helpers
// =============================================================================

/** @internal */
interface JsonSchemaProperty {
	readonly type: string;
	readonly description: string;
}

/**
 * Build a JSON Schema object from an array of ParamSpec values.
 *
 * Returns a plain object with an index signature so it satisfies
 * `JsonSchema.JsonSchema` (`{ [x: string]: unknown }`).
 *
 * @internal
 */
const buildJsonSchema = (
	params: ReadonlyArray<ParamSpec>
): Record<string, unknown> => {
	const properties: Record<string, JsonSchemaProperty> = Arr.reduce(
		params,
		{} satisfies Record<string, JsonSchemaProperty>,
		(acc, param) => ({
			...acc,
			[param.name]: {
				type: param.type,
				description: param.description
			}
		})
	);
	const required: ReadonlyArray<string> = Arr.filterMap(params, (param) =>
		param.required ? Result.succeed(param.name) : Result.fail(undefined)
	);
	return {
		type: 'object',
		properties,
		required,
		additionalProperties: false
	};
};

/**
 * Interpolate `{{paramName}}` placeholders in a template string with
 * the corresponding parameter values.
 *
 * @internal
 */
const interpolateTemplate = (
	template: string,
	params: Record<string, string>
): string =>
	R.reduce(params, template, (result, value, key) =>
		result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
	);

/**
 * Extract string params from an unknown handler input (the decoded
 * JSON object from the LLM). This is a boundary conversion — unknown
 * data enters, typed record exits.
 *
 * @internal
 */
const toStringRecord = (input: unknown): Record<string, string> => {
	if (!P.isObject(input)) return {};
	return R.fromIterableWith(Object.entries(input), ([key, value]) => [
		key,
		P.isString(value)
			? value
			: P.isNumber(value) || P.isBoolean(value)
				? `${value}`
				: ''
	]);
};

/**
 * Dispatch a tool implementation against the environment, returning
 * the string result. Uses the schema-derived type guards from ToolSpec
 * for exhaustive variant narrowing — no `as` casts needed.
 *
 * @internal
 */
const executeImplementation = (
	env: Environment.Interface,
	impl: ToolImplementation,
	params: Record<string, string>
): Effect.Effect<string, EnvironmentError> => {
	if (isRunShell(impl)) {
		return env
			.exec({ command: params.command ?? '' })
			.pipe(Effect.map((r: ExecResult) => r.combinedOutput));
	}
	if (isShellCommand(impl)) {
		return env
			.exec({ command: interpolateTemplate(impl.template, params) })
			.pipe(Effect.map((r: ExecResult) => r.combinedOutput));
	}
	if (isFileRead(impl)) {
		return env
			.exec({ command: `cat ${params.path ?? ''}` })
			.pipe(Effect.map((r: ExecResult) => r.combinedOutput));
	}
	if (isFileWrite(impl)) {
		return env
			.uploadFile({
				content: params.content ?? '',
				targetPath: params.path ?? ''
			})
			.pipe(Effect.as('File written successfully'));
	}
	if (isFileList(impl)) {
		return env
			.exec({ command: `ls -la ${params.path ?? '.'}` })
			.pipe(Effect.map((r: ExecResult) => r.combinedOutput));
	}
	// isHttpGet — exhaustive by elimination
	return env
		.exec({
			command: `curl -sS "${interpolateTemplate(impl.urlTemplate, params)}"`
		})
		.pipe(Effect.map((r: ExecResult) => r.combinedOutput));
};

/** @internal */
type ToolHandler = (params: unknown) => Effect.Effect<string>;

/**
 * Build a handler record mapping tool names to their implementation
 * functions, closed over the given environment. Errors from the
 * environment are caught and returned as `"ERROR: ..."` strings
 * (error-as-data), matching the existing `runShell` pattern so the
 * LLM can read and self-correct.
 *
 * @internal
 */
const buildHandlers = (
	env: Environment.Interface,
	specs: ReadonlyArray<ToolSpec>
): Record<string, ToolHandler> =>
	R.fromIterableWith(specs, (spec) => [
		spec.name,
		((params: unknown) =>
			executeImplementation(
				env,
				spec.implementation,
				toStringRecord(params)
			).pipe(
				Effect.catchTag('EnvironmentError', (error) =>
					Effect.succeed(`ERROR: ${error.message}`)
				)
			)) satisfies ToolHandler
	]);

// =============================================================================
// Service
// =============================================================================

/**
 * Service that interprets ToolSpec arrays into Effect AI Toolkits at runtime.
 *
 * @since 0.3.0
 */
export namespace ToolFactory {
	/**
	 * The ToolFactory service interface.
	 *
	 * @since 0.3.0
	 */
	export interface Interface {
		/**
		 * Build a fully-wired toolkit from an array of tool specifications.
		 * Returns both the toolkit definition (for the language model) and
		 * the handler layer (for providing execution capability).
		 *
		 * @since 0.3.0
		 */
		readonly buildToolkit: (
			specs: ReadonlyArray<ToolSpec>
		) => Effect.Effect<BuiltToolkit, ToolFactoryError>;
	}

	/**
	 * Service tag for ToolFactory.
	 *
	 * @since 0.3.0
	 */
	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/ToolFactory'
	) {}

	/**
	 * Live layer that builds toolkits by dispatching to the
	 * `Environment.Service` for execution.
	 *
	 * @since 0.3.0
	 */
	export const layer: Layer.Layer<Service, never, Environment.Service> =
		Layer.effect(
			Service,
			Effect.gen(function* () {
				const env = yield* Environment.Service;

				const buildToolkit = Effect.fn('ToolFactory.buildToolkit')(
					function* (
						specs: ReadonlyArray<ToolSpec>
					): Generator<
						Effect.Effect<BuiltToolkit, ToolFactoryError>,
						BuiltToolkit,
						BuiltToolkit
					> {
						return yield* Arr.match(specs, {
							onEmpty: () =>
								Effect.succeed({
									toolkit: Toolkit.empty,
									handlerLayer: Layer.empty
								} satisfies BuiltToolkit),
							onNonEmpty: (nonEmptySpecs) =>
								Effect.try({
									try: () => {
										const tools = Arr.map(
											nonEmptySpecs,
											(spec) =>
												Tool.dynamic(spec.name, {
													description:
														spec.description,
													parameters: buildJsonSchema(
														spec.parameters
													),
													success: Schema.String
												})
										);

										const [first, ...rest] = tools;
										const toolkit = Toolkit.make(
											first,
											...rest
										);

										const handlers = buildHandlers(
											env,
											nonEmptySpecs
										);

										const handlerLayer =
											toolkit.toLayer(handlers);

										return {
											toolkit,
											handlerLayer
										} satisfies BuiltToolkit;
									},
									catch: (cause) =>
										new ToolFactoryError({
											message: `Failed to build toolkit: ${String(cause)}`,
											cause
										})
								})
						});
					}
				);

				return Service.of({ buildToolkit });
			})
		);

	/**
	 * Create a test ToolFactory that returns a pre-configured BuiltToolkit.
	 *
	 * @since 0.3.0
	 */
	export const test = (responses?: {
		readonly buildToolkit?: (
			specs: ReadonlyArray<ToolSpec>
		) => BuiltToolkit;
	}) =>
		Layer.succeed(
			Service,
			Service.of({
				buildToolkit: (specs) =>
					Effect.sync(
						() =>
							responses?.buildToolkit?.(specs) ?? {
								toolkit: Toolkit.empty,
								handlerLayer: Layer.empty
							}
					)
			})
		);
}
