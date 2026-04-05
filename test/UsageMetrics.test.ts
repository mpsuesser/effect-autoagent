import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import { ResponseUsage, UsageAccumulator, empty } from '../src/UsageMetrics.js';

describe('UsageSnapshot', () => {
	it('empty has all zeros', () => {
		expect(empty.inputTokens).toBe(0);
		expect(empty.outputTokens).toBe(0);
		expect(empty.cachedTokens).toBe(0);
	});
});

describe('UsageAccumulator', () => {
	it('accumulates across multiple responses', () => {
		const acc = new UsageAccumulator();
		acc.add(
			new ResponseUsage({
				input_tokens: Option.some(100),
				output_tokens: Option.some(50),
				cache_read_input_tokens: Option.some(10)
			})
		);
		acc.add(
			new ResponseUsage({
				input_tokens: Option.some(200),
				output_tokens: Option.some(75),
				cache_read_input_tokens: Option.none()
			})
		);

		const snapshot = acc.snapshot();
		expect(snapshot.inputTokens).toBe(300);
		expect(snapshot.outputTokens).toBe(125);
		expect(snapshot.cachedTokens).toBe(10);
	});

	it('handles all-none usage', () => {
		const acc = new UsageAccumulator();
		acc.add(
			new ResponseUsage({
				input_tokens: Option.none(),
				output_tokens: Option.none(),
				cache_read_input_tokens: Option.none()
			})
		);
		const snapshot = acc.snapshot();
		expect(snapshot.inputTokens).toBe(0);
		expect(snapshot.outputTokens).toBe(0);
		expect(snapshot.cachedTokens).toBe(0);
	});

	it('snapshot without any adds returns zeros', () => {
		const acc = new UsageAccumulator();
		const snapshot = acc.snapshot();
		expect(snapshot).toEqual(empty);
	});
});
