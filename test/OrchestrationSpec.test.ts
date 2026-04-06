import { describe, expect, it } from '@effect/vitest';

import {
	FallbackModels,
	PlanAndExecute,
	SingleLoop,
	WithVerifier,
	defaultOrchestration,
	isFallbackModels,
	isPlanAndExecute,
	isSingleLoop,
	isWithVerifier,
	match,
	type OrchestrationSpec
} from '../src/OrchestrationSpec.js';

describe('OrchestrationSpec', () => {
	describe('SingleLoop', () => {
		it('constructs with no fields', () => {
			const spec = new SingleLoop({});
			expect(spec._tag).toBe('SingleLoop');
		});
	});

	describe('PlanAndExecute', () => {
		it('constructs with defaults', () => {
			const spec = new PlanAndExecute({
				plannerPrompt: 'Break this task into steps'
			});
			expect(spec._tag).toBe('PlanAndExecute');
			expect(spec.plannerPrompt).toBe('Break this task into steps');
			expect(spec.maxPlanSteps).toBe(10);
		});

		it('constructs with explicit values', () => {
			const spec = new PlanAndExecute({
				plannerPrompt: 'Custom planner prompt',
				maxPlanSteps: 5
			});
			expect(spec.plannerPrompt).toBe('Custom planner prompt');
			expect(spec.maxPlanSteps).toBe(5);
		});
	});

	describe('WithVerifier', () => {
		it('constructs with defaults', () => {
			const spec = new WithVerifier({
				verifierPrompt: 'Verify the output is correct'
			});
			expect(spec._tag).toBe('WithVerifier');
			expect(spec.verifierPrompt).toBe('Verify the output is correct');
			expect(spec.maxRetries).toBe(2);
		});

		it('constructs with explicit values', () => {
			const spec = new WithVerifier({
				verifierPrompt: 'Custom verifier',
				maxRetries: 5
			});
			expect(spec.verifierPrompt).toBe('Custom verifier');
			expect(spec.maxRetries).toBe(5);
		});
	});

	describe('FallbackModels', () => {
		it('constructs with model list', () => {
			const spec = new FallbackModels({
				models: ['gpt-5.4', 'claude-sonnet-4-6', 'gpt-4o']
			});
			expect(spec._tag).toBe('FallbackModels');
			expect(spec.models).toEqual([
				'gpt-5.4',
				'claude-sonnet-4-6',
				'gpt-4o'
			]);
		});
	});

	describe('defaultOrchestration', () => {
		it('is a SingleLoop', () => {
			expect(defaultOrchestration._tag).toBe('SingleLoop');
			expect(isSingleLoop(defaultOrchestration)).toBe(true);
		});
	});

	describe('Guards', () => {
		it('correctly identifies each variant', () => {
			const single: OrchestrationSpec = new SingleLoop({});
			const plan: OrchestrationSpec = new PlanAndExecute({
				plannerPrompt: 'plan'
			});
			const verifier: OrchestrationSpec = new WithVerifier({
				verifierPrompt: 'verify'
			});
			const fallback: OrchestrationSpec = new FallbackModels({
				models: ['gpt-5.4']
			});

			expect(isSingleLoop(single)).toBe(true);
			expect(isSingleLoop(plan)).toBe(false);
			expect(isSingleLoop(verifier)).toBe(false);
			expect(isSingleLoop(fallback)).toBe(false);

			expect(isPlanAndExecute(plan)).toBe(true);
			expect(isPlanAndExecute(single)).toBe(false);

			expect(isWithVerifier(verifier)).toBe(true);
			expect(isWithVerifier(single)).toBe(false);

			expect(isFallbackModels(fallback)).toBe(true);
			expect(isFallbackModels(single)).toBe(false);
		});
	});

	describe('match', () => {
		it('exhaustive pattern matching dispatches correctly', () => {
			const describe = match({
				SingleLoop: () => 'single',
				PlanAndExecute: (s) => `plan:${s.maxPlanSteps}`,
				WithVerifier: (s) => `verify:${s.maxRetries}`,
				FallbackModels: (s) => `fallback:${s.models.length}`
			});

			expect(describe(new SingleLoop({}))).toBe('single');
			expect(
				describe(
					new PlanAndExecute({ plannerPrompt: 'p', maxPlanSteps: 7 })
				)
			).toBe('plan:7');
			expect(
				describe(
					new WithVerifier({
						verifierPrompt: 'v',
						maxRetries: 3
					})
				)
			).toBe('verify:3');
			expect(describe(new FallbackModels({ models: ['a', 'b'] }))).toBe(
				'fallback:2'
			);
		});
	});
});
