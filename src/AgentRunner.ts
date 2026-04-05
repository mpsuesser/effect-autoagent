/**
 * Agent runner service that orchestrates task execution.
 *
 * Handles the lifecycle of running an agent against a task instruction:
 * uploading the instruction, executing the agent, measuring duration,
 * and producing an ATIF trajectory.
 *
 * @since 0.1.0
 */
import { Effect, Layer, ServiceMap } from 'effect';
import * as Option from 'effect/Option';

import { AgentInfo, type AtifTrajectory } from './Atif.js';
import { AgentRunError } from './Errors.js';
import { Environment } from './Environment.js';
import {
	type ClaudeConversionInput,
	type OpenAiConversionInput,
	fromClaudeMessages,
	fromOpenAiItems
} from './TrajectoryConverter.js';

// =============================================================================
// Agent Config Service (runtime configuration)
// =============================================================================

/**
 * Runtime agent configuration service. Provides the agent's identity
 * and operational parameters. When not provided to the runner, sensible
 * defaults are used.
 *
 * @since 0.1.0
 */
export namespace AgentConfigService {
	export interface Interface {
		readonly name: string;
		readonly version: string;
		readonly model: string;
		readonly maxTurns: number;
		readonly shellTimeoutSec: number;
		readonly containerTimeoutSec: number;
	}

	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/AgentConfig'
	) {}

	/**
	 * Default configuration values matching the Python `agent.py`.
	 *
	 * @since 0.1.0
	 */
	export const defaults: Interface = {
		name: 'autoagent',
		version: '0.1.0',
		model: 'gpt-5',
		maxTurns: 30,
		shellTimeoutSec: 120,
		containerTimeoutSec: 600
	};

	/**
	 * Layer providing the default configuration.
	 *
	 * @since 0.1.0
	 */
	export const defaultLayer = Layer.succeed(Service, Service.of(defaults));
}

// =============================================================================
// Agent Runner Service
// =============================================================================

/**
 * Orchestrates the execution of an agent against a task instruction
 * within a sandbox environment.
 *
 * @since 0.1.0
 */
export namespace AgentRunner {
	export interface Interface {
		/**
		 * Prepare the sandbox environment for a task by creating the
		 * required directory structure and uploading the instruction.
		 *
		 * @since 0.1.0
		 */
		readonly prepareTask: (
			instruction: string
		) => Effect.Effect<void, AgentRunError>;

		/**
		 * Convert an OpenAI-style run into an ATIF trajectory.
		 *
		 * The caller provides the raw SDK items and response usages
		 * obtained from running the OpenAI agent.
		 *
		 * @since 0.1.0
		 */
		readonly recordOpenAiRun: (
			input: Omit<OpenAiConversionInput, 'agentInfo'>
		) => Effect.Effect<AtifTrajectory, AgentRunError>;

		/**
		 * Convert a Claude-style run into an ATIF trajectory.
		 *
		 * The caller provides the raw SDK messages obtained from running
		 * the Claude agent.
		 *
		 * @since 0.1.0
		 */
		readonly recordClaudeRun: (
			input: Omit<ClaudeConversionInput, 'agentInfo'>
		) => Effect.Effect<AtifTrajectory, AgentRunError>;
	}

	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/AgentRunner'
	) {}

	export const layer = Layer.effect(
		Service,
		Effect.gen(function* () {
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

			const prepareTask = Effect.fn('AgentRunner.prepareTask')(function* (
				instruction: string
			) {
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
			});

			const recordOpenAiRun = Effect.fn('AgentRunner.recordOpenAiRun')(
				function* (input: Omit<OpenAiConversionInput, 'agentInfo'>) {
					return yield* fromOpenAiItems({
						...input,
						agentInfo
					}).pipe(
						Effect.mapError(
							(cause) =>
								new AgentRunError({
									message:
										'Failed to convert OpenAI trajectory',
									cause
								})
						)
					);
				}
			);

			const recordClaudeRun = Effect.fn('AgentRunner.recordClaudeRun')(
				function* (input: Omit<ClaudeConversionInput, 'agentInfo'>) {
					return yield* fromClaudeMessages({
						...input,
						agentInfo
					}).pipe(
						Effect.mapError(
							(cause) =>
								new AgentRunError({
									message:
										'Failed to convert Claude trajectory',
									cause
								})
						)
					);
				}
			);

			return Service.of({
				prepareTask,
				recordOpenAiRun,
				recordClaudeRun
			});
		})
	);

	export const defaultLayer = Layer.unwrap(
		Effect.sync(() =>
			layer.pipe(Layer.provide(AgentConfigService.defaultLayer))
		)
	);
}
