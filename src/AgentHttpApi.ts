/**
 * HTTP API definition for the optimized agent.
 *
 * Schema-first endpoint definitions using Effect's HttpApi module,
 * enabling deployment as a REST service with auto-generated OpenAPI
 * docs and type-safe clients.
 *
 * @since 0.5.0
 */
import { Effect } from 'effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import {
	HttpApi,
	HttpApiBuilder,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
	OpenApi
} from 'effect/unstable/httpapi';

import { AgentBlueprint } from './AgentBlueprint.js';
import { AgentFactory } from './AgentFactory.js';
import { BlueprintStore } from './BlueprintStore.js';

// =============================================================================
// Error
// =============================================================================

/**
 * HTTP API error for agent operations.
 *
 * @since 0.5.0
 */
export class AgentHttpError extends Schema.TaggedErrorClass<AgentHttpError>()(
	'AgentHttpError',
	{ message: Schema.String },
	{ httpApiStatus: 500, description: 'Agent HTTP API error.' }
) {}

// =============================================================================
// Response Schemas
// =============================================================================

/**
 * Simplified metrics for the HTTP API response.
 *
 * @since 0.5.0
 */
export class RunTaskMetrics extends Schema.Class<RunTaskMetrics>(
	'RunTaskMetrics'
)(
	{
		inputTokens: Schema.Number,
		outputTokens: Schema.Number,
		durationMs: Schema.Number,
		numTurns: Schema.Number
	},
	{ description: 'Simplified metrics for the HTTP API response.' }
) {}

/**
 * Response from running a task via the HTTP API.
 *
 * @since 0.5.0
 */
export class RunTaskResponse extends Schema.Class<RunTaskResponse>(
	'RunTaskResponse'
)(
	{
		exitReason: Schema.String,
		finalText: Schema.String,
		metrics: RunTaskMetrics
	},
	{ description: 'Response from running a task via the HTTP API.' }
) {}

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Payload for the run-task endpoint.
 *
 * @since 0.5.0
 */
export class RunTaskPayload extends Schema.Class<RunTaskPayload>(
	'RunTaskPayload'
)(
	{ instruction: Schema.String },
	{ description: 'Payload for running a task via the HTTP API.' }
) {}

// =============================================================================
// API Group + API Definition
// =============================================================================

/**
 * Agent API group with run, blueprint, and health endpoints.
 *
 * @since 0.5.0
 */
export class AgentApiGroup extends HttpApiGroup.make('agent')
	.add(
		HttpApiEndpoint.post('runTask', '/run', {
			payload: RunTaskPayload,
			success: RunTaskResponse,
			error: AgentHttpError
		}),
		HttpApiEndpoint.get('getBlueprint', '/blueprint', {
			success: AgentBlueprint,
			error: AgentHttpError
		}),
		HttpApiEndpoint.put('updateBlueprint', '/blueprint', {
			payload: AgentBlueprint,
			success: AgentBlueprint,
			error: AgentHttpError
		}),
		HttpApiEndpoint.get('health', '/health', {
			success: HttpApiSchema.NoContent
		})
	)
	.prefix('/api')
	.annotateMerge(
		OpenApi.annotations({
			title: 'Agent API',
			description: 'API for running tasks and managing agent blueprints.'
		})
	) {}

/**
 * Top-level HTTP API for the effect-autoagent framework.
 *
 * @since 0.5.0
 */
export class AgentApi extends HttpApi.make('autoagent-api')
	.add(AgentApiGroup)
	.annotateMerge(
		OpenApi.annotations({
			title: 'effect-autoagent API',
			description: 'HTTP API for the effect-autoagent framework.'
		})
	) {}

// =============================================================================
// Handler Layer
// =============================================================================

/**
 * Handler implementation layer for the Agent API group.
 *
 * Requires `AgentFactory.Service` and `BlueprintStore.Service` to be
 * provided. Implements all endpoints in the `agent` group.
 *
 * @since 0.5.0
 */
export const AgentApiHandlers = HttpApiBuilder.group(
	AgentApi,
	'agent',
	Effect.fn(function* (handlers) {
		const agentFactory = yield* AgentFactory.Service;
		const blueprintStore = yield* BlueprintStore.Service;

		return handlers
			.handle('runTask', ({ payload }) =>
				Effect.gen(function* () {
					const blueprint = yield* blueprintStore.current.pipe(
						Effect.orDie
					);
					const runtime = yield* agentFactory
						.fromBlueprint(blueprint)
						.pipe(Effect.orDie);
					const result = yield* runtime
						.runTask(payload.instruction)
						.pipe(
							Effect.mapError(
								(e) =>
									new AgentHttpError({
										message: e.message
									})
							)
						);
					return new RunTaskResponse({
						exitReason: result.exitReason,
						finalText: Option.getOrElse(
							result.finalText,
							() => result.exitReason
						),
						metrics: new RunTaskMetrics({
							inputTokens: result.metrics.inputTokens,
							outputTokens: result.metrics.outputTokens,
							durationMs: result.metrics.durationMs,
							numTurns: result.metrics.numTurns
						})
					});
				})
			)
			.handle('getBlueprint', () =>
				blueprintStore.current.pipe(
					Effect.mapError(
						(e) => new AgentHttpError({ message: e.message })
					)
				)
			)
			.handle('updateBlueprint', ({ payload }) =>
				Effect.gen(function* () {
					yield* blueprintStore
						.save(payload)
						.pipe(
							Effect.mapError(
								(e) =>
									new AgentHttpError({ message: e.message })
							)
						);
					return payload;
				})
			)
			.handle('health', () => Effect.void);
	})
);
