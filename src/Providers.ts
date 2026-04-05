/**
 * Bundled AI provider layers for OpenAI and Anthropic.
 *
 * Pre-wired layers that construct `LanguageModel.LanguageModel` from
 * model identifiers, reading API keys from `Config.redacted`. Consumers
 * provide one of these layers to the `AgentExecutor`.
 *
 * @since 0.2.0
 */
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { Config, Layer } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';

// =============================================================================
// Client Layers (reusable)
// =============================================================================

/**
 * OpenAI client layer. Reads `OPENAI_API_KEY` from config.
 *
 * @since 0.2.0
 */
export const OpenAiClientLayer = OpenAiClient.layerConfig({
	apiKey: Config.redacted('OPENAI_API_KEY')
}).pipe(Layer.provide(FetchHttpClient.layer));

/**
 * Anthropic client layer. Reads `ANTHROPIC_API_KEY` from config.
 *
 * @since 0.2.0
 */
export const AnthropicClientLayer = AnthropicClient.layerConfig({
	apiKey: Config.redacted('ANTHROPIC_API_KEY')
}).pipe(Layer.provide(FetchHttpClient.layer));

// =============================================================================
// Model Layers
// =============================================================================

/**
 * Create an OpenAI LanguageModel layer for a specific model.
 *
 * Fully wired — includes HTTP client and API key configuration.
 *
 * @example
 * ```ts
 * const layer = openAiModel("gpt-5.4")
 * ```
 *
 * @since 0.2.0
 */
export const openAiModel = (model: string) =>
	OpenAiLanguageModel.layer({ model }).pipe(Layer.provide(OpenAiClientLayer));

/**
 * Create an Anthropic LanguageModel layer for a specific model.
 *
 * Fully wired — includes HTTP client and API key configuration.
 *
 * @example
 * ```ts
 * const layer = anthropicModel("claude-sonnet-4-6")
 * ```
 *
 * @since 0.2.0
 */
export const anthropicModel = (model: string) =>
	AnthropicLanguageModel.layer({ model }).pipe(
		Layer.provide(AnthropicClientLayer)
	);
