/**
 * Meta-agent optimizer with assisted mode.
 *
 * Provides composable methods that a coding agent calls in sequence:
 * `diagnose` → (agent applies edits) → `recordAndEvaluate`.
 * Also provides `readHarness` for the coding agent to inspect
 * the current editable harness files.
 *
 * The `step` and `loop` methods are convenience wrappers primarily
 * for testing — the intended production workflow is the coding agent
 * calling `diagnose`/`readHarness`/`recordAndEvaluate` separately.
 *
 * @since 0.2.0
 */
import { Effect, FileSystem, Layer, Ref, ServiceMap } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';
import * as LanguageModel from 'effect/unstable/ai/LanguageModel';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import {
	AgentBlueprint,
	BlueprintJson,
	defaultBlueprint
} from './AgentBlueprint.js';
import { type BlueprintPatch, applyPatches } from './BlueprintPatch.js';
import { BlueprintStore } from './BlueprintStore.js';
import { BenchmarkRunner } from './BenchmarkRunner.js';
import { MetaAgentError } from './Errors.js';
import {
	ExperimentLog,
	ExperimentRow,
	type ExperimentStatus
} from './ExperimentLog.js';
import {
	BlueprintDiagnosisOutput,
	BlueprintProposal,
	DiagnosisOutput,
	EvaluationResult,
	type HarnessFile,
	OptimizerState,
	defaultManifest,
	initialOptimizerState
} from './HarnessSpec.js';

// =============================================================================
// Evaluation Schema (for generateObject)
// =============================================================================

class EvalOutput extends Schema.Class<EvalOutput>('EvalOutput')(
	{
		decision: Schema.Literals(['keep', 'discard']),
		reasoning: Schema.String
	},
	{
		description: 'Structured output from the meta-agent evaluation phase.'
	}
) {}

// =============================================================================
// Service
// =============================================================================

/**
 * Meta-agent optimizer with assisted mode for coding agent integration.
 *
 * @since 0.2.0
 */
export namespace MetaAgent {
	export interface Interface {
		/**
		 * Diagnose failures from history and run log, return structured proposal.
		 *
		 * @since 0.3.0
		 */
		readonly diagnose: Effect.Effect<DiagnosisOutput, MetaAgentError>;

		/**
		 * Read the current contents of all editable harness files.
		 *
		 * @since 0.3.0
		 */
		readonly readHarness: Effect.Effect<
			ReadonlyArray<HarnessFile>,
			MetaAgentError
		>;

		/**
		 * After the coding agent has applied edits: commit, benchmark,
		 * record, evaluate, and keep/revert.
		 *
		 * @since 0.3.0
		 */
		readonly recordAndEvaluate: (
			description: string
		) => Effect.Effect<EvaluationResult, MetaAgentError>;

		/**
		 * Run a single optimization iteration: diagnose, propose,
		 * apply, benchmark, evaluate. Primarily for testing.
		 *
		 * @since 0.2.0
		 */
		readonly step: Effect.Effect<EvaluationResult, MetaAgentError>;

		/**
		 * Run the optimization loop indefinitely until interrupted.
		 * Primarily for testing.
		 *
		 * @since 0.2.0
		 */
		readonly loop: Effect.Effect<never, MetaAgentError>;

		/**
		 * Get the current optimizer state.
		 *
		 * @since 0.2.0
		 */
		readonly state: Effect.Effect<OptimizerState, never>;

		/**
		 * Diagnose failures and propose blueprint patches.
		 *
		 * @since 0.3.0
		 */
		readonly diagnoseBlueprint: Effect.Effect<
			BlueprintDiagnosisOutput,
			MetaAgentError
		>;

		/**
		 * Apply blueprint patches, benchmark, evaluate, and keep/rollback.
		 *
		 * @since 0.3.0
		 */
		readonly evaluatePatches: (
			patches: ReadonlyArray<BlueprintPatch>,
			description: string
		) => Effect.Effect<EvaluationResult, MetaAgentError>;

		/**
		 * Get the current blueprint from the store.
		 *
		 * @since 0.3.0
		 */
		readonly currentBlueprint: Effect.Effect<
			AgentBlueprint,
			MetaAgentError
		>;
	}

	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/MetaAgent'
	) {}

	export const layer = Layer.effect(
		Service,
		Effect.gen(function* () {
			const lm = yield* LanguageModel.LanguageModel;
			const experimentLog = yield* ExperimentLog.Service;
			const benchmarkRunner = yield* BenchmarkRunner.Service;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const fs = yield* FileSystem.FileSystem;
			const stateRef = yield* Ref.make(initialOptimizerState);
			const blueprintStore = yield* Effect.serviceOption(
				BlueprintStore.Service
			);

			const wrapError = (phase: string) => (cause: unknown) =>
				new MetaAgentError({
					phase,
					message: `Meta-agent ${phase} failed`,
					cause
				});

			// =================================================================
			// Git helpers
			// =================================================================

			const getCurrentCommit: Effect.Effect<string, MetaAgentError> =
				spawner
					.string(
						ChildProcess.make(
							'git',
							['rev-parse', '--short', 'HEAD'],
							{ stdin: 'ignore' }
						)
					)
					.pipe(
						Effect.map(Str.trim),
						Effect.mapError(wrapError('git'))
					);

			const readRunLog: Effect.Effect<string, MetaAgentError> = spawner
				.string(
					ChildProcess.make(
						'sh',
						[
							'-c',
							'tail -200 run.log 2>/dev/null || echo "(no run.log)"'
						],
						{ stdin: 'ignore' }
					)
				)
				.pipe(
					Effect.map(Str.trim),
					Effect.mapError(wrapError('readRunLog'))
				);

			const commitChanges = Effect.fn('MetaAgent.commitChanges')(
				function* (description: string) {
					yield* spawner
						.string(
							ChildProcess.make('git', ['add', '-A'], {
								stdin: 'ignore'
							})
						)
						.pipe(Effect.mapError(wrapError('commitChanges')));

					yield* spawner
						.string(
							ChildProcess.make(
								'git',
								['commit', '-m', description, '--allow-empty'],
								{ stdin: 'ignore' }
							)
						)
						.pipe(Effect.mapError(wrapError('commitChanges')));
				}
			);

			// =================================================================
			// LLM helpers
			// =================================================================

			const evaluateBenchmark = Effect.fn('MetaAgent.evaluate')(
				function* (
					baseline: Option.Option<ExperimentRow>,
					current: ExperimentRow
				) {
					const baselinePassed = Option.match(baseline, {
						onNone: () => '0/0',
						onSome: (b) => b.passed
					});

					const evalPrompt = `Compare benchmark results.
Baseline passed: ${baselinePassed}
Current passed: ${current.passed}
Current avg_score: ${current.avgScore}
Current description: ${current.description}

Rules:
- If passed count improved → keep
- If passed same AND harness simpler → keep
- Otherwise → discard

Respond with your decision and reasoning.`;

					const response = yield* lm
						.generateObject({
							prompt: evalPrompt,
							schema: EvalOutput
						})
						.pipe(Effect.mapError(wrapError('evaluate')));

					return new EvaluationResult({
						decision: response.value.decision,
						baselinePassed,
						currentPassed: current.passed,
						reasoning: response.value.reasoning
					});
				}
			);

			const parsePassed = (passed: string): number => {
				const slashIdx = passed.indexOf('/');
				if (slashIdx < 0) return 0;
				const num = parseInt(passed.slice(0, slashIdx), 10);
				return isNaN(num) ? 0 : num;
			};

			// =================================================================
			// Assisted mode methods
			// =================================================================

			/**
			 * Diagnose failures from experiment history and run log.
			 */
			const diagnose: Effect.Effect<DiagnosisOutput, MetaAgentError> =
				Effect.gen(function* () {
					const history = yield* experimentLog.readAll.pipe(
						Effect.mapError(wrapError('readHistory'))
					);
					const runLog = yield* readRunLog;

					const historyStr = Arr.match(history, {
						onEmpty: () => '(no previous runs)',
						onNonEmpty: (rows) =>
							Arr.map(
								rows,
								(r) =>
									`${r.commit}\t${r.avgScore}\t${r.passed}\t${r.status}\t${r.description}`
							).join('\n')
					});

					const diagPrompt = `You are a meta-agent optimizer. Analyze the following benchmark history and run log to diagnose failures and propose ONE improvement.

## Experiment History
${historyStr}

## Latest Run Log (tail)
${runLog}

## Instructions
1. Group failures by root cause category
2. Propose ONE general harness improvement (no task-specific hacks)
3. The improvement should help multiple tasks, not just one
4. Test: "If this exact task disappeared, would this still be worthwhile?"`;

					const response = yield* lm
						.generateObject({
							prompt: diagPrompt,
							schema: DiagnosisOutput
						})
						.pipe(Effect.mapError(wrapError('diagnose')));

					return response.value;
				}).pipe(Effect.withLogSpan('MetaAgent.diagnose'));

			/**
			 * Read all editable harness files as defined by the manifest.
			 */
			const readHarness: Effect.Effect<
				ReadonlyArray<HarnessFile>,
				MetaAgentError
			> = Effect.forEach(
				defaultManifest.editableFiles,
				(filePath) =>
					fs.readFileString(filePath).pipe(
						Effect.map(
							(content): HarnessFile => ({
								path: filePath,
								content
							})
						),
						Effect.mapError(wrapError('readHarness'))
					),
				{ concurrency: 4 }
			).pipe(Effect.withLogSpan('MetaAgent.readHarness'));

			/**
			 * After edits: commit, benchmark, record, evaluate, keep/revert.
			 */
			const recordAndEvaluate = Effect.fn('MetaAgent.recordAndEvaluate')(
				function* (description: string) {
					const currentState = yield* Ref.get(stateRef);

					// 1. Commit changes
					yield* commitChanges(description);
					const commit = yield* getCurrentCommit;

					// 2. Run benchmarks
					yield* Effect.logInfo('Running benchmarks...');
					const benchResult = yield* benchmarkRunner
						.runAll()
						.pipe(Effect.mapError(wrapError('benchmark')));
					yield* Effect.logInfo(
						`Benchmark complete: ${benchResult.passed} passed`
					);

					// 3. Record results
					const history = yield* experimentLog.readAll.pipe(
						Effect.mapError(wrapError('readHistory'))
					);
					const baseline = Arr.last(history);

					const newRow = new ExperimentRow({
						commit,
						avgScore: benchResult.avgScore,
						passed: benchResult.passed,
						taskScores: '',
						costUsd: Option.none(),
						status: 'keep' satisfies ExperimentStatus,
						description
					});

					// 4. Evaluate
					const evalResult = yield* evaluateBenchmark(
						baseline,
						newRow
					);

					const finalStatus: ExperimentStatus =
						evalResult.decision === 'keep' ? 'keep' : 'discard';

					const recordedRow = new ExperimentRow({
						commit,
						avgScore: newRow.avgScore,
						passed: newRow.passed,
						taskScores: newRow.taskScores,
						costUsd: newRow.costUsd,
						status: finalStatus,
						description: newRow.description
					});

					yield* experimentLog
						.append(recordedRow)
						.pipe(Effect.mapError(wrapError('recordResult')));

					// 5. Update state
					const passedCount = parsePassed(recordedRow.passed);
					const nextState = new OptimizerState({
						iteration: currentState.iteration + 1,
						bestScore:
							evalResult.decision === 'keep'
								? Math.max(
										currentState.bestScore,
										recordedRow.avgScore
									)
								: currentState.bestScore,
						bestPassed:
							evalResult.decision === 'keep' &&
							passedCount > parsePassed(currentState.bestPassed)
								? recordedRow.passed
								: currentState.bestPassed,
						consecutiveDiscards:
							evalResult.decision === 'discard'
								? currentState.consecutiveDiscards + 1
								: 0,
						totalKeeps:
							evalResult.decision === 'keep'
								? currentState.totalKeeps + 1
								: currentState.totalKeeps,
						totalDiscards:
							evalResult.decision === 'discard'
								? currentState.totalDiscards + 1
								: currentState.totalDiscards
					});
					yield* Ref.set(stateRef, nextState);

					// 6. If discarded, revert
					if (evalResult.decision === 'discard') {
						yield* spawner
							.string(
								ChildProcess.make(
									'git',
									['revert', '--no-edit', 'HEAD'],
									{ stdin: 'ignore' }
								)
							)
							.pipe(Effect.mapError(wrapError('revert')));
						yield* Effect.logInfo('Discarded — reverted commit');
					} else {
						yield* Effect.logInfo(`Kept — ${evalResult.reasoning}`);
					}

					return new EvaluationResult({
						decision: evalResult.decision,
						baselinePassed: evalResult.baselinePassed,
						currentPassed: evalResult.currentPassed,
						reasoning: evalResult.reasoning,
						commit: Option.some(commit)
					});
				}
			);

			// =================================================================
			// Blueprint-aware methods
			// =================================================================

			const requireBlueprintStore = (phase: string) =>
				Effect.fromOption(blueprintStore).pipe(
					Effect.mapError(
						() =>
							new MetaAgentError({
								phase,
								message: 'BlueprintStore not provided'
							})
					)
				);

			const diagnoseBlueprint: Effect.Effect<
				BlueprintDiagnosisOutput,
				MetaAgentError
			> = Effect.gen(function* () {
				const store = yield* requireBlueprintStore('diagnoseBlueprint');
				const currentBp = yield* store.current.pipe(
					Effect.mapError(wrapError('diagnoseBlueprint'))
				);
				const history = yield* experimentLog.readAll.pipe(
					Effect.mapError(wrapError('readHistory'))
				);
				const runLog = yield* readRunLog;

				const historyStr = Arr.match(history, {
					onEmpty: () => '(no previous runs)',
					onNonEmpty: (rows) =>
						Arr.map(
							rows,
							(r) =>
								`${r.commit}\t${r.avgScore}\t${r.passed}\t${r.status}\t${r.description}`
						).join('\n')
				});

				const blueprintStr =
					Schema.encodeSync(BlueprintJson)(currentBp);

				const diagPrompt = `You are a meta-agent optimizer. Analyze the benchmark history and current blueprint to diagnose failures and propose improvements as blueprint patches.

## Current Blueprint
${blueprintStr}

## Experiment History
${historyStr}

## Latest Run Log (tail)
${runLog}

## Instructions
1. Group failures by root cause category
2. Propose ONE improvement as an array of BlueprintPatch operations
3. Available patch types: SetSystemPrompt, SetModel, AddTool, RemoveTool, ModifyTool, SetOrchestration, SetConstraints
4. The improvement should help multiple tasks, not just one`;

				const response = yield* lm
					.generateObject({
						prompt: diagPrompt,
						schema: BlueprintDiagnosisOutput
					})
					.pipe(Effect.mapError(wrapError('diagnoseBlueprint')));

				return response.value;
			}).pipe(Effect.withLogSpan('MetaAgent.diagnoseBlueprint'));

			const evaluatePatches = Effect.fn('MetaAgent.evaluatePatches')(
				function* (
					patches: ReadonlyArray<BlueprintPatch>,
					description: string
				) {
					const store =
						yield* requireBlueprintStore('evaluatePatches');
					const currentState = yield* Ref.get(stateRef);
					const currentBp = yield* store.current.pipe(
						Effect.mapError(wrapError('evaluatePatches'))
					);

					// Apply patches
					const newBp = applyPatches(currentBp, patches);

					// Save new blueprint
					yield* store
						.save(newBp)
						.pipe(Effect.mapError(wrapError('evaluatePatches')));

					// Run benchmarks
					yield* Effect.logInfo(
						'Running benchmarks with patched blueprint...'
					);
					const benchResult = yield* benchmarkRunner
						.runAll()
						.pipe(Effect.mapError(wrapError('benchmark')));
					yield* Effect.logInfo(
						`Benchmark complete: ${benchResult.passed} passed`
					);

					// Record results
					const history = yield* experimentLog.readAll.pipe(
						Effect.mapError(wrapError('readHistory'))
					);
					const baseline = Arr.last(history);
					const commit = yield* getCurrentCommit;

					const newRow = new ExperimentRow({
						commit,
						avgScore: benchResult.avgScore,
						passed: benchResult.passed,
						taskScores: '',
						costUsd: Option.none(),
						status: 'keep' satisfies ExperimentStatus,
						description
					});

					// Evaluate
					const evalResult = yield* evaluateBenchmark(
						baseline,
						newRow
					);
					const finalStatus: ExperimentStatus =
						evalResult.decision === 'keep' ? 'keep' : 'discard';

					const recordedRow = new ExperimentRow({
						commit,
						avgScore: newRow.avgScore,
						passed: newRow.passed,
						taskScores: '',
						costUsd: Option.none(),
						status: finalStatus,
						description
					});

					yield* experimentLog
						.append(recordedRow)
						.pipe(Effect.mapError(wrapError('recordResult')));

					// Update state
					const passedCount = parsePassed(recordedRow.passed);
					const nextState = new OptimizerState({
						iteration: currentState.iteration + 1,
						bestScore:
							evalResult.decision === 'keep'
								? Math.max(
										currentState.bestScore,
										recordedRow.avgScore
									)
								: currentState.bestScore,
						bestPassed:
							evalResult.decision === 'keep' &&
							passedCount > parsePassed(currentState.bestPassed)
								? recordedRow.passed
								: currentState.bestPassed,
						consecutiveDiscards:
							evalResult.decision === 'discard'
								? currentState.consecutiveDiscards + 1
								: 0,
						totalKeeps:
							evalResult.decision === 'keep'
								? currentState.totalKeeps + 1
								: currentState.totalKeeps,
						totalDiscards:
							evalResult.decision === 'discard'
								? currentState.totalDiscards + 1
								: currentState.totalDiscards
					});
					yield* Ref.set(stateRef, nextState);

					// If discarded, rollback blueprint
					if (evalResult.decision === 'discard') {
						yield* store
							.save(currentBp)
							.pipe(Effect.mapError(wrapError('rollback')));
						yield* Effect.logInfo(
							'Discarded — rolled back blueprint'
						);
					} else {
						yield* Effect.logInfo(`Kept — ${evalResult.reasoning}`);
					}

					return new EvaluationResult({
						decision: evalResult.decision,
						baselinePassed: evalResult.baselinePassed,
						currentPassed: evalResult.currentPassed,
						reasoning: evalResult.reasoning,
						commit: Option.some(commit)
					});
				}
			);

			const currentBlueprint: Effect.Effect<
				AgentBlueprint,
				MetaAgentError
			> = Effect.gen(function* () {
				const store = yield* requireBlueprintStore('currentBlueprint');
				return yield* store.current.pipe(
					Effect.mapError(wrapError('currentBlueprint'))
				);
			});

			// =================================================================
			// Convenience methods (primarily for testing)
			// =================================================================

			const step: Effect.Effect<EvaluationResult, MetaAgentError> =
				Effect.gen(function* () {
					yield* Effect.logInfo('Starting optimization step');
					const diagResult = yield* diagnose;
					yield* Effect.logInfo(
						`Proposed: ${diagResult.proposal.description}`
					);
					return yield* recordAndEvaluate(
						diagResult.proposal.description
					);
				}).pipe(Effect.withLogSpan('MetaAgent.step'));

			const loop: Effect.Effect<never, MetaAgentError> = Effect.gen(
				function* () {
					const result = yield* step;
					const currentState = yield* Ref.get(stateRef);
					yield* Effect.logInfo(
						`Iteration ${currentState.iteration}: ${result.decision} (${result.currentPassed})`
					);
					return yield* loop;
				}
			);

			const state: Effect.Effect<OptimizerState, never> =
				Ref.get(stateRef);

			return Service.of({
				diagnose,
				readHarness,
				recordAndEvaluate,
				step,
				loop,
				state,
				diagnoseBlueprint,
				evaluatePatches,
				currentBlueprint
			});
		})
	);

	/**
	 * Create a test layer with a mock meta-agent.
	 *
	 * @since 0.2.0
	 */
	export const test = (responses?: {
		readonly step?: () => EvaluationResult;
		readonly diagnose?: () => DiagnosisOutput;
		readonly readHarness?: () => ReadonlyArray<HarnessFile>;
		readonly recordAndEvaluate?: (description: string) => EvaluationResult;
		readonly diagnoseBlueprint?: () => BlueprintDiagnosisOutput;
		readonly evaluatePatches?: (
			patches: ReadonlyArray<BlueprintPatch>,
			description: string
		) => EvaluationResult;
		readonly currentBlueprint?: () => AgentBlueprint;
	}) => {
		const defaultResult = new EvaluationResult({
			decision: 'keep',
			baselinePassed: '0/0',
			currentPassed: '1/10',
			reasoning: 'mock improvement'
		});

		return Layer.succeed(
			Service,
			Service.of({
				diagnose: Effect.sync(
					() =>
						responses?.diagnose?.() ??
						new DiagnosisOutput({
							diagnoses: [],
							proposal: {
								description: 'mock proposal',
								changeType: 'prompt_tuning',
								rationale: 'mock',
								affectedFiles: []
							}
						})
				),
				readHarness: Effect.sync(
					() => responses?.readHarness?.() ?? []
				),
				recordAndEvaluate: (description) =>
					Effect.sync(
						() =>
							responses?.recordAndEvaluate?.(description) ??
							defaultResult
					),
				step: Effect.sync(() => responses?.step?.() ?? defaultResult),
				loop: Effect.never,
				state: Effect.succeed(initialOptimizerState),
				diagnoseBlueprint: Effect.sync(
					() =>
						responses?.diagnoseBlueprint?.() ??
						new BlueprintDiagnosisOutput({
							diagnoses: [],
							proposal: new BlueprintProposal({
								description: 'mock blueprint proposal',
								rationale: 'mock',
								patches: []
							})
						})
				),
				evaluatePatches: (patches, description) =>
					Effect.sync(
						() =>
							responses?.evaluatePatches?.(
								patches,
								description
							) ?? defaultResult
					),
				currentBlueprint: Effect.sync(
					() => responses?.currentBlueprint?.() ?? defaultBlueprint
				)
			})
		);
	};
}
