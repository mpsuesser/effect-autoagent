import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { defaultBlueprint } from '../src/AgentBlueprint.js';
import { SetSystemPrompt } from '../src/BlueprintPatch.js';
import {
	BlueprintDiagnosisOutput,
	BlueprintProposal,
	DiagnosisOutput,
	EvaluationResult,
	FailureDiagnosis,
	ImprovementProposal,
	initialOptimizerState
} from '../src/HarnessSpec.js';
import { MetaAgent } from '../src/MetaAgent.js';

describe('MetaAgent', () => {
	describe('test layer', () => {
		it.effect('step returns mock evaluation result', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.step;
				expect(result).toBeInstanceOf(EvaluationResult);
				expect(result.decision).toBe('keep');
				expect(result.currentPassed).toBe('1/10');
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('step uses custom handler when provided', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.step;
				expect(result.decision).toBe('discard');
				expect(result.reasoning).toBe('custom reasoning');
			}).pipe(
				Effect.provide(
					MetaAgent.test({
						step: () =>
							new EvaluationResult({
								decision: 'discard',
								baselinePassed: '5/10',
								currentPassed: '3/10',
								reasoning: 'custom reasoning'
							})
					})
				)
			)
		);

		it.effect('state returns initial optimizer state', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const state = yield* agent.state;
				expect(state.iteration).toBe(initialOptimizerState.iteration);
				expect(state.bestScore).toBe(initialOptimizerState.bestScore);
				expect(state.bestPassed).toBe(initialOptimizerState.bestPassed);
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('diagnose returns mock diagnosis output', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.diagnose;
				expect(result).toBeInstanceOf(DiagnosisOutput);
				expect(result.proposal.changeType).toBe('prompt_tuning');
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('diagnose uses custom handler', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.diagnose;
				expect(result.diagnoses).toHaveLength(1);
				expect(result.proposal.changeType).toBe('new_tool');
			}).pipe(
				Effect.provide(
					MetaAgent.test({
						diagnose: () =>
							new DiagnosisOutput({
								diagnoses: [
									new FailureDiagnosis({
										category: 'missing_capability',
										taskNames: ['task-1'],
										description: 'Missing tool',
										suggestedFix: 'Add tool'
									})
								],
								proposal: new ImprovementProposal({
									description: 'Add file reader',
									changeType: 'new_tool',
									rationale: 'Needed',
									affectedFiles: ['src/AgentToolkit.ts']
								})
							})
					})
				)
			)
		);

		it.effect('readHarness returns empty by default', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const files = yield* agent.readHarness;
				expect(files).toHaveLength(0);
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('readHarness uses custom handler', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const files = yield* agent.readHarness;
				expect(files).toHaveLength(1);
				expect(files[0]?.path).toBe('src/AgentConfig.ts');
			}).pipe(
				Effect.provide(
					MetaAgent.test({
						readHarness: () => [
							{
								path: 'src/AgentConfig.ts',
								content: 'export const config = {};'
							}
						]
					})
				)
			)
		);

		it.effect('recordAndEvaluate returns mock result', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result =
					yield* agent.recordAndEvaluate('test improvement');
				expect(result).toBeInstanceOf(EvaluationResult);
				expect(result.decision).toBe('keep');
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('recordAndEvaluate uses custom handler', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.recordAndEvaluate('custom change');
				expect(result.decision).toBe('discard');
				expect(result.reasoning).toBe('regression');
			}).pipe(
				Effect.provide(
					MetaAgent.test({
						recordAndEvaluate: () =>
							new EvaluationResult({
								decision: 'discard',
								baselinePassed: '5/10',
								currentPassed: '3/10',
								reasoning: 'regression'
							})
					})
				)
			)
		);

		it.effect('diagnoseBlueprint returns mock output', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.diagnoseBlueprint;
				expect(result).toBeInstanceOf(BlueprintDiagnosisOutput);
				expect(result.proposal).toBeInstanceOf(BlueprintProposal);
				expect(result.proposal.patches).toHaveLength(0);
				expect(result.proposal.description).toBe(
					'mock blueprint proposal'
				);
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('diagnoseBlueprint uses custom handler', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const result = yield* agent.diagnoseBlueprint;
				expect(result.diagnoses).toHaveLength(1);
				expect(result.proposal.patches).toHaveLength(1);
			}).pipe(
				Effect.provide(
					MetaAgent.test({
						diagnoseBlueprint: () =>
							new BlueprintDiagnosisOutput({
								diagnoses: [
									new FailureDiagnosis({
										category: 'missing_capability',
										taskNames: ['task-1'],
										description: 'Missing tool',
										suggestedFix: 'Add tool'
									})
								],
								proposal: new BlueprintProposal({
									description: 'Update prompt',
									rationale: 'Better results',
									patches: [
										new SetSystemPrompt({
											prompt: 'Improved prompt'
										})
									]
								})
							})
					})
				)
			)
		);

		it.effect('evaluatePatches returns mock result', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const patches = [new SetSystemPrompt({ prompt: 'New prompt' })];
				const result = yield* agent.evaluatePatches(
					patches,
					'test patch'
				);
				expect(result).toBeInstanceOf(EvaluationResult);
				expect(result.decision).toBe('keep');
			}).pipe(Effect.provide(MetaAgent.test()))
		);

		it.effect('evaluatePatches uses custom handler', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const patches = [new SetSystemPrompt({ prompt: 'New prompt' })];
				const result = yield* agent.evaluatePatches(
					patches,
					'custom patch'
				);
				expect(result.decision).toBe('discard');
				expect(result.reasoning).toBe('patch regression');
			}).pipe(
				Effect.provide(
					MetaAgent.test({
						evaluatePatches: () =>
							new EvaluationResult({
								decision: 'discard',
								baselinePassed: '5/10',
								currentPassed: '3/10',
								reasoning: 'patch regression'
							})
					})
				)
			)
		);

		it.effect('currentBlueprint returns defaultBlueprint', () =>
			Effect.gen(function* () {
				const agent = yield* MetaAgent.Service;
				const bp = yield* agent.currentBlueprint;
				expect(bp.name).toBe(defaultBlueprint.name);
				expect(bp.version).toBe(defaultBlueprint.version);
				expect(bp.systemPrompt).toBe(defaultBlueprint.systemPrompt);
			}).pipe(Effect.provide(MetaAgent.test()))
		);
	});
});
