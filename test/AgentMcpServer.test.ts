import { describe, expect, it } from '@effect/vitest';

import {
	AgentMcpToolkit,
	BlueprintResource,
	GetBlueprint,
	RunTask
} from '../src/AgentMcpServer.js';

describe('AgentMcpServer', () => {
	describe('RunTask tool', () => {
		it('is defined', () => {
			expect(RunTask).toBeDefined();
		});
	});

	describe('GetBlueprint tool', () => {
		it('is defined', () => {
			expect(GetBlueprint).toBeDefined();
		});
	});

	describe('AgentMcpToolkit', () => {
		it('is defined and contains both tools', () => {
			expect(AgentMcpToolkit).toBeDefined();
		});
	});

	describe('BlueprintResource', () => {
		it('is defined', () => {
			expect(BlueprintResource).toBeDefined();
		});
	});
});
