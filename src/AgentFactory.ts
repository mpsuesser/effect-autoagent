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
import { Clock, Effect, Layer, Match, Ref, ServiceMap } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';
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
import type {
	FallbackModels,
	PlanAndExecute,
	WithVerifier
} from './OrchestrationSpec.js';
import { anthropicModel, openAiModel } from './Providers.js';
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
						function* (
							instruction: string
						): Generator<
							Effect.Effect<AgentRunResult, AgentRunError>,
							AgentRunResult,
							AgentRunResult
						> {
							return yield* Match.value(
								blueprint.orchestration
							).pipe(
								Match.tag('SingleLoop', () =>
									runSingleLoop(
										instruction,
										blueprint,
										builtToolkit,
										loopLayer,
										env
									)
								),
								Match.tag('PlanAndExecute', (spec) =>
									runPlanAndExecute(
										instruction,
										blueprint,
										builtToolkit,
										loopLayer,
										env,
										lm,
										spec
									)
								),
								Match.tag('WithVerifier', (spec) =>
									runWithVerifier(
										instruction,
										blueprint,
										builtToolkit,
										loopLayer,
										env,
										lm,
										spec
									)
								),
								Match.tag('FallbackModels', (spec) =>
									runFallbackModels(
										instruction,
										blueprint,
										builtToolkit,
										env,
										spec
									)
								),
								Match.exhaustive
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

// =============================================================================
// Internal: PlanAndExecute strategy
// =============================================================================

/**
 * Schema for the planner's structured output — an ordered list of
 * action steps the executor should carry out sequentially.
 *
 * @internal
 */
class PlanSteps extends Schema.Class<PlanSteps>('PlanSteps')(
	{
		steps: Schema.Array(Schema.String).annotate({
			description:
				'Ordered list of concrete action steps to accomplish the task.'
		})
	},
	{
		description:
			'Structured plan output containing ordered steps for task execution.'
	}
) {}

/**
 * Accumulated state for plan-and-execute step reduction.
 *
 * @internal
 */
interface PlanAccumulator {
	readonly lastResult: Option.Option<AgentRunResult>;
	readonly totalInputTokens: number;
	readonly totalOutputTokens: number;
	readonly totalTurns: number;
}

/** @internal */
const initialPlanAccumulator: PlanAccumulator = {
	lastResult: Option.none(),
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalTurns: 0
};

/**
 * Two-phase plan-and-execute strategy.
 *
 * Phase 1: A planner LLM call produces a structured list of steps using
 * `generateObject` with the `PlanSteps` schema.
 *
 * Phase 2: Each step is executed sequentially via `Effect.reduce`,
 * accumulating metrics and carrying context between steps.
 *
 * @internal
 */
const runPlanAndExecute = Effect.fn('AgentFactory.planAndExecute')(function* (
	instruction: string,
	blueprint: AgentBlueprint,
	builtToolkit: BuiltToolkit,
	loopLayer: Layer.Layer<LanguageModel.LanguageModel | Environment.Service>,
	env: Environment.Interface,
	lm: LanguageModel.Service,
	spec: PlanAndExecute
) {
	yield* Effect.logInfo('PlanAndExecute: generating plan');

	// Phase 1: Generate plan via structured output
	const planResponse = yield* lm
		.generateObject({
			prompt: [
				{
					role: 'system',
					content: spec.plannerPrompt
				},
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `Break this task into at most ${spec.maxPlanSteps} concrete, sequential steps:\n\n${instruction}`
						}
					]
				}
			],
			schema: PlanSteps
		})
		.pipe(
			Effect.mapError(
				(cause) =>
					new AgentRunError({
						message: 'Plan generation failed',
						cause
					})
			),
			Effect.provide(loopLayer)
		);

	const steps = Arr.take(planResponse.value.steps, spec.maxPlanSteps);
	const totalSteps = Arr.length(steps);

	yield* Effect.logInfo(`PlanAndExecute: executing ${totalSteps} steps`);

	// Phase 2: Execute steps sequentially via reduce, accumulating metrics
	const startMs = yield* Clock.currentTimeMillis;

	const indexedSteps = Arr.map(steps, (step, index) => ({
		step,
		index
	}));

	const accRef = yield* Ref.make<PlanAccumulator>(initialPlanAccumulator);

	yield* Effect.forEach(
		indexedSteps,
		({ step, index }) =>
			Effect.gen(function* () {
				const acc = yield* Ref.get(accRef);
				const prevOutput = Option.map(acc.lastResult, (r) =>
					Option.getOrElse(r.finalText, () => '(no output)')
				);

				const stepInstruction = Option.match(prevOutput, {
					onNone: () =>
						`Step ${index + 1}/${totalSteps}: ${step}\n\nOriginal task: ${instruction}`,
					onSome: (prev) =>
						`Step ${index + 1}/${totalSteps}: ${step}\n\nOriginal task: ${instruction}\n\nPrevious step output: ${prev}`
				});

				yield* Effect.logDebug(
					`PlanAndExecute: step ${index + 1}`,
					step
				);

				const stepResult = yield* runSingleLoop(
					stepInstruction,
					blueprint,
					builtToolkit,
					loopLayer,
					env
				);

				yield* Ref.set(accRef, {
					lastResult: Option.some(stepResult),
					totalInputTokens:
						acc.totalInputTokens + stepResult.metrics.inputTokens,
					totalOutputTokens:
						acc.totalOutputTokens + stepResult.metrics.outputTokens,
					totalTurns: acc.totalTurns + stepResult.metrics.numTurns
				});
			}),
		{ concurrency: 1 }
	);

	const accumulated = yield* Ref.get(accRef);

	const endMs = yield* Clock.currentTimeMillis;
	const durationMs = Number(endMs - startMs);

	const aggregatedMetrics = new AgentMetrics({
		inputTokens: accumulated.totalInputTokens,
		outputTokens: accumulated.totalOutputTokens,
		cachedTokens: 0,
		costUsd: Option.none(),
		durationMs,
		numTurns: accumulated.totalTurns
	});

	return new AgentRunResult({
		trajectory: Option.match(accumulated.lastResult, {
			onNone: () => mockTrajectory(blueprint),
			onSome: (r) => r.trajectory
		}),
		metrics: aggregatedMetrics,
		exitReason: Option.match(accumulated.lastResult, {
			onNone: () => 'completed' satisfies ExitReason,
			onSome: (r) => r.exitReason
		}),
		finalText: Option.flatMap(accumulated.lastResult, (r) => r.finalText)
	});
});

// =============================================================================
// Internal: WithVerifier strategy
// =============================================================================

/**
 * Accumulated state for the verify-and-retry loop.
 *
 * @internal
 */
interface VerifierAccumulator {
	readonly result: AgentRunResult;
	readonly instruction: string;
	readonly passed: boolean;
}

/**
 * Verify-and-retry strategy.
 *
 * Runs the agent via `SingleLoop`, then sends the result to a verifier
 * LLM call. If the verifier responds with "PASS", the result is returned.
 * If "FAIL", the agent is re-run with the verifier's feedback appended,
 * up to `maxRetries` times.
 *
 * Uses `Ref`-based state for the retry loop to avoid mutable `let` bindings.
 *
 * @internal
 */
const runWithVerifier = Effect.fn('AgentFactory.withVerifier')(function* (
	instruction: string,
	blueprint: AgentBlueprint,
	builtToolkit: BuiltToolkit,
	loopLayer: Layer.Layer<LanguageModel.LanguageModel | Environment.Service>,
	env: Environment.Interface,
	lm: LanguageModel.Service,
	spec: WithVerifier
) {
	// Run first attempt
	yield* Effect.logInfo(`WithVerifier: attempt 1/${spec.maxRetries + 1}`);

	const firstResult = yield* runSingleLoop(
		instruction,
		blueprint,
		builtToolkit,
		loopLayer,
		env
	);

	// Build retry attempts array [0..maxRetries-1] for reduce
	const retryAttempts = Arr.makeBy(spec.maxRetries, (i) => i);

	const stateRef = yield* Ref.make<VerifierAccumulator>({
		result: firstResult,
		instruction,
		passed: false
	});

	// Verify and optionally retry
	const verify = (
		result: AgentRunResult
	): Effect.Effect<boolean, AgentRunError> =>
		Effect.gen(function* () {
			const resultText = Option.getOrElse(
				result.finalText,
				() => `Agent exited with: ${result.exitReason}`
			);

			yield* Effect.logDebug('WithVerifier: verifying result');
			const verifyResponse = yield* lm
				.generateText({
					prompt: [
						{
							role: 'system',
							content: spec.verifierPrompt
						},
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: `Task: ${instruction}\n\nAgent output:\n${resultText}\n\nDoes this output correctly accomplish the task? Reply with PASS or FAIL followed by a brief explanation.`
								}
							]
						}
					]
				})
				.pipe(
					Effect.mapError(
						(cause) =>
							new AgentRunError({
								message: 'Verification failed',
								cause
							})
					),
					Effect.provide(loopLayer)
				);

			const verdict = verifyResponse.text;
			const passed = Str.toUpperCase(verdict).startsWith('PASS');

			yield* Effect.logInfo(
				`WithVerifier: verdict=${passed ? 'PASS' : 'FAIL'}`
			);

			// Update state with feedback for potential retry
			if (!passed) {
				yield* Ref.set(stateRef, {
					result,
					instruction: `${instruction}\n\nPrevious attempt failed verification. Verifier feedback:\n${verdict}\n\nPlease try again, addressing the feedback above.`,
					passed: false
				});
			} else {
				yield* Ref.set(stateRef, { result, instruction, passed: true });
			}

			return passed;
		});

	// Verify first attempt
	const firstPassed = yield* verify(firstResult);
	if (firstPassed) {
		return firstResult;
	}

	// Retry loop — short-circuits via Ref state on pass
	yield* Effect.forEach(
		retryAttempts,
		(attemptIdx) =>
			Effect.gen(function* () {
				const state = yield* Ref.get(stateRef);
				if (state.passed) return;

				yield* Effect.logInfo(
					`WithVerifier: attempt ${attemptIdx + 2}/${spec.maxRetries + 1}`
				);

				const retryResult = yield* runSingleLoop(
					state.instruction,
					blueprint,
					builtToolkit,
					loopLayer,
					env
				);

				yield* verify(retryResult);
			}),
		{ concurrency: 1 }
	);

	const finalState = yield* Ref.get(stateRef);
	if (!finalState.passed) {
		yield* Effect.logWarning(
			'WithVerifier: all retries exhausted, returning last result'
		);
	}
	return finalState.result;
});

// =============================================================================
// Internal: FallbackModels strategy
// =============================================================================

/**
 * Infer the provider from a model name using prefix heuristics.
 *
 * - `claude-*` → Anthropic
 * - Everything else → OpenAI (safest fallback for unknown models)
 *
 * @internal
 */
const inferProvider = (modelName: string): 'openai' | 'anthropic' =>
	Match.value(modelName).pipe(
		Match.when(Str.startsWith('claude'), () => 'anthropic' as const),
		Match.orElse(() => 'openai' as const)
	);

/**
 * Model fallback strategy.
 *
 * Tries each model in the spec's `models` array in order. If the agent
 * run fails with an `AgentRunError`, the next model is tried. The first
 * successful result is returned. If all models fail, the last error is
 * propagated.
 *
 * Each model gets a fresh `LanguageModel` layer constructed by inferring
 * the provider from the model name.
 *
 * Uses `Effect.reduce` with `Option`-based accumulation — no mutable state.
 *
 * @internal
 */
const runFallbackModels = Effect.fn('AgentFactory.fallbackModels')(function* (
	instruction: string,
	blueprint: AgentBlueprint,
	builtToolkit: BuiltToolkit,
	env: Environment.Interface,
	spec: FallbackModels
) {
	const envLayer = Layer.succeed(Environment.Service, env);

	/** Try a single model, returning Some(result) on success, None on failure. */
	const tryModel = (
		modelName: string
	): Effect.Effect<Option.Option<AgentRunResult>> =>
		Effect.gen(function* () {
			yield* Effect.logInfo(
				`FallbackModels: trying model '${modelName}'`
			);

			const provider = inferProvider(modelName);
			// ConfigError from API key lookup is unrecoverable — orDie per EF-31
			const modelLayer = Layer.orDie(
				provider === 'openai'
					? openAiModel(modelName)
					: anthropicModel(modelName)
			);

			const loopLayer = Layer.mergeAll(modelLayer, envLayer).pipe(
				Layer.provideMerge(builtToolkit.handlerLayer)
			);

			return yield* runSingleLoop(
				instruction,
				blueprint,
				builtToolkit,
				loopLayer,
				env
			).pipe(
				Effect.map(Option.some),
				Effect.catchTag('AgentRunError', (error) => {
					return Effect.gen(function* () {
						yield* Effect.logWarning(
							`FallbackModels: model '${modelName}' failed: ${error.message}`
						);
						return Option.none<AgentRunResult>();
					});
				})
			);
		});

	// Reduce over models, short-circuiting on first success
	const result = yield* Arr.reduce(
		Array.from(spec.models),
		Effect.succeed(Option.none<AgentRunResult>()),
		(prevEffect, modelName) =>
			Effect.flatMap(prevEffect, (prev) =>
				Option.match(prev, {
					onSome: (r) => Effect.succeed(Option.some(r)),
					onNone: () => tryModel(modelName)
				})
			)
	);

	return yield* Option.match(result, {
		onSome: (r) => {
			return Effect.succeed(r);
		},
		onNone: () =>
			Effect.fail(
				new AgentRunError({
					message: 'All fallback models failed'
				})
			)
	});
});
