# Methodology — the "why" behind harness-first

Read this only when someone wants the rationale, or when choosing a workflow shape
in Phase 4. The SKILL body is enough to *run* the process; this explains why it is
shaped that way.

## The shift it encodes

Traditional build path:

```
requirement → human writes code → human tests → human fixes → ship
```

Harness-first path for long-chain / agentic work:

```
goal → reality model → minimum link → agent executes → feedback exposes problems
     → iterate the link → converge on goal
```

The object you are building is **not the code**. It is a feedback-capable
execution space: a harness in which a coding agent can act, observe, fail, and
correct against ground truth (test results, execution output, state changes). The
agent is not a code generator here; it is an *engineering feedback engine*.

This is closer to ML/MLOps work than to classic software engineering. You are
doing: architecture hypothesis + data/case construction + training feedback +
eval loop + production monitoring. The difference: an ML engineer tunes model
weights; here you tune everything *around* the model — prompt, context, memory,
tool interfaces, workflow, eval. The model can stay fixed while system behavior
changes entirely with the external structure you build.

| ML engineering | Harness-first agent engineering |
|----------------|---------------------------------|
| network architecture | agent architecture / workflow / tool boundaries |
| collect & clean data | real task cases, failure traces, execution trajectories |
| feature engineering | context selection, retrieval fields, tool return shapes |
| training loop | agent executes → tests → fixes → records failures |
| loss / metric | eval, test pass rate, task completion, cost, latency |
| validation set | fixed case set, regression suite, real business cases |
| overfitting | a prompt that fits a few cases and breaks on new ones |
| data leakage | eval cases polluted into the prompt or memory |
| training-serving skew | great in test, broken in real production |
| deployment | the workflow goes live against real users & tools |
| monitoring | watch failure modes, cost, context length, tool errors |

## The three load-bearing insights

1. **An LLM application's architecture is a compression of a real workflow.** It is not first a technical structure — it is an abstraction of how the task really happens. Get the reality wrong and the architecture is wrong. So Phase 0 comes first, always.
2. **A coding agent's biggest value is feedback, not generation.** Its worth is not "writes a version of the code once" but "repeatedly enters the system to execute, test, fail, localize, fix, and record" — compressing your manual trial-and-error into a high-frequency loop.
3. **The best prompt is a product of iteration, not its starting point.** You need real cases, failure traces, test results, context bottlenecks, tool errors, and workflow confusion *first*; only then do you know what the prompt should say. Build the minimum system; let failure tell you what to write.

## Choosing a workflow shape (Phase 4, only when failure demands it)

Grow these from evidence, never design them up front:

- **Single fixed chain** — stable, well-understood tasks.
- **Routing** — inputs fall into distinct, classifiable types.
- **Parallelization** — independent sub-tasks, or multi-perspective review of one thing.
- **Orchestrator-workers** — open-ended tasks whose sub-tasks cannot be predetermined.
- **Evaluator-optimizer** — a clear evaluation standard exists and iteration yields measurable gains.

The correct order is always: minimum link first, complex workflow later; failure
evidence first, architecture upgrade later; eval proof first, more agents later.

## What counts as "data" here

Not training samples for weights, but **evidence for system iteration**: real user
inputs, typical cases, failed transcripts, wrong tool calls, test logs, human
edits, diffs, agent trajectories, token spend, context-truncation points, success
and edge and failure cases, regression results, production monitoring. This
evidence trains the things *you* design — prompts, workflow, tool definitions,
memory schema, eval suite, routing rules, sub-agent roles, human-in-the-loop
checkpoints, context-selection strategy.

## The optimal end state

Not "the best prompt." A stable match between reality flow, agent architecture,
context system, tool interfaces, and eval standard — where failure can be found,
changes can be verified, regressions can be monitored, and every bit of
complexity traces to a real failure it resolves.

---

*Provenance: distilled from a long-form treatment of "the coding-agent goal mode
for long-chain LLM applications," reconciled with widely-published agent
engineering guidance (agentic workflows, context engineering, eval-driven
development, MLOps technical-debt patterns). Kept deliberately project-agnostic.*
