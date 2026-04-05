/**
 * Experiment log (results.tsv) read/write service.
 *
 * Manages the tab-separated run ledger that tracks benchmark results
 * across optimization iterations. Columns match the Python `program.md`
 * specification: commit, avg_score, passed, task_scores, cost_usd,
 * status, description.
 *
 * @since 0.2.0
 */
import { Effect, FileSystem, Layer, Result, ServiceMap } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';

import { ExperimentLogError } from './Errors.js';

// =============================================================================
// Experiment Status
// =============================================================================

/**
 * Outcome status of an experiment run.
 *
 * @since 0.2.0
 */
export const ExperimentStatus = Schema.Literals([
	'keep',
	'discard',
	'crash'
]).annotate({
	title: 'ExperimentStatus',
	description:
		'Outcome status of an experiment run: kept, discarded, or crashed.'
});

export type ExperimentStatus = typeof ExperimentStatus.Type;

// =============================================================================
// Experiment Row
// =============================================================================

/**
 * A single row in the experiment results ledger.
 *
 * @since 0.2.0
 */
export class ExperimentRow extends Schema.Class<ExperimentRow>('ExperimentRow')(
	{
		commit: Schema.String,
		avgScore: Schema.Number,
		passed: Schema.String,
		taskScores: Schema.String,
		costUsd: Schema.OptionFromNullishOr(Schema.Number),
		status: ExperimentStatus,
		description: Schema.String
	},
	{
		description: 'A single row in the experiment results TSV ledger.'
	}
) {}

// =============================================================================
// TSV Codec (pure functions)
// =============================================================================

const TSV_HEADER =
	'commit\tavg_score\tpassed\ttask_scores\tcost_usd\tstatus\tdescription';

const TSV_COLUMNS = 7;

/**
 * Format an ExperimentRow as a TSV line.
 *
 * @since 0.2.0
 */
export const rowToTsv = (row: ExperimentRow): string => {
	const costStr = Option.match(row.costUsd, {
		onNone: () => '',
		onSome: (c) => c.toFixed(4)
	});
	return [
		row.commit,
		row.avgScore.toFixed(3),
		row.passed,
		row.taskScores,
		costStr,
		row.status,
		row.description
	].join('\t');
};

/**
 * Parse a TSV line into an ExperimentRow.
 *
 * @since 0.2.0
 */
export const rowFromTsv = (line: string): Option.Option<ExperimentRow> => {
	const parts = line.split('\t');
	if (parts.length < TSV_COLUMNS) return Option.none();

	const commit = parts[0] ?? '';
	const avgScore = parseFloat(parts[1] ?? '0');
	const passed = parts[2] ?? '';
	const taskScores = parts[3] ?? '';
	const costStr = parts[4] ?? '';
	const status = parts[5] ?? 'crash';
	const description = parts[6] ?? '';

	if (
		isNaN(avgScore) ||
		(status !== 'keep' && status !== 'discard' && status !== 'crash')
	) {
		return Option.none();
	}

	const costUsd =
		Str.isNonEmpty(costStr) && !isNaN(parseFloat(costStr))
			? Option.some(parseFloat(costStr))
			: Option.none();

	return Option.some(
		new ExperimentRow({
			commit,
			avgScore,
			passed,
			taskScores,
			costUsd,
			status,
			description
		})
	);
};

// =============================================================================
// Service
// =============================================================================

/**
 * Experiment log service for reading and writing the results.tsv ledger.
 *
 * @since 0.2.0
 */
export namespace ExperimentLog {
	export interface Interface {
		/**
		 * Initialize the results.tsv file with headers if it does not exist.
		 *
		 * @since 0.2.0
		 */
		readonly init: Effect.Effect<void, ExperimentLogError>;

		/**
		 * Read all experiment rows from the results file.
		 *
		 * @since 0.2.0
		 */
		readonly readAll: Effect.Effect<
			ReadonlyArray<ExperimentRow>,
			ExperimentLogError
		>;

		/**
		 * Append a single experiment row to the results file.
		 *
		 * @since 0.2.0
		 */
		readonly append: (
			row: ExperimentRow
		) => Effect.Effect<void, ExperimentLogError>;

		/**
		 * Get the most recent row (last entry in the file).
		 *
		 * @since 0.2.0
		 */
		readonly latest: Effect.Effect<
			Option.Option<ExperimentRow>,
			ExperimentLogError
		>;
	}

	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/ExperimentLog'
	) {}

	/**
	 * Create an ExperimentLog layer backed by a file at the given path.
	 *
	 * @since 0.2.0
	 */
	export const layer = (filePath: string) =>
		Layer.effect(
			Service,
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;

				const wrapError = (operation: string) => (cause: unknown) =>
					new ExperimentLogError({
						operation,
						message: `Experiment log ${operation} failed: ${filePath}`,
						cause
					});

				const rowToResult = (
					line: string
				): Result.Result<ExperimentRow, void> =>
					Option.match(rowFromTsv(line), {
						onNone: () => Result.failVoid,
						onSome: Result.succeed
					});

				const init: Effect.Effect<void, ExperimentLogError> =
					Effect.gen(function* () {
						yield* Effect.annotateCurrentSpan('operation', 'init');
						const exists = yield* fs
							.exists(filePath)
							.pipe(Effect.mapError(wrapError('init')));
						if (!exists) {
							yield* fs
								.writeFileString(filePath, TSV_HEADER + '\n')
								.pipe(Effect.mapError(wrapError('init')));
						}
					}).pipe(Effect.withLogSpan('ExperimentLog.init'));

				const readAll: Effect.Effect<
					ReadonlyArray<ExperimentRow>,
					ExperimentLogError
				> = Effect.gen(function* () {
					const exists = yield* fs
						.exists(filePath)
						.pipe(Effect.mapError(wrapError('readAll')));
					if (!exists) return [];

					const content = yield* fs
						.readFileString(filePath)
						.pipe(Effect.mapError(wrapError('readAll')));
					const lines = Str.split('\n')(content);

					return Arr.filterMap(
						Arr.filter(Arr.drop(lines, 1), Str.isNonEmpty),
						rowToResult
					);
				}).pipe(Effect.withLogSpan('ExperimentLog.readAll'));

				const append = Effect.fn('ExperimentLog.append')(function* (
					row: ExperimentRow
				) {
					yield* init;
					yield* fs
						.writeFileString(filePath, rowToTsv(row) + '\n', {
							flag: 'a'
						})
						.pipe(Effect.mapError(wrapError('append')));
				});

				const latest: Effect.Effect<
					Option.Option<ExperimentRow>,
					ExperimentLogError
				> = Effect.gen(function* () {
					const rows = yield* readAll;
					return Arr.last(rows);
				}).pipe(Effect.withLogSpan('ExperimentLog.latest'));

				return Service.of({ init, readAll, append, latest });
			})
		);

	/**
	 * Create a test layer with an in-memory experiment log.
	 *
	 * @since 0.2.0
	 */
	export const test = (initialRows: ReadonlyArray<ExperimentRow> = []) => {
		const rows: Array<ExperimentRow> = Array.from(initialRows);
		return Layer.succeed(
			Service,
			Service.of({
				init: Effect.void,
				readAll: Effect.sync(() => rows),
				append: (row) =>
					Effect.sync(() => {
						rows.push(row);
					}),
				latest: Effect.sync(() => Arr.last(rows))
			})
		);
	};
}
