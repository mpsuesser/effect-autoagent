/**
 * Central service that takes an AgentBlueprint and produces a running agent.
 *
 * Interprets the blueprint's tools via ToolFactory, selects the execution
 * strategy based on OrchestrationSpec, and returns an `AgentRuntime` with
 * a `runTask` method. This is the bridge from declarative configuration
 * to executable agent.
 *
 * @since 0.4.0
 */
import { Clock, Effect, Layer, Ref, ServiceMap } from 'effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { Chat, LanguageModel, Prompt } from 'effect/unstable/ai';
import type * as Tool from 'effect/unstable/ai/Tool';

import { type AgentBlueprint } from './AgentBlueprint.js';
import { AgentRunResult, type ExitReason } from './AgentRunResult.js';
import { AgentInfo, AtifStep, buildTrajectory, FinalMetrics } from './Atif.js';
import {
	type EffectAiConversionInput,
	fromEffectAiHistory
} from './EffectAiConverter.js';
import { Environment } from './Environment.js';
import { AgentRunError } from './Errors.js';
import { AgentMetrics, extractMetrics } from './Metrics.js';
import { ToolFactory, type BuiltToolkit } from './ToolFactory.js';
import { UsageSnapshot } from './UsageMetrics.js';

// =============================================================================
// Error
// =============================================================================

/**
 * Failed to construct an agent from a blueprint.
 *
 * @since 0.4.0
 */
export class AgentFactoryError extends Schema.TaggedErrorClass<AgentFactoryError>()(
	'AgentFactoryError',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{ description: 'Failed to construct agent from blueprint.' }
) {}

// =============================================================================
// Internal: loop state tracked via Ref
// =============================================================================

/** @internal */
interface LoopState {
	readonly turns: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly finalText: Option.Option<string>;
	readonly isFirstTurn: boolean;
}

/** @internal */
const initialLoopState: LoopState = {
	turns: 0,
	inputTokens: 0,
	outputTokens: 0,
	finalText: Option.none(),
	isFirstTurn: true
};

// =============================================================================
// Internal: mock trajectory builder for tests
// =============================================================================

/** @internal */
const mockTrajectory = (blueprint: AgentBlueprint) =>
	buildTrajectory({
		schemaVersion: 'ATIF-v1.6',
		sessionId: 'test-session',
		agentInfo: new AgentInfo({
			name: blueprint.name,
			version: blueprint.version,
			model_name: blueprint.model.modelName
		}),
		steps: [
			new AtifStep({
				step_id: 0,
				timestamp: '2024-01-01T00:00:00Z',
				source: 'user',
				message: '(mock)',
				model_name: Option.none(),
				reasoning_content: Option.none(),
				tool_calls: Option.none(),
				observation: Option.none()
			})
		],
		finalMetrics: Option.some(
			new FinalMetrics({
				total_prompt_tokens: Option.some(0),
				total_completion_tokens: Option.some(0),
				total_cached_tokens: Option.some(0),
				total_cost_usd: Option.none(),
				total_steps: 1
			})
		)
	});

// =============================================================================
// Internal: generate text with dynamic toolkit
// =============================================================================

/**
 * Call `session.generateText` with a dynamic toolkit, providing all
 * necessary layers. Returns an `Effect<..., ..., never>` — all services
 * are satisfied internally.
 *
 * The `BuiltToolkit` stores a `Toolkit.Any` — an existential type that
 * erases the `Yieldable` protocol needed by `generateText`'s overloads.
 * At runtime the value IS a `Toolkit<SomeTools>` with the full protocol.
 * We use `Effect.suspend` to construct the `generateText` call within
 * a scope where all layers are already provided, sidestepping the
 * overload inference.
 *
 * @internal
 */
const generateWithToolkit = (
	session: Chat.Service,
	prompt: string | ReadonlyArray<never>,
	builtToolkit: BuiltToolkit,
	loopLayer: Layer.Layer<LanguageModel.LanguageModel | Environment.Service>
): Effect.Effect<
	LanguageModel.GenerateTextResponse<Record<string, Tool.Any>>,
	AgentRunError,
	never
> =>
	Effect.suspend(() =>
		// The toolkit is a proper Toolkit<T> at runtime — Toolkit.Any just
		// drops the Yieldable constraint at the type level. We pass it to
		// the untyped overload path by constructing the options object first.
		(
			session.generateText as (options: {
				readonly prompt: string | ReadonlyArray<never>;
				readonly toolkit: BuiltToolkit['toolkit'];
			}) => Effect.Effect<
				LanguageModel.GenerateTextResponse<Record<string, Tool.Any>>,
				import('effect/unstable/ai/AiError').AiError,
				LanguageModel.LanguageModel
			>
		)({
			prompt,
			toolkit: builtToolkit.toolkit
		})
	).pipe(
		Effect.provide(loopLayer),
		Effect.mapError(
			(cause) =>
				new AgentRunError({
					message: 'Generation failed',
					cause
				})
		)
	);

// =============================================================================
// Service
// =============================================================================

/**
 * Central service that interprets AgentBlueprint into a running agent.
 *
 * @since 0.4.0
 */
export namespace AgentFactory {
	/**
	 * A runtime agent constructed from a blueprint, ready to execute tasks.
	 *
	 * @since 0.4.0
	 */
	export interface AgentRuntime {
		/** The blueprint this runtime was constructed from. */
		readonly blueprint: AgentBlueprint;
		/** Run a task instruction against this agent. */
		readonly runTask: (
			instruction: string
		) => Effect.Effect<AgentRunResult, AgentRunError>;
	}

	/**
	 * Service interface for constructing agent runtimes from blueprints.
	 *
	 * @since 0.4.0
	 */
	export interface Interface {
		/**
		 * Construct an agent runtime from a blueprint. Builds the toolkit,
		 * selects the execution strategy, and returns a runtime ready to
		 * execute tasks.
		 *
		 * @since 0.4.0
		 */
		readonly fromBlueprint: (
			blueprint: AgentBlueprint
		) => Effect.Effect<AgentRuntime, AgentFactoryError>;
	}

	/**
	 * Service tag for AgentFactory.
	 *
	 * @since 0.4.0
	 */
	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/AgentFactory'
	) {}

	/**
	 * Live layer that builds agent runtimes from blueprints.
	 *
	 * Requires `ToolFactory.Service`, `LanguageModel.LanguageModel`, and
	 * `Environment.Service` at construction time. These dependencies are
	 * captured in the closure and do not leak into `AgentRuntime.runTask`.
	 *
	 * @since 0.4.0
	 */
	export const layer: Layer.Layer<
		Service,
		never,
		ToolFactory.Service | LanguageModel.LanguageModel | Environment.Service
	> = Layer.effect(
		Service,
		Effect.gen(function* () {
			const toolFactory = yield* ToolFactory.Service;
			const lm = yield* LanguageModel.LanguageModel;
			const env = yield* Environment.Service;

			// Pre-build layers for the agentic loop — captured once
			const modelLayer = Layer.succeed(LanguageModel.LanguageModel, lm);
			const envLayer = Layer.succeed(Environment.Service, env);

			const fromBlueprint = Effect.fn('AgentFactory.fromBlueprint')(
				function* (blueprint: AgentBlueprint) {
					const builtToolkit = yield* toolFactory
						.buildToolkit(blueprint.tools)
						.pipe(
							Effect.mapError(
								(cause) =>
									new AgentFactoryError({
										message: 'Failed to build toolkit',
										cause
									})
							)
						);

					const loopLayer = Layer.mergeAll(modelLayer, envLayer).pipe(
						Layer.provideMerge(builtToolkit.handlerLayer)
					);

					const runTask = Effect.fn('AgentRuntime.runTask')(
						function* (instruction: string) {
							// For now, all strategies use SingleLoop
							// TODO: implement PlanAndExecute, WithVerifier, FallbackModels
							if (blueprint.orchestration._tag !== 'SingleLoop') {
								yield* Effect.logWarning(
									`Orchestration '${blueprint.orchestration._tag}' not yet implemented, using SingleLoop`
								);
							}

							return yield* runSingleLoop(
								instruction,
								blueprint,
								builtToolkit,
								loopLayer,
								env
							);
						}
					);

					return {
						blueprint,
						runTask
					} satisfies AgentRuntime;
				}
			);

			return Service.of({ fromBlueprint });
		})
	);

	/**
	 * Create a test AgentFactory that returns mock AgentRuntime instances.
	 *
	 * @since 0.4.0
	 */
	export const test = (responses?: {
		readonly fromBlueprint?: (blueprint: AgentBlueprint) => AgentRuntime;
	}) =>
		Layer.succeed(
			Service,
			Service.of({
				fromBlueprint: (blueprint) =>
					Effect.sync(
						() =>
							responses?.fromBlueprint?.(blueprint) ?? {
								blueprint,
								runTask: () =>
									Effect.succeed(
										new AgentRunResult({
											trajectory:
												mockTrajectory(blueprint),
											metrics: new AgentMetrics({
												inputTokens: 0,
												outputTokens: 0,
												cachedTokens: 0,
												costUsd: Option.none(),
												durationMs: 0,
												numTurns: 0
											}),
											exitReason: 'completed',
											finalText:
												Option.some('mock result')
										})
									)
							}
					)
			})
		);
}

// =============================================================================
// Internal: SingleLoop strategy
// =============================================================================

/**
 * Run a single agentic loop — send instruction, call tools, iterate until
 * the agent returns a text response or hits the turn limit.
 *
 * All service dependencies are captured by the caller's closure. The
 * `loopLayer` provides `LanguageModel` and `Environment` (plus handler
 * services) to each `generateText` call. The `env` parameter is used
 * for sandbox preparation (mkdir, uploadFile) outside the loop.
 *
 * @internal
 */
const runSingleLoop = Effect.fn('AgentFactory.runSingleLoop')(function* (
	instruction: string,
	blueprint: AgentBlueprint,
	builtToolkit: BuiltToolkit,
	loopLayer: Layer.Layer<LanguageModel.LanguageModel | Environment.Service>,
	env: Environment.Interface
) {
	// Prepare sandbox
	yield* env.mkdir('/task').pipe(
		Effect.mapError(
			(cause) =>
				new AgentRunError({
					message: 'Failed to create /task directory',
					cause
				})
		)
	);
	yield* env
		.uploadFile({
			content: instruction,
			targetPath: '/task/instruction.md'
		})
		.pipe(
			Effect.mapError(
				(cause) =>
					new AgentRunError({
						message: 'Failed to upload instruction',
						cause
					})
			)
		);

	// Create chat session with system prompt from blueprint
	const session = yield* Chat.fromPrompt(
		Prompt.empty.pipe(Prompt.setSystem(blueprint.systemPrompt))
	);

	// Track state via Ref
	const stateRef = yield* Ref.make<LoopState>(initialLoopState);
	const startMs = yield* Clock.currentTimeMillis;

	// Agentic loop — recursive effect
	const step: Effect.Effect<void, AgentRunError> = Effect.gen(function* () {
		const state = yield* Ref.get(stateRef);
		if (
			state.turns >= blueprint.constraints.maxTurns ||
			Option.isSome(state.finalText)
		) {
			return;
		}

		const response = yield* generateWithToolkit(
			session,
			state.isFirstTurn ? instruction : [],
			builtToolkit,
			loopLayer
		).pipe(
			Effect.mapError(
				(cause) =>
					new AgentRunError({
						message: `Generation failed at turn ${state.turns + 1}`,
						cause
					})
			)
		);

		// Accumulate usage
		const inputDelta = response.usage.inputTokens?.total ?? 0;
		const outputDelta = response.usage.outputTokens?.total ?? 0;
		const done = response.toolCalls.length === 0;

		const nextState: LoopState = {
			turns: state.turns + 1,
			inputTokens: state.inputTokens + inputDelta,
			outputTokens: state.outputTokens + outputDelta,
			finalText: done ? Option.some(response.text) : Option.none(),
			isFirstTurn: false
		};

		yield* Ref.set(stateRef, nextState);

		// Continue if agent called tools
		if (!done && nextState.turns < blueprint.constraints.maxTurns) {
			yield* step;
		}
	});

	yield* step;

	// Build result
	const finalState = yield* Ref.get(stateRef);
	const endMs = yield* Clock.currentTimeMillis;
	const durationMs = Number(endMs - startMs);

	const exitReason: ExitReason =
		finalState.turns >= blueprint.constraints.maxTurns &&
		Option.isNone(finalState.finalText)
			? 'max_turns'
			: 'completed';

	// Convert history to trajectory
	const history = yield* Ref.get(session.history);
	const agentInfo = new AgentInfo({
		name: blueprint.name,
		version: blueprint.version,
		model_name: blueprint.model.modelName
	});
	const usageSnapshot = new UsageSnapshot({
		inputTokens: finalState.inputTokens,
		outputTokens: finalState.outputTokens,
		cachedTokens: 0
	});

	const sessionId = `session-${endMs}`;
	const conversionInput: EffectAiConversionInput = {
		history,
		agentInfo,
		sessionId,
		modelName: blueprint.model.modelName,
		usage: usageSnapshot,
		durationMs,
		numTurns: finalState.turns
	};

	const trajectory = yield* fromEffectAiHistory(conversionInput).pipe(
		Effect.mapError(
			(cause) =>
				new AgentRunError({
					message: 'Failed to convert trajectory',
					cause
				})
		)
	);

	const metrics = Option.getOrElse(
		extractMetrics(trajectory),
		() =>
			new AgentMetrics({
				inputTokens: finalState.inputTokens,
				outputTokens: finalState.outputTokens,
				cachedTokens: 0,
				costUsd: Option.none(),
				durationMs,
				numTurns: finalState.turns
			})
	);

	return new AgentRunResult({
		trajectory,
		metrics,
		exitReason,
		finalText: finalState.finalText
	});
});
