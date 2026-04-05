# effect-autoagent

> **Experimental adaptation.** This project is an experimental [Effect](https://effect.website)-native rewrite of the original [autoagent](https://github.com/kevinrgu/autoagent) framework by [thirdlayer](https://www.thirdlayer.inc). The core idea is identical — give a meta-agent a task, let it build and iterate on an agent harness autonomously. The implementation replaces the single-file Python harness with a modular Effect v4 TypeScript codebase built on `@effect/ai-*` providers, typed services, and schema-driven domain models.

Like the original: you don't touch the harness source files directly. Instead, you program `program.md`, the Markdown file that provides context to the meta-agent and defines the agent-engineering loop.

## How it works

The meta-agent hill-climbs on benchmark score. It reads the harness, runs the agent against a task suite, diagnoses failures, modifies the editable harness files, and repeats — keeping changes that improve the score and discarding those that don't.

The repo is structured around typed Effect services:

- **`src/AgentConfig.ts`** — agent configuration: system prompt, model, max
  turns, thinking budget, tool presets. The meta-agent's primary tuning surface.
- **`src/AgentToolkit.ts`** — tool definitions using the Effect AI `Tool` and
  `Toolkit` APIs. Add, remove, or modify tools that the agent can call.
- **`src/AgentExecutor.ts`** — the agentic loop built on Effect AI `Chat`.
  Controls conversation flow, turn management, and tool resolution.
- **`program.md`** — instructions for the meta-agent + the directive (what kind
  of agent to build). **This file is edited by the human.**
- **`tasks/`** — evaluation tasks in [Harbor](https://harborframework.com/docs)
  format, typically added in benchmark-specific branches.

The three `src/` files above are the **editable surface** — everything the
meta-agent is allowed to modify. All other source modules are fixed
infrastructure.

## Quick start

**Requirements:** [Bun](https://bun.sh), Docker, and API credentials for your
chosen provider (OpenAI or Anthropic).

```bash
# 1. Install dependencies
bun install

# 2. Set up environment variables
cat > .env << 'EOF'
OPENAI_API_KEY=...
EOF

# 3. Verify the harness compiles
bun run check

# 4. Run a single ad-hoc task
bun run src/main.ts run -p openai -m gpt-5 --task "Write hello world to hello.txt"

# 5. Run all benchmark tasks (requires tasks/ directory)
bun run src/main.ts bench -p openai -m gpt-5 --tasks-dir tasks/ -n 100 -o jobs

# 6. Run a single benchmark task by name
bun run src/main.ts bench -p openai -m gpt-5 --task-name "<task-name>" --tasks-dir tasks/ -o jobs
```

## Running the meta-agent

Point your coding agent at the repo and prompt:

```
Read program.md and let's kick off a new experiment!
```

The meta-agent will read the directive, inspect the current harness, run the
benchmark, diagnose failures, modify the editable files, and iterate.

## Project structure

```text
src/
  AgentConfig.ts             — agent configuration schemas (editable)
  AgentToolkit.ts            — tool definitions via Effect AI (editable)
  AgentExecutor.ts           — agentic loop via Effect AI Chat (editable)
  AgentRunner.ts             — config service + legacy SDK runner
  AgentRunResult.ts          — run result schema (trajectory + metrics + exit)
  Atif.ts                    — ATIF trajectory schema (steps, observations, tools)
  BenchmarkRunner.ts         — native benchmark runner (replaces Harbor CLI)
  ContainerManager.ts        — Docker container build/exec/remove service
  DockerfileGenerator.ts     — Dockerfile template generation
  EffectAiConverter.ts       — Effect AI history → ATIF trajectory conversion
  Environment.ts             — sandbox abstraction (local shell + Docker + bridge)
  Errors.ts                  — all domain error classes (TaggedErrorClass)
  ExecResult.ts              — shell execution result schema
  ExperimentLog.ts           — TSV experiment tracking
  HarnessSpec.ts             — optimizer state, harness manifest, diagnosis output
  MetaAgent.ts               — meta-agent optimizer (assisted + autonomous modes)
  Metrics.ts                 — token/cost metrics + trajectory JSON serialization
  Providers.ts               — OpenAI + Anthropic LanguageModel layers
  ShellTool.ts               — low-level shell execution effect
  TaskSpec.ts                — task directory reader with TOML parsing
  TrajectoryConverter.ts     — OpenAI/Claude SDK messages → ATIF conversion
  UsageMetrics.ts            — token usage accumulation schemas
  main.ts                    — CLI entrypoint (not exported from barrel)
  index.ts                   — library barrel — all public exports
program.md                   — meta-agent instructions + directive
examples/                    — usage examples (basic-openai, basic-anthropic, meta-agent workflow)
test/                        — one test file per source module
tasks/                       — benchmark tasks (added in benchmark-specific branches)
results.tsv                  — experiment log (created by meta-agent, gitignored)
```

## Architecture

```text
CLI (main.ts)
  ├── run    → single task execution
  └── bench  → benchmark suite
        │
        ▼
AgentExecutor ──► LanguageModel (OpenAI / Anthropic via @effect/ai-*)
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
  ├── diagnose()           → LLM analyzes failures → DiagnosisOutput
  ├── readHarness()        → reads editable files  → HarnessFile[]
  ├── recordAndEvaluate()  → runs benchmark, decides keep/discard
  ├── step()               → one full iteration
  └── loop()               → iterates until stale
```

## Providers

Both OpenAI and Anthropic are supported as fully-wired `LanguageModel` layers:

```ts
import { openAiModel, anthropicModel } from 'effect-autoagent';

openAiModel('gpt-5'); // Layer<LanguageModel>
anthropicModel('claude-sonnet-4-20250514'); // Layer<LanguageModel>
```

API keys are read from config (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`).

## Library usage

effect-autoagent exports all domain schemas, services, and provider layers as a
library. Compose them with standard Effect `Layer` wiring:

```ts
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Layer } from 'effect';
import {
	AgentExecutor,
	ContainerManager,
	Environment,
	openAiModel
} from 'effect-autoagent';

const task = "Create hello.txt containing 'Hello!'";

const program = Effect.gen(function* () {
	const executor = yield* AgentExecutor.Service;
	const result = yield* executor.runTask(task);
	yield* Console.log(`Exit: ${result.exitReason}`);
});

const ContainerLayer = ContainerManager.layer.pipe(
	Layer.provide(BunServices.layer)
);
const EnvLayer = Environment.docker().pipe(
	Layer.provide(ContainerLayer),
	Layer.provide(BunServices.layer)
);
const ExecutorLayer = AgentExecutor.layer.pipe(
	Layer.provide(openAiModel('gpt-4o')),
	Layer.provide(EnvLayer)
);

program.pipe(
	Effect.provide(ExecutorLayer),
	Effect.provide(BunServices.layer),
	BunRuntime.runMain
);
```

## Task format

The repo ships without tasks. Add your own to `tasks/` following
[Harbor's task format](https://harborframework.com/docs/tasks):

```text
tasks/my-task/
  task.toml           — config (timeouts, metadata)
  instruction.md      — prompt sent to the agent
  tests/
    test.sh           — entry point, writes /logs/reward.txt
    test.py           — verification (deterministic or LLM-as-judge)
  environment/
    Dockerfile        — task container
  files/              — reference files mounted into container
```

Tests write a score (0.0–1.0) to the verifier logs. The meta-agent hill-climbs
on this. See the [Harbor docs](https://harborframework.com/docs) for full
details.

## Error handling

All domain errors are `Schema.TaggedErrorClass` instances, enabling precise
recovery via `Effect.catchTag`:

- `ShellExecError` — shell command failed or timed out
- `EnvironmentError` — sandbox interaction failed
- `AgentRunError` — agent run exceeded constraints
- `ContainerError` — Docker operation failed
- `BenchmarkError` — benchmark orchestration failed
- `MetaAgentError` — meta-agent optimization failed
- `TaskError` — task discovery or parsing failed
- `TrajectoryConversionError` — SDK message conversion failed
- `ExperimentLogError` — experiment log I/O failed

## Design choices

- **Program the meta-agent, not the harness directly.** The human steers the
  loop through `program.md`, while the meta-agent edits the three harness files.
- **Effect-native throughout.** Services, errors, configuration, schemas, and
  the agentic loop are all built with Effect v4 — no raw Promises, no untyped
  throws, no ad-hoc JSON parsing.
- **Modular service architecture.** The single-file Python harness is decomposed
  into focused Effect services (`AgentExecutor`, `Environment`,
  `BenchmarkRunner`, `ContainerManager`, `MetaAgent`, `ExperimentLog`) with
  explicit dependency wiring via `Layer`.
- **Schema-first domain.** All domain types — trajectories, metrics, configs,
  task specs, experiment rows — are `Schema.Class` instances with annotations
  and defaults.
- **Docker isolation.** Benchmark tasks run in containers. The agent can't
  damage the host.
- **Score-driven.** Every experiment produces a numeric score. Keep if better,
  discard if not. Same loop as the original.
- **Harbor-compatible tasks.** Tasks use the same format as Harbor benchmarks, so
  the same tasks work in both the Python and Effect harnesses.

## Cleanup

Docker images and containers accumulate across runs. Clean up regularly:

```bash
# Full Docker nuke (all unused images, build cache, etc.)
docker system prune -a -f

# Lighter: just dead containers
docker container prune -f
```

If Docker becomes unresponsive after many concurrent runs, restart Docker
Desktop:

```bash
killall Docker && open -a Docker
```

## Development

```bash
bun run check       # lint + format + typecheck (with auto-fix)
bun run test        # vitest run (all tests)
bun run typecheck   # tsgo type-check only
```

## License

MIT
