import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Option from 'effect/Option';

import { EnvironmentError } from '../src/Errors.js';
import { Environment } from '../src/Environment.js';
import { ExecResult } from '../src/ExecResult.js';
import { runShell } from '../src/ShellTool.js';

describe('runShell', () => {
	it.effect('returns combined output on success', () =>
		Effect.gen(function* () {
			const result = yield* runShell('echo hello', 120);
			expect(result).toBe('hello world');
		}).pipe(
			Effect.provide(
				Environment.test({
					exec: () =>
						new ExecResult({
							stdout: Option.some('hello world'),
							stderr: Option.none()
						})
				})
			)
		)
	);

	it.effect('returns (no output) when both empty', () =>
		Effect.gen(function* () {
			const result = yield* runShell('true', 120);
			expect(result).toBe('(no output)');
		}).pipe(
			Effect.provide(
				Environment.test({
					exec: () =>
						new ExecResult({
							stdout: Option.none(),
							stderr: Option.none()
						})
				})
			)
		)
	);

	it.effect('returns error string on environment failure', () =>
		Effect.gen(function* () {
			const result = yield* runShell('bad-cmd', 120);
			expect(result).toContain('ERROR:');
		}).pipe(
			Effect.provide(
				Layer.succeed(
					Environment.Service,
					Environment.Service.of({
						exec: () =>
							Effect.fail(
								new EnvironmentError({
									operation: 'exec',
									message: 'Command timed out'
								})
							),
						uploadFile: () => Effect.void,
						mkdir: () => Effect.void
					})
				)
			)
		)
	);

	it.effect('combines stdout and stderr', () =>
		Effect.gen(function* () {
			const result = yield* runShell('compile', 120);
			expect(result).toBe('output\nSTDERR:\nwarning');
		}).pipe(
			Effect.provide(
				Environment.test({
					exec: () =>
						new ExecResult({
							stdout: Option.some('output'),
							stderr: Option.some('warning')
						})
				})
			)
		)
	);
});
