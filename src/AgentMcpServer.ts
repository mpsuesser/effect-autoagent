/**
 * Expose the optimized agent as an MCP (Model Context Protocol) server.
 *
 * Makes the agent available as a tool to other AI agents and clients
 * (such as Claude Desktop) via the standard MCP protocol. Uses Effect's
 * built-in McpServer module with Tool, Toolkit, and resource registration.
 *
 * @since 0.3.0
 */
import { Effect, Layer, Schema } from 'effect';
import * as Option from 'effect/Option';
import * as McpServer from 'effect/unstable/ai/McpServer';
import * as Tool from 'effect/unstable/ai/Tool';
import * as Toolkit from 'effect/unstable/ai/Toolkit';

import { BlueprintJson } from './AgentBlueprint.js';
import { AgentFactory } from './AgentFactory.js';
import { BlueprintStore } from './BlueprintStore.js';

// =============================================================================
// Tools
// =============================================================================

/**
 * Run the optimized agent on a task instruction.
 *
 * @since 0.3.0
 */
export const RunTask = Tool.make('RunTask', {
	description:
		'Run the optimized agent on a task instruction. Returns the agent result text.',
	parameters: Schema.Struct({
		instruction: Schema.String.annotate({
			description: 'The task instruction for the agent to execute.'
		})
	}),
	success: Schema.String,
	dependencies: [AgentFactory.Service, BlueprintStore.Service]
});

/**
 * Get the current agent blueprint configuration as JSON.
 *
 * @since 0.3.0
 */
export const GetBlueprint = Tool.make('GetBlueprint', {
	description: 'Get the current agent blueprint configuration as JSON.',
	success: Schema.String,
	dependencies: [BlueprintStore.Service]
});

// =============================================================================
// Toolkit
// =============================================================================

/**
 * Combined toolkit exposing both RunTask and GetBlueprint tools.
 *
 * @since 0.3.0
 */
export const AgentMcpToolkit = Toolkit.make(RunTask, GetBlueprint);

// =============================================================================
// Toolkit Layer (handlers)
// =============================================================================

/** @internal */
const AgentMcpToolkitLayer = AgentMcpToolkit.toLayer({
	RunTask: ({ instruction }) =>
		Effect.gen(function* () {
			const factory = yield* AgentFactory.Service;
			const store = yield* BlueprintStore.Service;
			const blueprint = yield* store.current.pipe(Effect.orDie);
			const runtime = yield* factory
				.fromBlueprint(blueprint)
				.pipe(Effect.orDie);
			const result = yield* runtime
				.runTask(instruction)
				.pipe(Effect.orDie);
			return Option.getOrElse(
				result.finalText,
				() => `Task ${result.exitReason}`
			);
		}),
	GetBlueprint: () =>
		Effect.gen(function* () {
			const store = yield* BlueprintStore.Service;
			const blueprint = yield* store.current.pipe(Effect.orDie);
			return yield* Schema.encodeEffect(BlueprintJson)(blueprint).pipe(
				Effect.orDie
			);
		})
});

// =============================================================================
// Blueprint Resource
// =============================================================================

/**
 * MCP resource exposing the current agent blueprint as JSON.
 *
 * @since 0.3.0
 */
export const BlueprintResource = McpServer.resource({
	uri: 'autoagent://blueprint',
	name: 'Agent Blueprint',
	description: 'The current agent blueprint configuration.',
	mimeType: 'application/json',
	content: Effect.gen(function* () {
		const store = yield* BlueprintStore.Service;
		const blueprint = yield* store.current.pipe(Effect.orDie);
		return yield* Schema.encodeEffect(BlueprintJson)(blueprint).pipe(
			Effect.orDie
		);
	})
});

// =============================================================================
// Server Layers
// =============================================================================

/**
 * MCP server layer exposing the agent as tools and resources.
 * Requires AgentFactory.Service, BlueprintStore.Service, and a stdio transport.
 *
 * @since 0.3.0
 */
export const AgentMcpLayer = Layer.mergeAll(
	BlueprintResource,
	McpServer.toolkit(AgentMcpToolkit).pipe(
		Layer.provideMerge(AgentMcpToolkitLayer)
	)
);

/**
 * Complete MCP server with stdio transport.
 * Provide AgentFactory.Service and BlueprintStore.Service.
 *
 * @since 0.3.0
 */
export const AgentMcpStdioLayer = AgentMcpLayer.pipe(
	Layer.provide(
		McpServer.layerStdio({
			name: 'effect-autoagent',
			version: '0.3.0'
		})
	)
);
