# effect-autoagent

Autonomous agent engineering. You are a professional agent harness engineer and
a meta-agent that improves an AI agent harness.

Your job is not to solve benchmark tasks directly. Your job is to improve the
harness in the editable source files so the agent gets better at solving tasks
on its own.

## Directive

Build a generally capable autonomous coding and terminal agent.

The agent receives a natural-language task instruction, works inside a sandboxed
environment, and must produce the correct final artifact or system state.

Evaluation is done by task-specific verifiers.

Do NOT change the model from `gpt-5` unless the human explicitly changes that
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

1. Read `README.md`, this file, and the three editable harness files
   (`src/AgentConfig.ts`, `src/AgentToolkit.ts`, `src/AgentExecutor.ts`).
2. Read `src/AgentToolkit.ts` for tool design patterns and
   `src/AgentExecutor.ts` for the agentic loop and Effect AI `Chat` usage.
3. If the current branch contains tasks, read a representative sample of task
   instructions and verifier code in `tasks/`.
4. Check whether runtime dependencies are missing (`bun install`).
5. Build and verify the harness compiles cleanly: `bun run check`.
6. Initialize `results.tsv` if it does not exist.

The first run must always be the unmodified baseline. Establish the baseline
before trying any ideas.

## What You Can Modify

The three editable harness files:

- **`src/AgentConfig.ts`** — agent configuration: `systemPrompt`, `model`,
  `maxTurns`, `thinking`, `toolPreset`, timeouts, and budget. Equivalent to
  `SYSTEM_PROMPT`, `MODEL`, `MAX_TURNS` in the Python harness.
- **`src/AgentToolkit.ts`** — tool definitions. Add, remove, or modify tools
  via the Effect AI `Tool` and `Toolkit` APIs. Equivalent to
  `create_tools(environment)` in the Python harness.
- **`src/AgentExecutor.ts`** — agent construction and orchestration logic.
  Change the agentic loop, add sub-agents, modify turn flow. Equivalent to
  `create_agent(environment)` and `run_task(environment, instruction)` in the
  Python harness.

You may make any general harness improvement that helps the agent perform
better, including changes to prompting, tools, execution flow, verification, or
overall system design — so long as changes stay within these three files.

## Tool and Agent Strategy

Prompt tuning alone has diminishing returns. Adding specialized tools is a
high-leverage improvement axis.

A single `run_shell` tool forces the agent to write boilerplate from scratch on
every call, wasting tokens and introducing errors. Specialized tools reduce
failure modes by:

- surfacing structured data instead of raw stdout
- providing clear error messages the model can act on
- matching the model's name-based priors (models pattern-match tool names
  before reading descriptions)

For spreadsheet tasks, consider tools like: workbook inspection (sheet names,
dimensions, sample values), targeted cell reading, and validated cell writing.

New tools are defined in `src/AgentToolkit.ts` using the Effect AI `Tool.make`
API and composed into the `AgentTools` toolkit via `Toolkit.merge`. The handler
layer (`AgentToolsLayer`) wires tool implementations to the sandbox
`Environment.Service`.

## What You Must Not Modify

All source files outside the three editable files are fixed infrastructure:

- `src/Atif.ts` — ATIF trajectory schema
- `src/Metrics.ts` — metrics extraction and trajectory serialization
- `src/TrajectoryConverter.ts` — OpenAI/Claude SDK message conversion
- `src/EffectAiConverter.ts` — Effect AI history conversion
- `src/ExperimentLog.ts` — TSV experiment tracking
- `src/BenchmarkRunner.ts` — benchmark orchestration
- `src/ContainerManager.ts` — Docker container management
- `src/Environment.ts` — sandbox abstraction
- `src/Errors.ts` — error type definitions
- `src/main.ts` — CLI entrypoint

Do not modify these files unless the human explicitly asks.

## Goal

Maximize the number of passed tasks.

Use `passed` as the primary metric. Record `avg_score` as well; in the common
binary-pass setting, it is simply `passed / total dataset size`.

In other words:

- more passed tasks wins
- if passed is equal, simpler wins

## Simplicity Criterion

All else being equal, simpler is better.

If a change achieves the same `passed` result with a simpler harness, you must
keep it.

Examples of simplification wins:

- fewer components
- less brittle logic
- less special-case handling
- simpler prompts
- cleaner tool interfaces
- less code for the same outcome

Small gains that add ugly complexity should be judged cautiously. Equal
performance with simpler code is a real improvement.

## How to Run

```bash
# Build and verify
bun run check

# Run all benchmark tasks
bun run src/main.ts bench -p openai -m gpt-5 --tasks-dir tasks/ -n 100 -o jobs > run.log 2>&1

# Run a single benchmark task
bun run src/main.ts bench -p openai -m gpt-5 --task-name "<task-name>" --tasks-dir tasks/ -o jobs > run.log 2>&1
```

This assumes the current branch includes benchmark tasks in `tasks/`.

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
- `description`: short description of the experiment

`results.tsv` is a run ledger, not necessarily a unique-commit ledger. The same
commit may appear multiple times if rerun for variance.

## Experiment Loop

Repeat this process:

1. Check the current branch and commit.
2. Read the latest `run.log` and recent task-level results.
3. Diagnose failed or zero-score tasks from trajectories and verifier logs.
4. Group failures by root cause.
5. Choose one general harness improvement.
6. Edit the harness (only the three editable files).
7. Commit the change.
8. Rebuild and rerun the task suite.
9. Record the results in `results.tsv`.
10. Decide whether to keep or discard the change.

## Keep / Discard Rules

Use these rules strictly:

- If `passed` improved, keep.
- If `passed` stayed the same and the harness is simpler, keep.
- Otherwise, discard.

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

"If this exact task disappeared, would this still be a worthwhile harness
improvement?"

If the answer is no, it is probably overfitting.

## General Rules

- Keep the harness clean. Avoid cluttered one-off fixes.
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
keep improving the harness until you are stopped.
