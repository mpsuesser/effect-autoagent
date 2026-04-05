import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import {
	DockerfileOptions,
	bunAgent,
	pythonBase
} from '../src/DockerfileGenerator.js';

describe('DockerfileGenerator', () => {
	describe('pythonBase', () => {
		it('generates Dockerfile matching upstream Dockerfile.base', () => {
			const content = pythonBase();
			expect(content).toContain(
				'FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim'
			);
			expect(content).toContain('WORKDIR /app');
			expect(content).toContain('COPY pyproject.toml ./');
			expect(content).toContain('RUN uv pip install --system .');
			expect(content).toContain('COPY agent.py ./');
			expect(content).toContain('RUN mkdir -p /logs /app/output');
		});
	});

	describe('bunAgent', () => {
		it('generates Dockerfile with defaults', () => {
			const content = bunAgent();
			expect(content).toContain('FROM oven/bun:1.3-debian');
			expect(content).toContain('WORKDIR /app');
			expect(content).toContain('COPY package.json bun.lock ./');
			expect(content).toContain('RUN bun install --frozen-lockfile');
			expect(content).toContain('COPY . .');
			expect(content).toContain('RUN mkdir -p /logs /app/output');
			expect(content).toContain('ca-certificates');
			expect(content).toContain('git');
			expect(content).toContain('curl');
		});

		it('uses custom base image', () => {
			const content = bunAgent(
				new DockerfileOptions({
					baseImage: 'node:22-slim'
				})
			);
			expect(content).toContain('FROM node:22-slim');
		});

		it('includes entrypoint when specified', () => {
			const content = bunAgent(
				new DockerfileOptions({
					entrypoint: Option.some('src/main.ts')
				})
			);
			expect(content).toContain(
				'ENTRYPOINT ["bun", "run", "src/main.ts"]'
			);
		});

		it('omits entrypoint when not specified', () => {
			const content = bunAgent();
			expect(content).not.toContain('ENTRYPOINT');
		});

		it('includes extra commands', () => {
			const content = bunAgent(
				new DockerfileOptions({
					extraCommands: ['RUN echo "setup"', 'ENV FOO=bar']
				})
			);
			expect(content).toContain('RUN echo "setup"');
			expect(content).toContain('ENV FOO=bar');
		});

		it('uses custom workdir', () => {
			const content = bunAgent(
				new DockerfileOptions({
					workdir: '/workspace'
				})
			);
			expect(content).toContain('WORKDIR /workspace');
		});

		it('handles empty system packages', () => {
			const content = bunAgent(
				new DockerfileOptions({
					systemPackages: []
				})
			);
			expect(content).not.toContain('apt-get');
		});
	});

	describe('DockerfileOptions', () => {
		it('constructs with all defaults', () => {
			const opts = new DockerfileOptions({});
			expect(opts.baseImage).toBe('oven/bun:1.3-debian');
			expect(opts.workdir).toBe('/app');
			expect(opts.systemPackages).toEqual([
				'ca-certificates',
				'git',
				'curl'
			]);
			expect(Option.isNone(opts.entrypoint)).toBe(true);
			expect(opts.extraCommands).toEqual([]);
		});
	});
});
