import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import {
	DiagnosisOutput,
	EvaluationResult,
	FailureDiagnosis,
	HarnessFile,
	HarnessManifest,
	ImprovementProposal,
	OptimizerState,
	defaultManifest,
	initialOptimizerState
} from '../src/HarnessSpec.js';

describe('HarnessSpec', () => {
	describe('FailureDiagnosis', () => {
		it('constructs with all categories', () => {
			const categories = [
				'misunderstanding',
				'missing_capability',
				'weak_information_gathering',
				'bad_execution_strategy',
				'missing_verification',
				'environment_issue',
				'silent_failure'
			] satisfies ReadonlyArray<FailureDiagnosis['category']>;

			for (const category of categories) {
				const diagnosis = new FailureDiagnosis({
					category,
					taskNames: ['task-1', 'task-2'],
					description: `Failing due to ${category}`,
					suggestedFix: 'Fix it'
				});
				expect(diagnosis.category).toBe(category);
				expect(diagnosis.taskNames).toHaveLength(2);
			}
		});
	});

	describe('ImprovementProposal', () => {
		it('constructs with all change types', () => {
			const changeTypes = [
				'prompt_tuning',
				'new_tool',
				'tool_modification',
				'strategy_change',
				'model_change',
				'orchestration'
			] satisfies ReadonlyArray<ImprovementProposal['changeType']>;

			for (const changeType of changeTypes) {
				const proposal = new ImprovementProposal({
					description: `Apply ${changeType}`,
					changeType,
					rationale: 'Should help',
					affectedFiles: ['agent.py']
				});
				expect(proposal.changeType).toBe(changeType);
			}
		});
	});

	describe('EvaluationResult', () => {
		it('constructs keep result', () => {
			const result = new EvaluationResult({
				decision: 'keep',
				baselinePassed: '10/58',
				currentPassed: '15/58',
				reasoning: 'Passed count improved by 5'
			});
			expect(result.decision).toBe('keep');
			expect(result.baselinePassed).toBe('10/58');
			expect(result.currentPassed).toBe('15/58');
			expect(Option.isNone(result.commit)).toBe(true);
		});

		it('constructs discard result with commit', () => {
			const result = new EvaluationResult({
				decision: 'discard',
				baselinePassed: '10/58',
				currentPassed: '8/58',
				reasoning: 'Regression',
				commit: Option.some('abc123')
			});
			expect(result.decision).toBe('discard');
			expect(Option.getOrElse(result.commit, () => 'missing')).toBe(
				'abc123'
			);
		});
	});

	describe('OptimizerState', () => {
		it('initialOptimizerState has zeroed values', () => {
			expect(initialOptimizerState.iteration).toBe(0);
			expect(initialOptimizerState.bestScore).toBe(0);
			expect(initialOptimizerState.bestPassed).toBe('0/0');
			expect(initialOptimizerState.consecutiveDiscards).toBe(0);
			expect(initialOptimizerState.totalKeeps).toBe(0);
			expect(initialOptimizerState.totalDiscards).toBe(0);
		});

		it('constructs with custom values', () => {
			const state = new OptimizerState({
				iteration: 5,
				bestScore: 0.75,
				bestPassed: '15/20',
				consecutiveDiscards: 2,
				totalKeeps: 3,
				totalDiscards: 2
			});
			expect(state.iteration).toBe(5);
			expect(state.bestScore).toBe(0.75);
			expect(state.bestPassed).toBe('15/20');
		});
	});

	describe('HarnessFile', () => {
		it('constructs with path and content', () => {
			const file = new HarnessFile({
				path: 'src/AgentConfig.ts',
				content: 'export const config = {};'
			});
			expect(file.path).toBe('src/AgentConfig.ts');
			expect(file.content).toBe('export const config = {};');
		});
	});

	describe('HarnessManifest', () => {
		it('constructs with explicit files', () => {
			const manifest = new HarnessManifest({
				editableFiles: ['src/A.ts'],
				fixedFiles: ['src/B.ts', 'src/C.ts'],
				buildCommand: 'bun run check',
				benchmarkTasksDir: 'tasks'
			});
			expect(manifest.editableFiles).toHaveLength(1);
			expect(manifest.fixedFiles).toHaveLength(2);
			expect(manifest.buildCommand).toBe('bun run check');
		});

		it('defaultManifest has expected editable files', () => {
			expect(defaultManifest.editableFiles).toContain(
				'src/AgentConfig.ts'
			);
			expect(defaultManifest.editableFiles).toContain(
				'src/AgentToolkit.ts'
			);
			expect(defaultManifest.editableFiles).toContain(
				'src/AgentExecutor.ts'
			);
			expect(defaultManifest.fixedFiles).toContain('src/Metrics.ts');
			expect(defaultManifest.benchmarkTasksDir).toBe('tasks');
		});
	});

	describe('DiagnosisOutput', () => {
		it('constructs with diagnoses and proposal', () => {
			const output = new DiagnosisOutput({
				diagnoses: [
					new FailureDiagnosis({
						category: 'missing_capability',
						taskNames: ['task-1'],
						description: 'Cannot read files',
						suggestedFix: 'Add file read tool'
					})
				],
				proposal: new ImprovementProposal({
					description: 'Add file reader',
					changeType: 'new_tool',
					rationale: 'Needed for file tasks',
					affectedFiles: ['src/AgentToolkit.ts']
				})
			});
			expect(output.diagnoses).toHaveLength(1);
			expect(output.proposal.changeType).toBe('new_tool');
		});
	});
});
