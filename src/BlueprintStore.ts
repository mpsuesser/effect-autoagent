/**
 * Blueprint persistence and versioning service.
 *
 * Stores AgentBlueprint values as JSON files in a `.autoagent/blueprints/`
 * directory with timestamped version history for rollback.
 *
 * @since 0.3.0
 */
import { Clock, Effect, FileSystem, Layer, Order, ServiceMap } from 'effect';
import * as Arr from 'effect/Array';
import * as Schema from 'effect/Schema';

import {
	AgentBlueprint,
	BlueprintJson,
	defaultBlueprint
} from './AgentBlueprint.js';

// Re-export for consumer convenience
export { AgentBlueprint, BlueprintJson, defaultBlueprint };

// =============================================================================
// Error
// =============================================================================

/**
 * Failure during blueprint storage operations.
 *
 * @since 0.3.0
 */
export class BlueprintStoreError extends Schema.TaggedErrorClass<BlueprintStoreError>()(
	'BlueprintStoreError',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect)
	},
	{ description: 'Failed to read, write, or manage blueprint storage.' }
) {}

// =============================================================================
// Helpers
// =============================================================================

/** Descending string order (newest version filenames first). */
const descString: Order.Order<string> = Order.make((self, that) =>
	self > that ? -1 : 1
);

// =============================================================================
// Service
// =============================================================================

/**
 * Service for persisting and versioning AgentBlueprint values.
 *
 * @since 0.3.0
 */
export namespace BlueprintStore {
	/**
	 * BlueprintStore service interface.
	 *
	 * @since 0.3.0
	 */
	export interface Interface {
		/**
		 * Get the current (latest) blueprint. Returns defaultBlueprint if
		 * none saved.
		 *
		 * @since 0.3.0
		 */
		readonly current: Effect.Effect<AgentBlueprint, BlueprintStoreError>;

		/**
		 * Save a blueprint as the new current version. Assigns a version
		 * timestamp.
		 *
		 * @since 0.3.0
		 */
		readonly save: (
			blueprint: AgentBlueprint
		) => Effect.Effect<void, BlueprintStoreError>;

		/**
		 * List all saved blueprint versions, newest first.
		 *
		 * @since 0.3.0
		 */
		readonly history: Effect.Effect<
			ReadonlyArray<{
				readonly version: string;
				readonly blueprint: AgentBlueprint;
			}>,
			BlueprintStoreError
		>;

		/**
		 * Rollback to a specific version by version string.
		 *
		 * @since 0.3.0
		 */
		readonly rollback: (
			version: string
		) => Effect.Effect<AgentBlueprint, BlueprintStoreError>;
	}

	/**
	 * BlueprintStore service tag.
	 *
	 * @since 0.3.0
	 */
	export class Service extends ServiceMap.Service<Service, Interface>()(
		'@autoagent/BlueprintStore'
	) {}

	/**
	 * Live layer backed by the filesystem.
	 *
	 * Stores blueprints as JSON files in `.autoagent/blueprints/` with
	 * timestamped version files (`v-<millis>.json`) and a `current.json`
	 * copy of the latest version.
	 *
	 * @since 0.3.0
	 */
	export const layer = Layer.effect(
		Service,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const baseDir = '.autoagent/blueprints';

			// Ensure directory exists
			yield* fs
				.makeDirectory(baseDir, { recursive: true })
				.pipe(Effect.catch(() => Effect.void));

			const currentPath = `${baseDir}/current.json`;

			const wrapError =
				(operation: string, message: string) => (cause: unknown) =>
					new BlueprintStoreError({ operation, message, cause });

			const current: Effect.Effect<AgentBlueprint, BlueprintStoreError> =
				Effect.gen(function* () {
					const exists = yield* fs
						.exists(currentPath)
						.pipe(
							Effect.mapError(
								wrapError(
									'read',
									'Failed to check current blueprint existence'
								)
							)
						);
					if (!exists) return defaultBlueprint;

					const content = yield* fs
						.readFileString(currentPath)
						.pipe(
							Effect.mapError(
								wrapError(
									'read',
									'Failed to read current blueprint'
								)
							)
						);

					return yield* Schema.decodeUnknownEffect(BlueprintJson)(
						content
					).pipe(
						Effect.mapError(
							wrapError('decode', 'Failed to decode blueprint')
						)
					);
				}).pipe(Effect.withLogSpan('BlueprintStore.current'));

			const save = Effect.fn('BlueprintStore.save')(function* (
				blueprint: AgentBlueprint
			) {
				const json = yield* Schema.encodeEffect(BlueprintJson)(
					blueprint
				).pipe(
					Effect.mapError(
						wrapError('encode', 'Failed to encode blueprint')
					)
				);
				const millis = yield* Clock.currentTimeMillis;
				const version = `v-${millis}`;
				const versionPath = `${baseDir}/${version}.json`;

				yield* fs
					.writeFileString(versionPath, json)
					.pipe(
						Effect.mapError(
							wrapError(
								'write-version',
								`Failed to write version ${version}`
							)
						)
					);

				yield* fs
					.writeFileString(currentPath, json)
					.pipe(
						Effect.mapError(
							wrapError(
								'write-current',
								'Failed to write current blueprint'
							)
						)
					);
			});

			const history: Effect.Effect<
				ReadonlyArray<{
					readonly version: string;
					readonly blueprint: AgentBlueprint;
				}>,
				BlueprintStoreError
			> = Effect.gen(function* () {
				const entries = yield* fs
					.readDirectory(baseDir)
					.pipe(
						Effect.mapError(
							wrapError(
								'list',
								'Failed to list blueprint versions'
							)
						)
					);

				// Filter for version files, sort newest first
				const versionFiles = Arr.filter(
					entries,
					(e: string) => e.startsWith('v-') && e.endsWith('.json')
				);
				const sorted = Arr.sort(versionFiles, descString);

				return yield* Effect.forEach(sorted, (filename) =>
					Effect.gen(function* () {
						const content = yield* fs
							.readFileString(`${baseDir}/${filename}`)
							.pipe(
								Effect.mapError(
									wrapError(
										'read-version',
										`Failed to read ${filename}`
									)
								)
							);

						const blueprint = yield* Schema.decodeUnknownEffect(
							BlueprintJson
						)(content).pipe(
							Effect.mapError(
								wrapError(
									'decode-version',
									`Failed to decode ${filename}`
								)
							)
						);

						const version = filename.replace('.json', '');
						return { version, blueprint };
					})
				);
			}).pipe(Effect.withLogSpan('BlueprintStore.history'));

			const rollback = Effect.fn('BlueprintStore.rollback')(function* (
				version: string
			) {
				const versionPath = `${baseDir}/${version}.json`;
				const exists = yield* fs
					.exists(versionPath)
					.pipe(
						Effect.mapError(
							wrapError(
								'rollback',
								`Failed to check existence of ${version}`
							)
						)
					);
				if (!exists) {
					return yield* new BlueprintStoreError({
						operation: 'rollback',
						message: `Version ${version} not found`
					});
				}

				const content = yield* fs
					.readFileString(versionPath)
					.pipe(
						Effect.mapError(
							wrapError(
								'read-rollback',
								`Failed to read ${version}`
							)
						)
					);

				yield* fs
					.writeFileString(currentPath, content)
					.pipe(
						Effect.mapError(
							wrapError(
								'write-rollback',
								'Failed to write rollback'
							)
						)
					);

				return yield* Schema.decodeUnknownEffect(BlueprintJson)(
					content
				).pipe(
					Effect.mapError(
						wrapError(
							'decode-rollback',
							'Failed to decode rollback'
						)
					)
				);
			});

			return Service.of({ current, save, history, rollback });
		})
	);

	/**
	 * In-memory test layer for BlueprintStore.
	 *
	 * @since 0.3.0
	 */
	export const test = (initialBlueprint?: AgentBlueprint) => {
		let seq = 0;
		const stored: {
			current: AgentBlueprint;
			versions: Array<{
				version: string;
				blueprint: AgentBlueprint;
			}>;
		} = {
			current: initialBlueprint ?? defaultBlueprint,
			versions: []
		};
		return Layer.succeed(
			Service,
			Service.of({
				current: Effect.sync(() => stored.current),
				save: (blueprint) =>
					Effect.sync(() => {
						const version = `v-${++seq}`;
						stored.versions.unshift({ version, blueprint });
						stored.current = blueprint;
					}),
				history: Effect.sync(() => stored.versions),
				rollback: (version) => {
					const found = stored.versions.find(
						(v) => v.version === version
					);
					if (!found) {
						return Effect.die(`Version ${version} not found`);
					}
					stored.current = found.blueprint;
					return Effect.succeed(found.blueprint);
				}
			})
		);
	};
}
