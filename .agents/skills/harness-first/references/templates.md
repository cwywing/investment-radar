# Deliverable templates

Copy the relevant block when you reach each phase. Keep them generic — these fit
any project type (backend, frontend, CMS, automation, pipeline, agent app).
Replace every `<...>` placeholder. Delete rows/sections that do not apply rather
than leaving them blank.

---

## Phase 0 — `docs/reality.md`

```markdown
# Reality model: <project name>

## What this is
<One sentence: the real-world task this project takes over or assists.>

## The real workflow today
> How does this get done right now, by a human or an existing system?
> List the actual sequence of steps, not the idealized one.

1. <step> — <who/what does it>
2. <step> — ...
3. ...

## Anatomy
- **Who does it today:** <role / system>
- **Trigger / context:** <when and where it starts>
- **Input(s):** <what arrives, in what shape>
- **Intermediate judgment points:** <the non-obvious decisions made mid-flow>
- **Final deliverable:** <the concrete output>
- **Success criteria:** <what "done well" means>
- **Where it usually fails:** <the high-failure step(s) — name them>

## Step nature
> Mark each step deterministic (a machine can do it exactly) or fuzzy (needs a
> judgment call / an LLM). If everything is "fuzzy", decompose further.

| # | Step | deterministic / fuzzy | notes |
|---|------|-----------------------|-------|
| 1 | <step> | deterministic | <e.g. lookup, transform, API call> |
| 2 | <step> | fuzzy | <e.g. classify intent, weigh tradeoffs> |
```

---

## Phase 1 — boundary table (append to `docs/reality.md`)

```markdown
## Boundaries — who owns each step

| # | Step | owner | guard / checkpoint | failure zone? |
|---|------|-------|--------------------|---------------|
| 1 | <step> | code | <validator / schema> | no |
| 2 | <step> | llm  | <human review / test> | yes |
| 3 | <step> | tool | <retry / fallback> | no |
| 4 | <step> | human | <approval gate> | yes |

### Must-hold constraints → mechanism
> Anything that must always be true. Route each to a mechanism, not a prompt.

| Constraint | Enforced by (mechanism) |
|------------|-------------------------|
| <e.g. output must match schema> | <JSON schema validator in CI> |
| <e.g. never write to prod without approval> | <permission gate / hook> |

### Persistent memory / inherited context
> Only fill in if the agent carries memory/context across runs (CLAUDE.md, auto-memory, a context cache, a DB of prior notes). If none, write N/A and skip.
> Memory is a liability, not just an asset: a stale note is silent context poison.

| What is stored | Why it helps future runs | Invalidation rule (when it expires / is re-validated / is deleted) |
|----------------|--------------------------|--------------------------------------------------------------------|
| <e.g. project layout + tool constraints> | <stops repeated re-discovery> | <re-checked when CI layout changes; otherwise stable> |
| <e.g. a past failure fix> | <avoids repeating it> | <deleted if it conflicts with a newer passing run> |
```

owner legend:
- `code` — deterministic logic / API the system runs itself.
- `llm` — a judgment call delegated to the model.
- `tool` — an external capability (search, DB, MCP, third-party API).
- `human` — a person must confirm, decide, or take over.

---

## Phase 2 — minimum link (no template file; a checklist)

The deliverable is running code, not a doc. Confirm:

```
- [ ] One main path runs end-to-end (input → ... → output).
- [ ] Exactly one green check exists (CI job / build / a single test).
- [ ] Deferred (write them down so they are explicit, not forgotten):
      auth, payments, admin, analytics, marketing, dashboards,
      multi-agent, large retrieval, complex memory, <others>.
- [ ] Every component present can name one failure it prevents.
```

---

## Phase 3 — `eval/cases.md`

```markdown
# Eval: <project name>

## How we know it succeeded
<Observable, checkable definition of success — not "looks good".>

## How we know it failed
<Observable failure signals.>

## On failure, record
<What to capture so the failure is reproducible and diagnosable:
input, trajectory/steps, tool calls, logs, state diff, cost/latency.>

## Cases
| id | input | expected outcome | check type | budget (cost/latency) | mirrors prod? |
|----|-------|------------------|------------|-----------------------|---------------|
| c1 | <input> | <expected> | deterministic test | <e.g. ≤ $0.02 / ≤ 10s> | yes |
| c2 | <input> | <expected> | state check | <e.g. ≤ $0.05 / ≤ 30s> | yes |
| c3 | <edge/failure input> | <graceful handling> | transcript review | <e.g. ≤ $0.10 / ≤ 60s> | yes |

> Budgets are rough ceilings, not SLAs. A breach is a *failing signal to investigate*,
> not an automatic test failure — record it, do not silently absorb it.

## Leakage guard
<Note how cases are kept out of the prompt/memory so they are not memorized.>
```

For agentic systems, prefer these check types over "read the final answer":
deterministic tests, static analysis, state checks, tool-call checks, transcript
metrics (steps taken, wrong turns, redundant context).
