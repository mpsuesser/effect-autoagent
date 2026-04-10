/**
 * Dockerfile content generation for agent containers.
 *
 * Produces Dockerfile text for both the Python-based base image
 * (matching the upstream `Dockerfile.base`) and a Bun-based variant
 * for Effect-native agent execution inside containers.
 *
 * All functions are pure — they return strings without side effects.
 *
 * @since 0.2.0
 */
import { Effect, pipe } from 'effect';
import * as Arr from 'effect/Array';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

// =============================================================================
// Generator Options
// =============================================================================

/**
 * Options for generating a Dockerfile.
 *
 * @since 0.2.0
 */
export class DockerfileOptions extends Schema.Class<DockerfileOptions>(
	'DockerfileOptions'
)(
	{
		baseImage: Schema.String.pipe(
			Schema.withDecodingDefault(Effect.succeed('oven/bun:1.3-debian')),
			Schema.withConstructorDefault(Effect.succeed('oven/bun:1.3-debian'))
		),
		systemPackages: Schema.Array(Schema.String).pipe(
			Schema.withDecodingDefault(
				Effect.succeed(['ca-certificates', 'git', 'curl'])
			),
			Schema.withConstructorDefault(
				Effect.succeed(['ca-certificates', 'git', 'curl'])
			)
		),
		workdir: Schema.String.pipe(
			Schema.withDecodingDefault(Effect.succeed('/app')),
			Schema.withConstructorDefault(Effect.succeed('/app'))
		),
		entrypoint: Schema.OptionFromOptionalKey(Schema.String).pipe(
			Schema.withConstructorDefault(Effect.succeed(Option.none()))
		),
		extraCommands: Schema.Array(Schema.String).pipe(
			Schema.withDecodingDefault(
				Effect.succeed<ReadonlyArray<string>>([])
			),
			Schema.withConstructorDefault(
				Effect.succeed<ReadonlyArray<string>>([])
			)
		)
	},
	{
		description: 'Options for generating a Dockerfile for agent containers.'
	}
) {}

// =============================================================================
// Python Base Image (parity with Dockerfile.base)
// =============================================================================

/**
 * Generate a Dockerfile matching the upstream Python `Dockerfile.base`.
 *
 * Produces the exact same image structure as the Python autoagent
 * base image — UV + Python 3.12, with `agent.py` copied in.
 *
 * @since 0.2.0
 */
export const pythonBase = (): string =>
	[
		'FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim',
		'',
		'RUN apt-get update && \\',
		'    apt-get install -y --no-install-recommends ca-certificates git && \\',
		'    rm -rf /var/lib/apt/lists/*',
		'',
		'WORKDIR /app',
		'',
		'COPY pyproject.toml ./',
		'RUN uv pip install --system .',
		'',
		'COPY agent.py ./',
		'',
		'RUN ln -sf $(which python3) /usr/local/bin/python',
		'RUN mkdir -p /logs /app/output'
	].join('\n');

// =============================================================================
// Bun-Based Agent Image
// =============================================================================

/**
 * Generate a Dockerfile for a Bun-based agent container.
 *
 * Creates an image with Bun runtime, system dependencies, and the
 * agent entrypoint. Suitable for running the Effect-native agent
 * inside a container.
 *
 * @since 0.2.0
 */
export const bunAgent = (options?: DockerfileOptions): string => {
	const opts = options ?? new DockerfileOptions({});

	const systemPkgLine = pipe(
		opts.systemPackages,
		Arr.match({
			onEmpty: () => Option.none<string>(),
			onNonEmpty: (pkgs) =>
				Option.some(
					`RUN apt-get update && \\\n    apt-get install -y --no-install-recommends ${Arr.join(pkgs, ' ')} && \\\n    rm -rf /var/lib/apt/lists/*`
				)
		})
	);

	const entrypointLine = Option.map(
		opts.entrypoint,
		(ep) => `ENTRYPOINT ["bun", "run", "${ep}"]`
	);

	const extraLines = pipe(
		opts.extraCommands,
		Arr.match({
			onEmpty: () => Option.none<string>(),
			onNonEmpty: (cmds) => Option.some(Arr.join(cmds, '\n'))
		})
	);

	const lines: Array<string> = [
		`FROM ${opts.baseImage}`,
		'',
		...Option.match(systemPkgLine, {
			onNone: () => [],
			onSome: (line) => [line, '']
		}),
		`WORKDIR ${opts.workdir}`,
		'',
		'COPY package.json bun.lock ./',
		'RUN bun install --frozen-lockfile',
		'',
		'COPY . .',
		'',
		'RUN mkdir -p /logs /app/output',
		...Option.match(extraLines, {
			onNone: () => [],
			onSome: (cmds) => ['', cmds]
		}),
		...Option.match(entrypointLine, {
			onNone: () => [],
			onSome: (line) => ['', line]
		})
	];

	return Arr.join(lines, '\n');
};
