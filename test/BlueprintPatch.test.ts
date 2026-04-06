import { describe, expect, it } from '@effect/vitest';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';

import { defaultBlueprint } from '../src/AgentBlueprint.js';
import {
	AddTool,
	applyPatches,
	ModifyTool,
	RemoveTool,
	SetConstraints,
	SetModel,
	SetOrchestration,
	SetSystemPrompt
} from '../src/BlueprintPatch.js';
import { PlanAndExecute } from '../src/OrchestrationSpec.js';
import { ParamSpec, RunShellImpl, ToolSpec } from '../src/ToolSpec.js';

describe('BlueprintPatch', () => {
	describe('SetSystemPrompt', () => {
		it('changes system prompt', () => {
			const result = applyPatches(defaultBlueprint, [
				new SetSystemPrompt({ prompt: 'You are a coding assistant' })
			]);
			expect(result.systemPrompt).toBe('You are a coding assistant');
		});
	});

	describe('SetModel', () => {
		it('changes provider only (modelName unchanged)', () => {
			const result = applyPatches(defaultBlueprint, [
				new SetModel({ provider: 'anthropic' })
			]);
			expect(result.model.provider).toBe('anthropic');
			expect(result.model.modelName).toBe(
				defaultBlueprint.model.modelName
			);
		});

		it('changes modelName only (provider unchanged)', () => {
			const result = applyPatches(defaultBlueprint, [
				new SetModel({ modelName: 'o3' })
			]);
			expect(result.model.modelName).toBe('o3');
			expect(result.model.provider).toBe(defaultBlueprint.model.provider);
		});
	});

	describe('AddTool', () => {
		it('adds a tool to the toolkit', () => {
			const newTool = new ToolSpec({
				name: 'read_file',
				description: 'Read a file from the filesystem',
				parameters: [
					new ParamSpec({
						name: 'path',
						description: 'File path to read'
					})
				],
				implementation: new RunShellImpl({})
			});
			const result = applyPatches(defaultBlueprint, [
				new AddTool({ tool: newTool })
			]);
			expect(result.tools).toHaveLength(
				defaultBlueprint.tools.length + 1
			);
			expect(Option.map(Arr.last(result.tools), (t) => t.name)).toEqual(
				Option.some('read_file')
			);
		});
	});

	describe('RemoveTool', () => {
		it('removes a tool by name', () => {
			const result = applyPatches(defaultBlueprint, [
				new RemoveTool({ toolName: 'run_shell' })
			]);
			expect(result.tools).toHaveLength(0);
		});

		it('removing non-existent tool is a no-op', () => {
			const result = applyPatches(defaultBlueprint, [
				new RemoveTool({ toolName: 'does_not_exist' })
			]);
			expect(result.tools).toHaveLength(defaultBlueprint.tools.length);
		});
	});

	describe('ModifyTool', () => {
		it('updates tool description', () => {
			const result = applyPatches(defaultBlueprint, [
				new ModifyTool({
					toolName: 'run_shell',
					description: 'Execute a command in the container'
				})
			]);
			const modified = result.tools.find((t) => t.name === 'run_shell');
			expect(modified?.description).toBe(
				'Execute a command in the container'
			);
		});
	});

	describe('SetOrchestration', () => {
		it('changes strategy to PlanAndExecute', () => {
			const result = applyPatches(defaultBlueprint, [
				new SetOrchestration({
					strategy: new PlanAndExecute({
						plannerPrompt: 'Break the task into steps'
					})
				})
			]);
			expect(result.orchestration._tag).toBe('PlanAndExecute');
		});
	});

	describe('SetConstraints', () => {
		it('updates maxTurns only', () => {
			const result = applyPatches(defaultBlueprint, [
				new SetConstraints({ maxTurns: 50 })
			]);
			expect(result.constraints.maxTurns).toBe(50);
			expect(result.constraints.shellTimeoutSec).toBe(
				defaultBlueprint.constraints.shellTimeoutSec
			);
			expect(result.constraints.containerTimeoutSec).toBe(
				defaultBlueprint.constraints.containerTimeoutSec
			);
			expect(result.constraints.maxBudgetUsd).toBe(
				defaultBlueprint.constraints.maxBudgetUsd
			);
		});
	});

	describe('applyPatches', () => {
		it('applies multiple patches in sequence', () => {
			const newTool = new ToolSpec({
				name: 'list_dir',
				description: 'List directory contents',
				implementation: new RunShellImpl({})
			});
			const result = applyPatches(defaultBlueprint, [
				new SetSystemPrompt({ prompt: 'New prompt' }),
				new AddTool({ tool: newTool })
			]);
			expect(result.systemPrompt).toBe('New prompt');
			expect(result.tools).toHaveLength(
				defaultBlueprint.tools.length + 1
			);
			expect(Option.map(Arr.last(result.tools), (t) => t.name)).toEqual(
				Option.some('list_dir')
			);
		});

		it('empty patches returns unchanged blueprint', () => {
			const result = applyPatches(defaultBlueprint, []);
			expect(result.name).toBe(defaultBlueprint.name);
			expect(result.version).toBe(defaultBlueprint.version);
			expect(result.systemPrompt).toBe(defaultBlueprint.systemPrompt);
			expect(result.model.provider).toBe(defaultBlueprint.model.provider);
			expect(result.model.modelName).toBe(
				defaultBlueprint.model.modelName
			);
			expect(result.tools).toHaveLength(defaultBlueprint.tools.length);
		});
	});
});
