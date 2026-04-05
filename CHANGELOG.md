# Changelog

## 0.3.0

### Breaking Changes

- Renamed `HarborAdapter.ts` to `Metrics.ts`, `HarborMetrics` to `AgentMetrics`, `HarborExecResult` to `BridgeExecResult`, `fromHarbor` to `fromBridge`, `HarborBridgeOptions` to `BridgeOptions`.
- Upgraded `@effect/ai-openai` and `@effect/ai-anthropic` to `4.0.0-beta.43` (v4 unified imports).
- `BenchmarkRunner` rewritten as native Effect service — `run()` renamed to `runAll()`, `exitCode` replaced by `passed`.

### New Features

- **Native benchmark runner** (`BenchmarkRunner.ts`): Effect-native task runner replacing Harbor CLI, with `BenchmarkOptions`, `TaskResult`, `BenchmarkReport` schemas.
- **Task specification reader** (`TaskSpec.ts`): Reads task directories with TOML parsing (`task.toml`), producing typed `TaskSpec` values. New schemas: `TaskMeta`, `AgentSettings`, `VerifierSettings`, `EnvironmentSettings`, `TaskConfig`, `TaskSpec`.
- **Harness manifest** (`HarnessSpec.ts`): Added `HarnessManifest`, `defaultManifest`, `HarnessFile`, `DiagnosisOutput` for meta-agent optimization surface.
- **Assisted meta-agent mode** (`MetaAgent.ts`): New `diagnose`, `readHarness`, `recordAndEvaluate` methods for coding agent integration. `step`/`loop` retained as convenience wrappers.
- **Local environment** (`Environment.ts`): Added `Environment.local` layer for host-side shell execution via `ChildProcessSpawner`.
- **CLI entrypoint** (`main.ts`): `effect-autoagent` binary with `--provider`, `--model`, `--task`/`--task-file`, `--output-dir`, `--max-turns` flags.
- **Examples**: `basic-openai.ts`, `basic-anthropic.ts`, `meta-agent-workflow.ts`.
- **`TaskError`** added to `Errors.ts`.

### Internal

- Added `@effect/platform-bun` and `smol-toml` dependencies.
- Updated all imports from renamed modules.
- Added `program.md` architecture overview.

## 0.2.0

- Effect AI native agent executor (`AgentExecutor`, `AgentToolkit`).
- Docker container management (`ContainerManager`).
- Dockerfile generation (`DockerfileGenerator`).
- Experiment tracking (`ExperimentLog`).
- Meta-agent optimizer (`MetaAgent`).
- Harness specification (`HarnessSpec`).
- Provider layers for OpenAI and Anthropic (`Providers`).

## 0.1.0

- Initial release.
- ATIF trajectory schema and builders.
- Agent runner with OpenAI/Claude SDK converters.
- Sandbox environment abstraction with bridge layer.
- Shell tool execution.
- Token usage metrics.
