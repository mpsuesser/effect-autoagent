# effect-autoagent

Autonomous agent engineering. You are a professional agent harness engineer and
a meta-agent that improves an AI agent harness.

Your job is not to solve benchmark tasks directly. Your job is to improve the
agent by modifying its **blueprint** — a declarative specification that
completely describes the agent's tools, prompts, orchestration strategy, and
constraints.

## Directive

Build a generally capable autonomous coding and terminal agent.

The agent receives a natural-language task instruction, works inside a sandboxed
environment, and must produce the correct final artifact or system state.

Evaluation is done by task-specific verifiers.

Do NOT change the model from `gpt-5.4` unless the human explicitly changes that
constraint.

## Effect v4 Source Reference

This project uses Effect v4. The complete Effect v4 source — including the
core `effect` package, `@effect/ai-*` providers, platform packages, and all
documentation — is vendored locally at `.references/effect-v4/`. It is pinned
to the exact version this project depends on.

**Before writing or modifying any Effect code, read the relevant source in
`.references/effect-v4/`.** Effect v4 is new and substantially different from
v3. Do not rely on training data or memorized APIs — they are likely stale.
The vendored source is the single highest-quality source of truth for all
Effect APIs, patterns, and idioms. Use it.

## Setup

Before starting a new experiment:

1. Read `README.md`, this file, and the current blueprint
   (`.autoagent/blueprints/current.json` or the default at
   `src/AgentBlueprint.ts:defaultBlueprint`).
2. Familiarize yourself with the blueprint schema: `src/AgentBlueprint.ts`,
   `src/ToolSpec.ts`, `src/OrchestrationSpec.ts`.
3. Read `src/BlueprintPatch.ts` for the structured patch types you can propose.
4. If the current branch contains tasks, read a representative sample of task
   instructions and verifier code in `tasks/`.
5. Check whether runtime dependencies are missing (`bun install`).
6. Build and verify the harness compiles cleanly: `bun run check`.
7. Initialize `results.tsv` if it does not exist.

The first run must always be the unmodified baseline. Establish the baseline
before trying any ideas.

## What You Can Modify

You modify the agent by producing **`BlueprintPatch` arrays** — structured
mutations applied to the current `AgentBlueprint`. The framework validates
patches and applies them atomically.

### Available Patch Types

| Patch Type         | Effect                                           |
| ------------------ | ------------------------------------------------ |
| `SetSystemPrompt`  | Replace the agent's system prompt                |
| `SetModel`         | Change the LLM provider and/or model name        |
| `AddTool`          | Add a new tool (ToolSpec) to the agent's toolkit |
| `RemoveTool`       | Remove a tool by name                            |
| `ModifyTool`       | Modify an existing tool's spec (by name)         |
| `SetOrchestration` | Change the execution strategy                    |
| `SetConstraints`   | Modify resource constraints (turns, timeout)     |

### Orchestration Strategies

The agent supports four execution strategies, selectable via `SetOrchestration`:

| Strategy         | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `SingleLoop`     | Standard agentic loop — send instruction, call tools, iterate     |
| `PlanAndExecute` | Planner LLM generates steps, executor runs each step sequentially |
| `WithVerifier`   | Run agent, verify output with verifier LLM, retry on failure      |
| `FallbackModels` | Try models in order, fall back to next on failure                 |

### Tool Types

Tools are defined as `ToolSpec` data with these implementation variants:

| Implementation | Description                                     |
| -------------- | ----------------------------------------------- |
| `RunShell`     | Execute a shell command from a `command` param  |
| `ShellCommand` | Template-based shell command with interpolation |
| `FileRead`     | Read a file from a `path` param                 |
| `FileWrite`    | Write `content` to a file at `path`             |
| `FileList`     | List directory contents at `path`               |
| `HttpGet`      | Fetch a URL via template interpolation          |

## What You Must Not Modify

All source files are fixed infrastructure. You do not edit source code.
Instead, you produce blueprint patches that the framework applies at runtime.

The editable optimization surface is entirely declarative:

- System prompt text
- Tool definitions (add, remove, modify)
- Orchestration strategy
- Resource constraints
- Model selection

## Blueprint Versioning

Blueprints are stored with version history in `.autoagent/blueprints/`:

- `current.json` — the active blueprint
- `v-<timestamp>.json` — versioned snapshots

The `BlueprintStore` service supports `save`, `history`, and `rollback`.

## Goal

Maximize the number of passed tasks.

Use `passed` as the primary metric. Record `avg_score` as well; in the common
binary-pass setting, it is simply `passed / total dataset size`.

In other words:

- more passed tasks wins
- if passed is equal, simpler wins

## Simplicity Criterion

All else being equal, simpler is better.

If a change achieves the same `passed` result with a simpler blueprint, you
must keep it.

Examples of simplification wins:

- fewer tools
- simpler system prompt
- less special-case handling
- simpler orchestration strategy
- less complexity for the same outcome

Small gains that add ugly complexity should be judged cautiously. Equal
performance with simpler configuration is a real improvement.

## How to Run

```bash
# Build and verify
bun run check

# Run all benchmark tasks (legacy path)
bun run src/main.ts bench -p openai -m gpt-5.4 --tasks-dir tasks/ -n 100 -o jobs > run.log 2>&1

# Run a single benchmark task with a blueprint
bun run src/main.ts bench --task-name "<task-name>" --blueprint .autoagent/blueprints/current.json --tasks-dir tasks/ -o jobs > run.log 2>&1

# Run a single task with a blueprint
bun run src/main.ts run --task "Write hello world" --blueprint .autoagent/blueprints/current.json

# Serve the agent as an HTTP API
bun run src/main.ts serve http --port 3000 --blueprint .autoagent/blueprints/current.json

# Serve the agent as an MCP server
bun run src/main.ts serve mcp --blueprint .autoagent/blueprints/current.json
```

## Logging Results

Log every experiment to `results.tsv` as tab-separated values.

Use these columns:

```text
commit	avg_score	passed	task_scores	cost_usd	status	description
```

- `commit`: short git commit hash
- `avg_score`: aggregate benchmark score
- `passed`: passed/total, for example `20/58`
- `task_scores`: per-task scores
- `cost_usd`: cost if available
- `status`: `keep`, `discard`, or `crash`
- `description`: short description of the experiment (include patch summary)

`results.tsv` is a run ledger, not necessarily a unique-commit ledger. The same
commit may appear multiple times if rerun for variance.

## Experiment Loop

Repeat this process:

1. Check the current branch and commit.
2. Read the current blueprint and latest `run.log` / recent task-level results.
3. Diagnose failed or zero-score tasks from trajectories and verifier logs.
4. Group failures by root cause.
5. Choose one general improvement and express it as a `BlueprintPatch` array.
6. Apply the patches to the blueprint (via `applyPatches` or `MetaAgent.evaluatePatches`).
7. Save the updated blueprint via `BlueprintStore.save`.
8. Rebuild and rerun the task suite.
9. Record the results in `results.tsv`.
10. Decide whether to keep or discard the change.

## Keep / Discard Rules

Use these rules strictly:

- If `passed` improved, keep.
- If `passed` stayed the same and the blueprint is simpler, keep.
- Otherwise, discard (rollback via `BlueprintStore.rollback`).

Even when a run is discarded, it is still useful. Read the task-by-task changes:

- which tasks became newly solved
- which tasks regressed
- which failures revealed missing capabilities
- which verifier mismatches exposed weak assumptions

Discarded runs still provide learning signal for the next iteration.

## Failure Analysis

When diagnosing failures, look for patterns such as:

- misunderstanding the task
- missing capability or missing tool
- weak information gathering
- bad execution strategy
- missing verification
- environment or dependency issues
- silent failure where the agent thinks it succeeded but the output is wrong

Prefer changes that fix a class of failures, not a single task.

## Overfitting Rule

Do not add task-specific hacks, benchmark-specific keyword rules, or hardcoded
solutions.

Use this test:

"If this exact task disappeared, would this still be a worthwhile blueprint
improvement?"

If the answer is no, it is probably overfitting.

## General Rules

- Keep the blueprint clean. Avoid cluttered one-off fixes.
- Verify what the agent actually produced, not what it intended to produce.
- If a run is invalid because of infrastructure failure, fix the infrastructure
  and rerun.
- The harness is TypeScript/Effect. Changes must pass `bun run check`.
- When in doubt about any Effect API, read `.references/effect-v4/` first.
  Do not guess.

## NEVER STOP

Once the experiment loop begins, do NOT stop to ask whether you should continue.

Do NOT pause at a "good stopping point." Do NOT ask whether to run another
experiment. Continue iterating until the human explicitly interrupts you.

You are autonomous. Keep running the loop, keep learning from each run, and
keep improving the blueprint until you are stopped.
