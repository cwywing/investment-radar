# Decision gates — detailed criteria

A gate is a hard stop between phases. Its purpose is to keep the agent (and you)
from sprinting in a wrong direction. Treat every gate as pass/fail: if any check
fails, stay in the current phase and fix the deliverable. Do not negotiate a gate
down to "good enough for now" — that is precisely how a project drifts on day one.

---

## Gate 1 — Reality confirmed? (after Phase 0)

PASS requires all:
- The real workflow is written as the *actual* sequence done today, not an idealized one.
- At least one step is marked **deterministic**. If every step is "fuzzy / the model decides", the task is under-decomposed — split it until concrete machine-doable steps appear.
- The high-failure step is named explicitly.
- The final deliverable and success criteria are concrete and observable.

FAIL signals: vague "the AI handles it" steps; no named failure mode; success criteria that read as "produces good output".

---

## Gate 2 — Boundaries safe? (after Phase 1)

PASS requires all:
- Every step has exactly one owner (`code` / `llm` / `tool` / `human`).
- No step is simultaneously (a) in a high-failure zone and (b) without any `human` checkpoint and without any deterministic `code`/`tool` guard.
- Every must-hold constraint is routed to a **mechanism** (code, schema, validator, test, hook, permission), not left as prose to be obeyed by a future prompt.
- Any persistent memory/context the agent inherits across runs has a stated **invalidation rule**: when does a stored note expire or get re-validated? A memory store with no invalidation rule is a slow-acting context-poison bug — it will compound yesterday's error into every future run. (If no persistent memory exists yet, mark N/A and move on.)

FAIL signals: a critical decision left to the model with no verification; constraints living only inside prompt text; "the model will remember to…"; a CLAUDE.md / auto-memory / context cache that only ever *appends*, with no rule for what gets expired, re-checked, or deleted.

> Load-bearing principle: a model *seeing* a rule is not the system *enforcing*
> it. Soft, inheritable knowledge → context (a config doc the agent reads).
> Must-hold rules → mechanism.

---

## Gate 3 — No earned-by-failure violations? (after Phase 2)

PASS requires all:
- For each component already in the system, you can state one concrete failure that occurs without it. Components that cannot name their failure are removed.
- The skeleton runs end-to-end on the main path.
- The system is observable: you can see it succeed *and* fail (logs, test output, inspectable state). If you cannot watch it fail, you cannot iterate.

FAIL signals: multi-agent / RAG / elaborate memory added before any failure demanded it; a skeleton that "should work" but has never run; no way to observe a failure.

---

## Gate 4 — Failure reproducible? (after Phase 3)

PASS requires all:
- At least one failure case can be reproduced on demand.
- Success and failure are defined as observable checks, not impressions.
- Eval cases are isolated from prompt/memory so they cannot be silently memorized (no data leakage).
- Cases mirror the real environment closely enough to catch local-pass / production-fail skew.
- Each case has a stated **budget** (cost and/or latency ceiling). Going over budget is *recorded as a failing signal*, not silently absorbed — long-chain agents usually die from cost/latency before they die from wrongness. A suite with no budget column hides the failure mode that ships in production. (Budgets may be rough; "≤ $0.05 / ≤ 30s per run" is fine. What matters is that the number exists and breaches are visible.)

FAIL signals: "it failed once but I can't reproduce it"; eval that only reads the final answer; cases copied into the prompt; a suite that passes locally while the real environment behaves differently; every run is "correct" but no one knows what it costs or how long it takes.

---

## The meta-gate (applies in every phase, including Phase 4)

Before adding *any* new piece of complexity — a sub-agent, a tool, a memory
layer, a workflow branch, a service — ask: **which observed failure forces this?**
No answer means do not add it. This single question prevents the most common
failure of agent systems: a peripheral structure more complex than the core task,
built from imagination rather than evidence.
