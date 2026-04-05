/**
 * Token usage accumulation and metrics tracking.
 *
 * Provides a schema-backed mutable accumulator for token counts across
 * multiple API responses, mirroring the Python `Usage()` aggregation
 * pattern.
 *
 * @since 0.1.0
 */
import { pipe } from 'effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

// =============================================================================
// Usage Snapshot
// =============================================================================

/**
 * Immutable snapshot of accumulated token usage from one or more API
 * responses.
 *
 * @since 0.1.0
 */
export class UsageSnapshot extends Schema.Class<UsageSnapshot>('UsageSnapshot')(
	{
		inputTokens: Schema.Number,
		outputTokens: Schema.Number,
		cachedTokens: Schema.Number
	},
	{ description: 'Accumulated token usage across API responses.' }
) {}

/**
 * Zero-value usage snapshot.
 *
 * @category Identity
 * @since 0.1.0
 */
export const empty = new UsageSnapshot({
	inputTokens: 0,
	outputTokens: 0,
	cachedTokens: 0
});

// =============================================================================
// Usage Accumulator
// =============================================================================

/**
 * Single API response usage that can be fed into the accumulator.
 *
 * @since 0.1.0
 */
export class ResponseUsage extends Schema.Class<ResponseUsage>('ResponseUsage')(
	{
		input_tokens: Schema.OptionFromNullishOr(Schema.Number),
		output_tokens: Schema.OptionFromNullishOr(Schema.Number),
		cache_read_input_tokens: Schema.OptionFromNullishOr(Schema.Number)
	},
	{
		description:
			'Token usage from a single API response, with nullable fields.'
	}
) {}

/**
 * Mutable token usage accumulator. Accumulates usage across multiple
 * API responses and produces an immutable `UsageSnapshot`.
 *
 * @since 0.1.0
 */
export class UsageAccumulator {
	private inputTokens = 0;
	private outputTokens = 0;
	private cachedTokens = 0;

	/**
	 * Add usage from a single API response.
	 *
	 * @since 0.1.0
	 */
	add(usage: ResponseUsage): void {
		this.inputTokens += pipe(
			usage.input_tokens,
			Option.getOrElse(() => 0)
		);
		this.outputTokens += pipe(
			usage.output_tokens,
			Option.getOrElse(() => 0)
		);
		this.cachedTokens += pipe(
			usage.cache_read_input_tokens,
			Option.getOrElse(() => 0)
		);
	}

	/**
	 * Produce an immutable snapshot of accumulated usage.
	 *
	 * @since 0.1.0
	 */
	snapshot(): UsageSnapshot {
		return new UsageSnapshot({
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
			cachedTokens: this.cachedTokens
		});
	}
}
