import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Option from 'effect/Option';

import {
	ExperimentLog,
	ExperimentRow,
	rowFromTsv,
	rowToTsv
} from '../src/ExperimentLog.js';

// =============================================================================
// Pure function tests
// =============================================================================

describe('ExperimentLog', () => {
	describe('rowToTsv', () => {
		it('formats row with cost', () => {
			const row = new ExperimentRow({
				commit: 'a1b2c3d',
				avgScore: 0.345,
				passed: '20/58',
				taskScores: 'task1=0.5,task2=1.0',
				costUsd: Option.some(1.2345),
				status: 'keep',
				description: 'added verification tool'
			});
			const tsv = rowToTsv(row);
			expect(tsv).toBe(
				'a1b2c3d\t0.345\t20/58\ttask1=0.5,task2=1.0\t1.2345\tkeep\tadded verification tool'
			);
		});

		it('formats row without cost', () => {
			const row = new ExperimentRow({
				commit: 'xyz789',
				avgScore: 0,
				passed: '0/10',
				taskScores: '',
				costUsd: Option.none(),
				status: 'crash',
				description: 'initial run'
			});
			const tsv = rowToTsv(row);
			expect(tsv).toBe('xyz789\t0.000\t0/10\t\t\tcrash\tinitial run');
		});
	});

	describe('rowFromTsv', () => {
		it('parses valid TSV line with cost', () => {
			const line =
				'a1b2c3d\t0.345\t20/58\ttask1=0.5\t1.2345\tkeep\tadded tool';
			const result = rowFromTsv(line);
			Option.match(result, {
				onNone: () => expect.unreachable('expected Some'),
				onSome: (row) => {
					expect(row.commit).toBe('a1b2c3d');
					expect(row.avgScore).toBeCloseTo(0.345);
					expect(row.passed).toBe('20/58');
					expect(row.status).toBe('keep');
					expect(row.description).toBe('added tool');
					expect(Option.isSome(row.costUsd)).toBe(true);
				}
			});
		});

		it('parses valid TSV line without cost', () => {
			const line = 'xyz789\t0.000\t0/10\t\t\tcrash\tinitial';
			const result = rowFromTsv(line);
			Option.match(result, {
				onNone: () => expect.unreachable('expected Some'),
				onSome: (row) => {
					expect(row.commit).toBe('xyz789');
					expect(Option.isNone(row.costUsd)).toBe(true);
				}
			});
		});

		it('returns none for invalid status', () => {
			const line = 'abc\t0.5\t1/1\t\t\tinvalid_status\tdesc';
			const result = rowFromTsv(line);
			expect(Option.isNone(result)).toBe(true);
		});

		it('returns none for too few columns', () => {
			const result = rowFromTsv('a\tb\tc');
			expect(Option.isNone(result)).toBe(true);
		});

		it('returns none for non-numeric avg_score', () => {
			const line = 'abc\tnot_a_number\t1/1\t\t\tkeep\tdesc';
			const result = rowFromTsv(line);
			expect(Option.isNone(result)).toBe(true);
		});

		it('roundtrips through rowToTsv', () => {
			const original = new ExperimentRow({
				commit: 'abc123',
				avgScore: 0.75,
				passed: '15/20',
				taskScores: 'a=1,b=0.5',
				costUsd: Option.some(2.5),
				status: 'discard',
				description: 'prompt change'
			});
			const tsv = rowToTsv(original);
			const parsed = rowFromTsv(tsv);
			Option.match(parsed, {
				onNone: () => expect.unreachable('expected roundtrip to parse'),
				onSome: (row) => {
					expect(row.commit).toBe(original.commit);
					expect(row.passed).toBe(original.passed);
					expect(row.status).toBe(original.status);
					expect(row.description).toBe(original.description);
				}
			});
		});
	});

	describe('test layer', () => {
		it.effect('init is a no-op', () =>
			Effect.gen(function* () {
				const log = yield* ExperimentLog.Service;
				yield* log.init;
			}).pipe(Effect.provide(ExperimentLog.test()))
		);

		it.effect('readAll returns initial rows', () =>
			Effect.gen(function* () {
				const log = yield* ExperimentLog.Service;
				const rows = yield* log.readAll;
				expect(rows).toHaveLength(1);
				expect(rows[0]?.commit).toBe('abc');
			}).pipe(
				Effect.provide(
					ExperimentLog.test([
						new ExperimentRow({
							commit: 'abc',
							avgScore: 0.5,
							passed: '5/10',
							taskScores: '',
							costUsd: Option.none(),
							status: 'keep',
							description: 'test'
						})
					])
				)
			)
		);

		it.effect('append adds a row', () =>
			Effect.gen(function* () {
				const log = yield* ExperimentLog.Service;
				const row = new ExperimentRow({
					commit: 'new',
					avgScore: 0.8,
					passed: '8/10',
					taskScores: '',
					costUsd: Option.none(),
					status: 'keep',
					description: 'improvement'
				});
				yield* log.append(row);
				const rows = yield* log.readAll;
				expect(rows).toHaveLength(1);
			}).pipe(Effect.provide(ExperimentLog.test()))
		);

		it.effect('latest returns last appended row', () =>
			Effect.gen(function* () {
				const log = yield* ExperimentLog.Service;
				yield* log.append(
					new ExperimentRow({
						commit: 'first',
						avgScore: 0.1,
						passed: '1/10',
						taskScores: '',
						costUsd: Option.none(),
						status: 'discard',
						description: 'attempt 1'
					})
				);
				yield* log.append(
					new ExperimentRow({
						commit: 'second',
						avgScore: 0.3,
						passed: '3/10',
						taskScores: '',
						costUsd: Option.none(),
						status: 'keep',
						description: 'attempt 2'
					})
				);
				const latest = yield* log.latest;
				Option.match(latest, {
					onNone: () => expect.unreachable('expected latest'),
					onSome: (row) => expect(row.commit).toBe('second')
				});
			}).pipe(Effect.provide(ExperimentLog.test()))
		);

		it.effect('latest returns none when empty', () =>
			Effect.gen(function* () {
				const log = yield* ExperimentLog.Service;
				const latest = yield* log.latest;
				expect(Option.isNone(latest)).toBe(true);
			}).pipe(Effect.provide(ExperimentLog.test()))
		);
	});
});
