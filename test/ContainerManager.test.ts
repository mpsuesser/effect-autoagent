import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Option from 'effect/Option';

import { BuildResult, ContainerManager } from '../src/ContainerManager.js';
import { ExecResult } from '../src/ExecResult.js';

describe('ContainerManager', () => {
	describe('test layer', () => {
		it.effect('buildImage returns mock result with default handler', () =>
			Effect.gen(function* () {
				const cm = yield* ContainerManager.Service;
				const result = yield* cm.buildImage({
					dockerfile: 'Dockerfile',
					contextDir: '.',
					tag: 'test-image:v1'
				});
				expect(result).toBeInstanceOf(BuildResult);
				expect(result.imageName).toBe('test-image:v1');
				expect(result.tag).toBe('latest');
			}).pipe(Effect.provide(ContainerManager.test()))
		);

		it.effect('buildImage uses custom handler when provided', () =>
			Effect.gen(function* () {
				const cm = yield* ContainerManager.Service;
				const result = yield* cm.buildImage({
					dockerfile: 'Dockerfile',
					contextDir: '.',
					tag: 'my-image:dev'
				});
				expect(result.imageName).toBe('custom');
				expect(result.output).toBe('built');
			}).pipe(
				Effect.provide(
					ContainerManager.test({
						buildImage: () =>
							new BuildResult({
								imageName: 'custom',
								tag: 'dev',
								output: 'built'
							})
					})
				)
			)
		);

		it.effect(
			'execInContainer returns mock result with default handler',
			() =>
				Effect.gen(function* () {
					const cm = yield* ContainerManager.Service;
					const result = yield* cm.execInContainer({
						containerId: 'abc123',
						command: 'echo hello'
					});
					expect(result).toBeInstanceOf(ExecResult);
					expect(
						Option.getOrElse(result.stdout, () => 'fallback')
					).toBe('');
				}).pipe(Effect.provide(ContainerManager.test()))
		);

		it.effect('execInContainer uses custom handler when provided', () =>
			Effect.gen(function* () {
				const cm = yield* ContainerManager.Service;
				const result = yield* cm.execInContainer({
					containerId: 'abc123',
					command: 'ls -la'
				});
				expect(Option.getOrElse(result.stdout, () => '')).toBe(
					'file1.txt\nfile2.txt'
				);
			}).pipe(
				Effect.provide(
					ContainerManager.test({
						execInContainer: () =>
							new ExecResult({
								stdout: Option.some('file1.txt\nfile2.txt'),
								stderr: Option.none()
							})
					})
				)
			)
		);

		it.effect('copyToContainer succeeds with mock', () =>
			Effect.gen(function* () {
				const cm = yield* ContainerManager.Service;
				yield* cm.copyToContainer({
					containerId: 'abc123',
					content: 'hello world',
					targetPath: '/tmp/test.txt'
				});
			}).pipe(Effect.provide(ContainerManager.test()))
		);

		it.effect('removeContainer succeeds with mock', () =>
			Effect.gen(function* () {
				const cm = yield* ContainerManager.Service;
				yield* cm.removeContainer('abc123');
			}).pipe(Effect.provide(ContainerManager.test()))
		);
	});
});
