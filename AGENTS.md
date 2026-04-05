# AGENTS.md — effect-autoagent

Meta-agent framework that autonomously iterates on an AI agent harness by
modifying prompts, tools, and orchestration, then hill-climbing on benchmark
scores. Built entirely with Effect v4.

## Build / Lint / Test Commands

```sh
bun run check          # lint + format + typecheck (with auto-fix)
bun run test           # vitest run (all tests)
bun run typecheck      # tsgo type-check only
```

### Running a single test

```sh
bunx vitest run test/Example.test.ts            # single file
bunx vitest run -t "some test name"              # by test name pattern
bunx vitest run test/Example.test.ts -t "match"  # file + name
```

### Verification before submitting

All three must pass:

```sh
bun run check && bun run test && bun run typecheck
```

## Project Structure

```
src/           Source modules
test/          Test files — one per source module
examples/      Usage examples (library consumers)
program.md     Meta-agent operating instructions (edited by the human)
vite.config.ts Lint rules, formatting, test config (vite-plus)
```

Single-package project. Bun is the package manager. No monorepo tooling.

## Architecture

```
CLI (main.ts)
  ├── run    → single task execution
  └── bench  → benchmark suite (equivalent to harbor run)
        │
        ▼
AgentExecutor ──► LanguageModel (OpenAI / Anthropic via Providers)
  │                   │
  │                   ▼
  │              AgentToolkit (RunShell tool)
  │
  ▼
Environment (local shell or Docker container)
  │
  ▼
BenchmarkRunner ──► TaskSpec (reads task.toml dirs)
  │                     │
  │                     ▼
  │              ContainerManager (Docker build/exec)
  │
  ▼
MetaAgent (optimizer loop)
  │
  ├── diagnose()           → LLM analyzes failures → DiagnosisOutput
  ├── readHarness()        → reads editable files  → HarnessFile[]
  ├── recordAndEvaluate()  → runs benchmark, decides keep/discard
  ├── step()               → one full iteration (convenience)
  └── loop()               → iterates until stale (convenience)
```

## Module Map

| Module                   | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `Atif.ts`                | ATIF trajectory schema (steps, observations, tools) |
| `AgentConfig.ts`         | Agent configuration schemas (model, tools, prompts) |
| `AgentRunner.ts`         | AgentConfigService + legacy SDK runner              |
| `AgentExecutor.ts`       | Effect AI native agentic loop (Chat + Toolkit)      |
| `AgentToolkit.ts`        | RunShell tool definition for Effect AI              |
| `AgentRunResult.ts`      | Run result schema (trajectory + metrics + exit)     |
| `BenchmarkRunner.ts`     | Native benchmark runner (replaces Harbor CLI)       |
| `ContainerManager.ts`    | Docker container build/exec/remove service          |
| `DockerfileGenerator.ts` | Dockerfile template generation                      |
| `EffectAiConverter.ts`   | Convert Effect AI history → ATIF trajectory         |
| `Environment.ts`         | Sandbox abstraction (local + bridge + Docker)       |
| `Errors.ts`              | All domain error classes (TaggedErrorClass)         |
| `ExecResult.ts`          | Shell execution result schema                       |
| `ExperimentLog.ts`       | TSV experiment tracking                             |
| `HarnessSpec.ts`         | Optimizer state, harness manifest, diagnosis output |
| `MetaAgent.ts`           | Meta-agent optimizer (assisted + autonomous modes)  |
| `Metrics.ts`             | Token/cost metrics extraction + trajectory JSON     |
| `Providers.ts`           | OpenAI + Anthropic LanguageModel layers             |
| `ShellTool.ts`           | Low-level shell execution effect                    |
| `TaskSpec.ts`            | Task directory reader with TOML parsing             |
| `TrajectoryConverter.ts` | OpenAI/Claude SDK messages → ATIF conversion        |
| `UsageMetrics.ts`        | Token usage accumulation schemas                    |
| `main.ts`                | CLI entrypoint (not exported from barrel)           |
| `index.ts`               | Library barrel — all public exports                 |

## Key Services

| Service                      | Tag                           | Dependencies                            |
| ---------------------------- | ----------------------------- | --------------------------------------- |
| `AgentExecutor.Service`      | `@autoagent/AgentExecutor`    | LanguageModel, Environment, AgentConfig |
| `Environment.Service`        | `@autoagent/Environment`      | (none — or ChildProcessSpawner + FS)    |
| `BenchmarkRunner.Service`    | `@autoagent/BenchmarkRunner`  | AgentExecutor, ContainerManager, FS     |
| `MetaAgent.Service`          | `@autoagent/MetaAgent`        | BenchmarkRunner, ExperimentLog, LM, FS  |
| `ContainerManager.Service`   | `@autoagent/ContainerManager` | ChildProcessSpawner                     |
| `ExperimentLog.Service`      | `@autoagent/ExperimentLog`    | FileSystem                              |
| `AgentConfigService.Service` | `@autoagent/AgentConfig`      | (none)                                  |

## Editable vs Fixed Boundary

The meta-agent optimizer modifies only these files (defined in
`HarnessSpec.defaultManifest`):

**Editable:** `src/AgentConfig.ts`, `src/AgentToolkit.ts`, `src/AgentExecutor.ts`

**Fixed:** `src/Atif.ts`, `src/Metrics.ts`, `src/TrajectoryConverter.ts`,
`src/EffectAiConverter.ts`, `src/ExperimentLog.ts`, `src/BenchmarkRunner.ts`,
`src/ContainerManager.ts`, `src/Environment.ts`, `src/Errors.ts`

## Error Types

All errors extend `Schema.TaggedErrorClass` and are recoverable via
`Effect.catchTag`:

`ShellExecError`, `EnvironmentError`, `AgentRunError`,
`TrajectoryConversionError`, `ContainerError`, `BenchmarkError`,
`ExperimentLogError`, `MetaAgentError`, `TaskError`.

## Provider Layers

```ts
openAiModel('gpt-5'); // Layer<LanguageModel, never, never>
anthropicModel('claude-sonnet-4-20250514'); // Layer<LanguageModel, never, never>
```

Both are fully wired (include HttpClient + API key config). Pass directly
to `AgentExecutor.layer` via `Layer.provide`.

## CLI Usage

```sh
# Run a single task
bun run src/main.ts run -p openai -m gpt-5 --task "Write hello world"

# Run all benchmark tasks
bun run src/main.ts bench -p openai -m gpt-5 --tasks-dir tasks/ -n 100 -o jobs

# Run a single benchmark task by name
bun run src/main.ts bench -p openai -m gpt-5 --task-name my-task
```
