import { describe, expect, it } from '@effect/vitest';
import * as Schema from 'effect/Schema';

import {
	AgentBlueprint,
	AgentConstraints,
	BlueprintJson,
	defaultBlueprint,
	ModelConfig,
	ThinkingConfig
} from '../src/AgentBlueprint.js';

describe('ThinkingConfig', () => {
	it('constructs with defaults (disabled, 0 tokens)', () => {
		const config = new ThinkingConfig({});
		expect(config.type).toBe('disabled');
		expect(config.budgetTokens).toBe(0);
	});

	it('constructs with enabled thinking', () => {
		const config = new ThinkingConfig({
			type: 'enabled',
			budgetTokens: 10000
		});
		expect(config.type).toBe('enabled');
		expect(config.budgetTokens).toBe(10000);
	});
});

describe('ModelConfig', () => {
	it('constructs with defaults (openai, gpt-5.4)', () => {
		const config = new ModelConfig({});
		expect(config.provider).toBe('openai');
		expect(config.modelName).toBe('gpt-5.4');
		expect(config.thinking.type).toBe('disabled');
		expect(config.thinking.budgetTokens).toBe(0);
	});

	it('constructs with custom model', () => {
		const config = new ModelConfig({
			provider: 'anthropic',
			modelName: 'claude-sonnet-4-6',
			thinking: new ThinkingConfig({
				type: 'enabled',
				budgetTokens: 5000
			})
		});
		expect(config.provider).toBe('anthropic');
		expect(config.modelName).toBe('claude-sonnet-4-6');
		expect(config.thinking.type).toBe('enabled');
		expect(config.thinking.budgetTokens).toBe(5000);
	});
});

describe('AgentConstraints', () => {
	it('constructs with defaults (100 turns, 120s shell, 600s container, $10)', () => {
		const constraints = new AgentConstraints({});
		expect(constraints.maxTurns).toBe(100);
		expect(constraints.shellTimeoutSec).toBe(120);
		expect(constraints.containerTimeoutSec).toBe(600);
		expect(constraints.maxBudgetUsd).toBe(10);
	});
});

describe('AgentBlueprint', () => {
	it('constructs with all defaults (defaultBlueprint)', () => {
		expect(defaultBlueprint).toBeInstanceOf(AgentBlueprint);
	});

	it('defaultBlueprint has correct default values', () => {
		expect(defaultBlueprint.systemPrompt).toBe(
			'You are an agent that executes tasks'
		);
		expect(defaultBlueprint.model.provider).toBe('openai');
		expect(defaultBlueprint.tools).toHaveLength(1);
		expect(defaultBlueprint.orchestration._tag).toBe('SingleLoop');
	});

	it('constructs with custom system prompt', () => {
		const bp = new AgentBlueprint({
			systemPrompt: 'You are a helpful coding assistant'
		});
		expect(bp.systemPrompt).toBe('You are a helpful coding assistant');
		expect(bp.name).toBe('autoagent');
		expect(bp.version).toBe('0.1.0');
	});

	it('constructs with custom tools (empty array)', () => {
		const bp = new AgentBlueprint({ tools: [] });
		expect(bp.tools).toHaveLength(0);
	});
});

describe('BlueprintJson', () => {
	it('round-trip: encode to JSON string, decode back, verify fields match', () => {
		const encoded = Schema.encodeSync(BlueprintJson)(defaultBlueprint);
		expect(typeof encoded).toBe('string');

		const decoded = Schema.decodeUnknownSync(BlueprintJson)(encoded);
		expect(decoded.name).toBe(defaultBlueprint.name);
		expect(decoded.version).toBe(defaultBlueprint.version);
		expect(decoded.systemPrompt).toBe(defaultBlueprint.systemPrompt);
		expect(decoded.model.provider).toBe(defaultBlueprint.model.provider);
		expect(decoded.model.modelName).toBe(defaultBlueprint.model.modelName);
		expect(decoded.tools).toHaveLength(defaultBlueprint.tools.length);
		expect(decoded.orchestration._tag).toBe(
			defaultBlueprint.orchestration._tag
		);
		expect(decoded.constraints.maxTurns).toBe(
			defaultBlueprint.constraints.maxTurns
		);
		expect(decoded.description).toBe(defaultBlueprint.description);
	});
});
