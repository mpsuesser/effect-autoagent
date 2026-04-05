import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Option from 'effect/Option';

import {
	BenchmarkOptions,
	BenchmarkReport,
	BenchmarkRunner,
	TaskResult
} from '../src/BenchmarkRunner.js';
import { AgentMetrics } from '../src/Metrics.js';
import { TaskConfig, TaskMeta, TaskSpec } from '../src/TaskSpec.js';

const makeTaskSpec = (name: string): TaskSpec =>
	new TaskSpec({
		config: new TaskConfig({
			task: new TaskMeta({ name })
		}),
		instruction: `Do ${name}`,
		taskDir: `/tasks/${name}`,
		testScripts: ['test.sh']
	});

const makeMetrics = (): AgentMetrics =>
	new AgentMetrics({
		inputTokens: 50,
		outputTokens: 25,
		cachedTokens: 0,
		costUsd: Option.none(),
		durationMs: 500,
		numTurns: 2
	});

describe('BenchmarkRunner', () => {
	describe('BenchmarkOptions', () => {
		it('constructs with defaults', () => {
			const opts = new BenchmarkOptions({});
			expect(opts.tasksDir).toBe('tasks');
			expect(opts.concurrency).toBe(4);
			expect(opts.baseImageTag).toBe('effect-autoagent:latest');
			expect(Option.isNone(opts.outputDir)).toBe(true);
		});

		it('accepts custom values', () => {
			const opts = new BenchmarkOptions({
				tasksDir: 'my-tasks',
				concurrency: 8,
				outputDir: Option.some('/output')
			});
			expect(opts.tasksDir).toBe('my-tasks');
			expect(opts.concurrency).toBe(8);
			expect(Option.isSome(opts.outputDir)).toBe(true);
		});
	});

	describe('TaskResult', () => {
		it('constructs with all fields', () => {
			const result = new TaskResult({
				taskName: 'test/task',
				score: 0.75,
				passed: false,
				durationMs: 1000,
				metrics: makeMetrics(),
				verifierOutput: 'some output'
			});
			expect(result.taskName).toBe('test/task');
			expect(result.score).toBe(0.75);
			expect(result.passed).toBe(false);
			expect(result.durationMs).toBe(1000);
		});
	});

	describe('BenchmarkReport', () => {
		it('constructs with aggregated data', () => {
			const report = new BenchmarkReport({
				results: [
					new TaskResult({
						taskName: 'a',
						score: 1.0,
						passed: true,
						durationMs: 100,
						metrics: makeMetrics(),
						verifierOutput: ''
					}),
					new TaskResult({
						taskName: 'b',
						score: 0.0,
						passed: false,
						durationMs: 200,
						metrics: makeMetrics(),
						verifierOutput: ''
					})
				],
				totalPassed: 1,
				totalTasks: 2,
				avgScore: 0.5,
				passed: '1/2'
			});
			expect(report.totalPassed).toBe(1);
			expect(report.totalTasks).toBe(2);
			expect(report.passed).toBe('1/2');
			expect(report.avgScore).toBe(0.5);
		});
	});

	describe('test layer', () => {
		it.effect('runAll returns empty report by default', () =>
			Effect.gen(function* () {
				const runner = yield* BenchmarkRunner.Service;
				const report = yield* runner.runAll();
				expect(report).toBeInstanceOf(BenchmarkReport);
				expect(report.totalTasks).toBe(0);
				expect(report.passed).toBe('0/0');
			}).pipe(Effect.provide(BenchmarkRunner.test()))
		);

		it.effect('runTask returns mock result', () =>
			Effect.gen(function* () {
				const runner = yield* BenchmarkRunner.Service;
				const spec = makeTaskSpec('test/hello');
				const result = yield* runner.runTask(spec);
				expect(result).toBeInstanceOf(TaskResult);
				expect(result.taskName).toBe('test/hello');
				expect(result.passed).toBe(true);
				expect(result.score).toBe(1.0);
			}).pipe(Effect.provide(BenchmarkRunner.test()))
		);

		it.effect('runTask uses custom handler', () =>
			Effect.gen(function* () {
				const runner = yield* BenchmarkRunner.Service;
				const spec = makeTaskSpec('test/custom');
				const result = yield* runner.runTask(spec);
				expect(result.score).toBe(0.5);
				expect(result.passed).toBe(false);
			}).pipe(
				Effect.provide(
					BenchmarkRunner.test({
						runTask: (ts) =>
							new TaskResult({
								taskName: ts.config.task.name,
								score: 0.5,
								passed: false,
								durationMs: 200,
								metrics: makeMetrics(),
								verifierOutput: 'custom'
							})
					})
				)
			)
		);

		it.effect('runAll uses custom handler', () =>
			Effect.gen(function* () {
				const runner = yield* BenchmarkRunner.Service;
				const report = yield* runner.runAll();
				expect(report.totalPassed).toBe(5);
				expect(report.passed).toBe('5/10');
			}).pipe(
				Effect.provide(
					BenchmarkRunner.test({
						runAll: () =>
							new BenchmarkReport({
								results: [],
								totalPassed: 5,
								totalTasks: 10,
								avgScore: 0.5,
								passed: '5/10'
							})
					})
				)
			)
		);
	});
});
