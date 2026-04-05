import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import {
	AgentConfig,
	claudeDefault,
	openAiDefault
} from '../src/AgentConfig.js';

describe('AgentConfig', () => {
	it('openAiDefault has expected values', () => {
		expect(openAiDefault.systemPrompt).toBe(
			'You are an agent that executes tasks'
		);
		expect(openAiDefault.model).toBe('gpt-5');
		expect(openAiDefault.maxTurns).toBe(30);
		expect(openAiDefault.name).toBe('autoagent');
		expect(openAiDefault.version).toBe('0.1.0');
		expect(openAiDefault.shellTimeoutSec).toBe(120);
		expect(openAiDefault.containerTimeoutSec).toBe(600);
		expect(Option.isNone(openAiDefault.thinking)).toBe(true);
		expect(Option.isNone(openAiDefault.toolPreset)).toBe(true);
		expect(Option.isNone(openAiDefault.maxBudgetUsd)).toBe(true);
	});

	it('claudeDefault has expected values', () => {
		expect(claudeDefault.model).toBe('haiku');
		expect(claudeDefault.systemPrompt).toContain(
			'highly capable task-completion agent'
		);
		expect(Option.isSome(claudeDefault.thinking)).toBe(true);
		expect(Option.isSome(claudeDefault.toolPreset)).toBe(true);
	});

	it('claudeDefault thinking budget is 10000', () => {
		const thinking = Option.getOrThrow(claudeDefault.thinking);
		expect(thinking.budget_tokens).toBe(10000);
	});

	it('claudeDefault tool preset is claude_code', () => {
		const preset = Option.getOrThrow(claudeDefault.toolPreset);
		expect(preset.preset).toBe('claude_code');
	});

	it('constructs with partial overrides', () => {
		const config = new AgentConfig({
			model: 'gpt-4o',
			maxTurns: 10
		});
		expect(config.model).toBe('gpt-4o');
		expect(config.maxTurns).toBe(10);
		expect(config.name).toBe('autoagent');
		expect(config.systemPrompt).toBe(
			'You are an agent that executes tasks'
		);
	});
});
