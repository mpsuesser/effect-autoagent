import { describe, expect, it } from '@effect/vitest';
import { Effect, FileSystem } from 'effect';
import * as Option from 'effect/Option';

import {
	AgentSettings,
	EnvironmentSettings,
	TaskConfig,
	TaskMeta,
	TaskSpec,
	VerifierSettings,
	discoverTasks,
	parseTaskToml
} from '../src/TaskSpec.js';

// =============================================================================
// Schema construction tests
// =============================================================================

describe('TaskMeta', () => {
	it('constructs with name only', () => {
		const meta = new TaskMeta({ name: 'org/my-task' });
		expect(meta.name).toBe('org/my-task');
		expect(meta.description).toBe('');
	});

	it('constructs with all fields', () => {
		const meta = new TaskMeta({
			name: 'org/my-task',
			description: 'A test task'
		});
		expect(meta.description).toBe('A test task');
	});
});

describe('AgentSettings', () => {
	it('uses default timeout', () => {
		const settings = new AgentSettings({});
		expect(settings.timeout_sec).toBe(120);
	});

	it('accepts custom timeout', () => {
		const settings = new AgentSettings({ timeout_sec: 60 });
		expect(settings.timeout_sec).toBe(60);
	});
});

describe('VerifierSettings', () => {
	it('uses default timeout', () => {
		const settings = new VerifierSettings({});
		expect(settings.timeout_sec).toBe(600);
	});
});

describe('EnvironmentSettings', () => {
	it('uses all defaults', () => {
		const settings = new EnvironmentSettings({});
		expect(settings.build_timeout_sec).toBe(600);
		expect(settings.cpus).toBe(1);
		expect(settings.memory_mb).toBe(2048);
		expect(settings.allow_internet).toBe(true);
	});

	it('accepts custom values', () => {
		const settings = new EnvironmentSettings({
			cpus: 4,
			memory_mb: 4096,
			allow_internet: false
		});
		expect(settings.cpus).toBe(4);
		expect(settings.memory_mb).toBe(4096);
		expect(settings.allow_internet).toBe(false);
	});
});

describe('TaskConfig', () => {
	it('constructs with all sections', () => {
		const config = new TaskConfig({
			task: new TaskMeta({ name: 'test/task' }),
			agent: new AgentSettings({}),
			verifier: new VerifierSettings({}),
			environment: new EnvironmentSettings({})
		});
		expect(config.task.name).toBe('test/task');
		expect(config.schema_version).toBe('1.1');
	});
});

describe('TaskSpec', () => {
	it('constructs with all fields', () => {
		const spec = new TaskSpec({
			config: new TaskConfig({
				task: new TaskMeta({ name: 'test/task' }),
				agent: new AgentSettings({}),
				verifier: new VerifierSettings({}),
				environment: new EnvironmentSettings({})
			}),
			instruction: 'Do something',
			taskDir: '/tasks/test-task',
			testScripts: ['test.sh']
		});
		expect(spec.instruction).toBe('Do something');
		expect(spec.taskDir).toBe('/tasks/test-task');
		expect(Option.isNone(spec.dockerfilePath)).toBe(true);
		expect(spec.testScripts).toEqual(['test.sh']);
	});

	it('constructs with dockerfile path', () => {
		const spec = new TaskSpec({
			config: new TaskConfig({
				task: new TaskMeta({ name: 'test/task' }),
				agent: new AgentSettings({}),
				verifier: new VerifierSettings({}),
				environment: new EnvironmentSettings({})
			}),
			instruction: 'Do something',
			taskDir: '/tasks/test-task',
			dockerfilePath: Option.some(
				'/tasks/test-task/environment/Dockerfile'
			),
			testScripts: ['test.sh']
		});
		expect(Option.isSome(spec.dockerfilePath)).toBe(true);
	});
});

// =============================================================================
// TOML parsing
// =============================================================================

describe('parseTaskToml', () => {
	it.effect('parses minimal task.toml', () =>
		Effect.gen(function* () {
			const toml = `
schema_version = "1.1"
[task]
name = "org/my-task"
`;
			const config = yield* parseTaskToml(toml);
			expect(config.task.name).toBe('org/my-task');
			expect(config.schema_version).toBe('1.1');
			expect(config.agent.timeout_sec).toBe(120);
			expect(config.verifier.timeout_sec).toBe(600);
		})
	);

	it.effect('parses full task.toml', () =>
		Effect.gen(function* () {
			const toml = `
schema_version = "1.1"
[task]
name = "org/complex-task"
description = "A complex benchmark task"
[agent]
timeout_sec = 300.0
[verifier]
timeout_sec = 900.0
[environment]
build_timeout_sec = 1200.0
cpus = 2
memory_mb = 4096
allow_internet = false
`;
			const config = yield* parseTaskToml(toml);
			expect(config.task.name).toBe('org/complex-task');
			expect(config.task.description).toBe('A complex benchmark task');
			expect(config.agent.timeout_sec).toBe(300);
			expect(config.verifier.timeout_sec).toBe(900);
			expect(config.environment.cpus).toBe(2);
			expect(config.environment.memory_mb).toBe(4096);
			expect(config.environment.allow_internet).toBe(false);
		})
	);

	it.effect('fails on invalid TOML', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				parseTaskToml('not valid [[ toml')
			);
			expect(error._tag).toBe('TaskError');
			expect(error.operation).toBe('parseToml');
		})
	);
});

// =============================================================================
// Task discovery (with mock FileSystem)
// =============================================================================

describe('discoverTasks', () => {
	it.effect('returns empty when directory does not exist', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(discoverTasks('/nonexistent'));
			expect(error._tag).toBe('TaskError');
			expect(error.message).toContain('does not exist');
		}).pipe(Effect.provide(FileSystem.layerNoop({})))
	);

	it.effect('discovers tasks from mock filesystem', () =>
		Effect.gen(function* () {
			const tomlContent = `
schema_version = "1.1"
[task]
name = "test/hello"
`;
			const instruction = 'Say hello';

			const mockFs = FileSystem.layerNoop({
				exists: (path) =>
					Effect.succeed(
						path === '/tasks' ||
							path === '/tasks/hello' ||
							path === '/tasks/hello/task.toml' ||
							path === '/tasks/hello/instruction.md' ||
							path === '/tasks/hello/tests'
					),
				readDirectory: (path) => {
					if (path === '/tasks') return Effect.succeed(['hello']);
					if (path === '/tasks/hello/tests')
						return Effect.succeed(['test.sh']);
					return Effect.succeed([]);
				},
				readFileString: (path) => {
					if (path === '/tasks/hello/task.toml')
						return Effect.succeed(tomlContent);
					if (path === '/tasks/hello/instruction.md')
						return Effect.succeed(instruction);
					return Effect.succeed('');
				}
			});

			const tasks = yield* discoverTasks('/tasks').pipe(
				Effect.provide(mockFs)
			);

			expect(tasks).toHaveLength(1);
			expect(tasks[0]?.config.task.name).toBe('test/hello');
			expect(tasks[0]?.instruction).toBe('Say hello');
			expect(tasks[0]?.testScripts).toEqual(['test.sh']);
		})
	);
});
