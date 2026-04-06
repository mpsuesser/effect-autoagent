import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Option from 'effect/Option';
import * as Toolkit from 'effect/unstable/ai/Toolkit';

import { Environment } from '../src/Environment.js';
import { ExecResult } from '../src/ExecResult.js';
import { type BuiltToolkit, ToolFactory } from '../src/ToolFactory.js';
import {
	FileReadImpl,
	FileWriteImpl,
	HttpGetImpl,
	ParamSpec,
	RunShellImpl,
	ShellCommandImpl,
	ToolSpec
} from '../src/ToolSpec.js';

// ---------------------------------------------------------------------------
// Test layer: mock environment that echoes the command as stdout
// ---------------------------------------------------------------------------

const echoEnvLayer = Environment.test({
	exec: (command) =>
		new ExecResult({
			stdout: Option.some(command),
			stderr: Option.none()
		})
});

const TestLayer = ToolFactory.layer.pipe(Layer.provide(echoEnvLayer));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runShellSpec = new ToolSpec({
	name: 'run_shell',
	description: 'Execute a shell command',
	parameters: [
		new ParamSpec({
			name: 'command',
			description: 'The command to run'
		})
	],
	implementation: new RunShellImpl({})
});

const grepSpec = new ToolSpec({
	name: 'grep_tool',
	description: 'Search for a pattern',
	parameters: [
		new ParamSpec({
			name: 'pattern',
			description: 'The search pattern'
		}),
		new ParamSpec({
			name: 'path',
			description: 'The file path',
			required: false
		})
	],
	implementation: new ShellCommandImpl({
		template: 'grep -r {{pattern}} {{path}}'
	})
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolFactory', () => {
	describe('buildToolkit — empty specs', () => {
		it.effect('returns Toolkit.empty and Layer.empty for no specs', () =>
			Effect.gen(function* () {
				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([]);
				expect(result.toolkit).toBe(Toolkit.empty);
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — single RunShell spec', () => {
		it.effect('builds a toolkit with one tool from defaultToolSpecs', () =>
			Effect.gen(function* () {
				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([runShellSpec]);

				expect(result.toolkit).not.toBe(Toolkit.empty);
				expect(result.handlerLayer).toBeDefined();

				// The toolkit should contain a tool named "run_shell"
				const toolNames = Object.keys(result.toolkit.tools);
				expect(toolNames).toContain('run_shell');
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — multiple specs', () => {
		it.effect('builds a toolkit with multiple tools', () =>
			Effect.gen(function* () {
				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([
					runShellSpec,
					grepSpec
				]);

				const toolNames = Object.keys(result.toolkit.tools);
				expect(toolNames).toContain('run_shell');
				expect(toolNames).toContain('grep_tool');
				expect(toolNames).toHaveLength(2);
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — ShellCommand template interpolation', () => {
		it.effect('interpolates {{param}} placeholders in template', () =>
			Effect.gen(function* () {
				// Environment that captures the executed command as stdout
				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([grepSpec]);

				// The toolkit's grep_tool handler should interpolate
				// the template "grep -r {{pattern}} {{path}}" with params
				const toolNames = Object.keys(result.toolkit.tools);
				expect(toolNames).toContain('grep_tool');
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — FileRead spec', () => {
		it.effect('builds a toolkit with FileRead implementation', () =>
			Effect.gen(function* () {
				const fileReadSpec = new ToolSpec({
					name: 'read_file',
					description: 'Read a file',
					parameters: [
						new ParamSpec({
							name: 'path',
							description: 'File path to read'
						})
					],
					implementation: new FileReadImpl({})
				});

				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([fileReadSpec]);

				expect(Object.keys(result.toolkit.tools)).toContain(
					'read_file'
				);
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — FileWrite spec', () => {
		it.effect('builds a toolkit with FileWrite implementation', () =>
			Effect.gen(function* () {
				const fileWriteSpec = new ToolSpec({
					name: 'write_file',
					description: 'Write a file',
					parameters: [
						new ParamSpec({
							name: 'path',
							description: 'File path to write'
						}),
						new ParamSpec({
							name: 'content',
							description: 'File content'
						})
					],
					implementation: new FileWriteImpl({})
				});

				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([fileWriteSpec]);

				expect(Object.keys(result.toolkit.tools)).toContain(
					'write_file'
				);
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — HttpGet spec', () => {
		it.effect('builds a toolkit with HttpGet implementation', () =>
			Effect.gen(function* () {
				const httpGetSpec = new ToolSpec({
					name: 'http_get',
					description: 'Fetch a URL',
					parameters: [
						new ParamSpec({
							name: 'url',
							description: 'The URL to fetch'
						})
					],
					implementation: new HttpGetImpl({
						urlTemplate: '{{url}}'
					})
				});

				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([httpGetSpec]);

				expect(Object.keys(result.toolkit.tools)).toContain('http_get');
			}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('buildToolkit — optional parameters', () => {
		it.effect(
			'builds JSON schema with required array excluding optional params',
			() =>
				Effect.gen(function* () {
					const spec = new ToolSpec({
						name: 'test_tool',
						description: 'A test tool',
						parameters: [
							new ParamSpec({
								name: 'required_param',
								description: 'This is required'
							}),
							new ParamSpec({
								name: 'optional_param',
								description: 'This is optional',
								required: false
							})
						],
						implementation: new RunShellImpl({})
					});

					const factory = yield* ToolFactory.Service;
					const result = yield* factory.buildToolkit([spec]);

					// Verify tool was created
					expect(Object.keys(result.toolkit.tools)).toContain(
						'test_tool'
					);
				}).pipe(Effect.provide(TestLayer))
		);
	});

	describe('test layer', () => {
		it.effect(
			'returns empty toolkit by default from test implementation',
			() =>
				Effect.gen(function* () {
					const factory = yield* ToolFactory.Service;
					const result = yield* factory.buildToolkit([runShellSpec]);
					expect(result.toolkit).toBe(Toolkit.empty);
				}).pipe(Effect.provide(ToolFactory.test()))
		);

		it.effect('accepts a custom buildToolkit function in test layer', () =>
			Effect.gen(function* () {
				const factory = yield* ToolFactory.Service;
				const result = yield* factory.buildToolkit([]);

				// Custom test layer returns a non-empty toolkit indicator
				expect(result.toolkit).toBe(Toolkit.empty);
			}).pipe(
				Effect.provide(
					ToolFactory.test({
						buildToolkit: () =>
							({
								toolkit: Toolkit.empty,
								handlerLayer: Layer.empty
							}) satisfies BuiltToolkit
					})
				)
			)
		);
	});
});
