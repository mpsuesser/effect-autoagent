import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import { ExecResult } from '../src/ExecResult.js';

describe('ExecResult', () => {
	it('combinedOutput returns stdout when only stdout present', () => {
		const result = new ExecResult({
			stdout: Option.some('hello'),
			stderr: Option.none()
		});
		expect(result.combinedOutput).toBe('hello');
	});

	it('combinedOutput returns STDERR prefix when only stderr present', () => {
		const result = new ExecResult({
			stdout: Option.none(),
			stderr: Option.some('error msg')
		});
		expect(result.combinedOutput).toBe('STDERR:\nerror msg');
	});

	it('combinedOutput combines stdout and stderr', () => {
		const result = new ExecResult({
			stdout: Option.some('out'),
			stderr: Option.some('err')
		});
		expect(result.combinedOutput).toBe('out\nSTDERR:\nerr');
	});

	it('combinedOutput returns (no output) when both empty', () => {
		const result = new ExecResult({
			stdout: Option.none(),
			stderr: Option.none()
		});
		expect(result.combinedOutput).toBe('(no output)');
	});

	it('combinedOutput returns (no output) when both empty strings', () => {
		const result = new ExecResult({
			stdout: Option.some(''),
			stderr: Option.some('')
		});
		expect(result.combinedOutput).toBe('(no output)');
	});
});
