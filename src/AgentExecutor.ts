/**
 * Agent executor service — the agentic loop.
 *
 * Runs an LLM agent against a task instruction in a sandbox container,
 * using Effect AI's `Chat` module for automatic conversation history
 * management and tool resolution.
 *
 * @since 0.2.0
 */
import { Clock, Effect, Layer, Ref, ServiceMap } from 'effect';
import * as Option from 'effect/Option';
import { Chat, LanguageModel, Prompt } from 'effect/unstable/ai';

import { AgentInfo } from './Atif.js';
import { AgentRunResult, type ExitReason } from './AgentRunResult.js';
import { AgentConfigService } from './AgentRunner.js';
import { AgentRunError } from './Errors.js';
import { Environment } from './Environment.js';
import {
	type EffectAiConversionInput,
	fromEffectAiHistory
} from './EffectAiConverter.js';
import { AgentMetrics, extractMetrics } from './Metrics.js';
import { AgentTools, AgentToolsLayer } from './AgentToolkit.js';
import { UsageSnapshot } from './UsageMetrics.js';

// =============================================================================
// Internal: loop state tracked via Ref
// =============================================================================

interface LoopState {
	readonly turns: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly exitReason: ExitReason;
	readonly finalText: Option.Option<string>;
	readonly isFirstTurn: boolean;
}

const initialLoopState: LoopState = {
	turns: 0,
	inputTokens: 0,
	outputTokens: 0,
	exitReason: 'completed',
	finalText: Option.none(),
	isFirstTurn: true
};

// =============================================================================
// Service
// =============================================================================

/**
 * Agent executor that runs the agentic loop against a task instruction.
 *
 * @since 0.2.0
 */
export namespace AgentExecutor {
	export interface Interface {
		/**
		 * Run an agent against a task instruction. Returns the full
		 * execution result including ATIF trajectory and metrics.
		 *
		 * @since 0.2.0
		 */
		readonly runTask: (
			instruction: string
		) => Effect.Effect<AgentRunResult, AgentRunError>;
	}

	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/AgentExecutor'
	) {}

	/**
	 * Layer that provides the AgentExecutor. Requires:
	 * - `LanguageModel.LanguageModel` — the LLM provider
	 * - `Environment.Service` — the sandbox container
	 * - `AgentConfigService.Service` (optional, falls back to defaults)
	 *
	 * @since 0.2.0
	 */
	export const layer = Layer.effect(
		Service,
		Effect.gen(function* () {
			const lm = yield* LanguageModel.LanguageModel;
			const env = yield* Environment.Service;
			const configOption = yield* Effect.serviceOption(
				AgentConfigService.Service
			);
			const cfg = Option.getOrElse(
				configOption,
				() => AgentConfigService.defaults
			);

			const agentInfo = new AgentInfo({
				name: cfg.name,
				version: cfg.version,
				model_name: cfg.model
			});

			// Pre-build layers for the agentic loop
			const modelLayer = Layer.succeed(LanguageModel.LanguageModel, lm);
			const envLayer = Layer.succeed(Environment.Service, env);

			const runTask = Effect.fn('AgentExecutor.runTask')(function* (
				instruction: string
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

				// Create chat session
				const systemPrompt = 'You are an agent that executes tasks';
				const session = yield* Chat.fromPrompt(
					Prompt.empty.pipe(Prompt.setSystem(systemPrompt))
				);

				// Track metrics via Ref for fiber safety
				const stateRef = yield* Ref.make<LoopState>(initialLoopState);
				const startMs = yield* Clock.currentTimeMillis;

				// Provide all required layers in a single merged layer
				const loopLayer = Layer.mergeAll(modelLayer, envLayer).pipe(
					Layer.provideMerge(AgentToolsLayer)
				);

				// Agentic loop — recursive effect
				const step: Effect.Effect<void, AgentRunError> = Effect.gen(
					function* () {
						const state = yield* Ref.get(stateRef);
						if (
							state.turns >= cfg.maxTurns ||
							Option.isSome(state.finalText)
						) {
							return;
						}

						const response = yield* session
							.generateText({
								prompt: state.isFirstTurn ? instruction : [],
								toolkit: AgentTools
							})
							.pipe(
								Effect.provide(loopLayer),
								Effect.mapError(
									(cause) =>
										new AgentRunError({
											message: `Generation failed at turn ${state.turns + 1}`,
											cause
										})
								)
							);

						// Accumulate usage
						const inputDelta =
							response.usage.inputTokens?.total ?? 0;
						const outputDelta =
							response.usage.outputTokens?.total ?? 0;

						const done = response.toolCalls.length === 0;

						const nextState: LoopState = {
							turns: state.turns + 1,
							inputTokens: state.inputTokens + inputDelta,
							outputTokens: state.outputTokens + outputDelta,
							exitReason: 'completed',
							finalText: done
								? Option.some(response.text)
								: Option.none(),
							isFirstTurn: false
						};

						yield* Ref.set(stateRef, nextState);

						// Continue if agent called tools
						if (!done && nextState.turns < cfg.maxTurns) {
							yield* step;
						}
					}
				);

				yield* step;

				const finalState = yield* Ref.get(stateRef);
				const endMs = yield* Clock.currentTimeMillis;
				const durationMs = Number(endMs - startMs);

				const exitReason: ExitReason =
					finalState.turns >= cfg.maxTurns &&
					Option.isNone(finalState.finalText)
						? 'max_turns'
						: 'completed';

				// Build trajectory from conversation history
				const history = yield* Ref.get(session.history);
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
					modelName: cfg.model,
					usage: usageSnapshot,
					durationMs,
					numTurns: finalState.turns
				};

				const trajectory = yield* fromEffectAiHistory(
					conversionInput
				).pipe(
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

			return Service.of({ runTask });
		})
	);

	/**
	 * Default layer with built-in config defaults.
	 *
	 * Still requires `LanguageModel.LanguageModel` and
	 * `Environment.Service` from the consumer.
	 *
	 * @since 0.2.0
	 */
	export const defaultLayer = Layer.unwrap(
		Effect.sync(() =>
			layer.pipe(Layer.provide(AgentConfigService.defaultLayer))
		)
	);
}
