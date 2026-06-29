# harness-first

[中文](README.zh-CN.md)

A portable, project-agnostic Agent Skill. It makes the first move in any new
project building a **self-verifying harness** — not writing code or a prompt —
through five gated phases (reality → boundaries → minimum link → eval → Maker-Checker).

## Install into a new project

Copy this whole folder into the new project's skill directory:

```bash
# Cursor
cp -r harness-first /path/to/new-project/.cursor/skills/harness-first

# Claude Code
cp -r harness-first /path/to/new-project/.claude/skills/harness-first
```

Both tools auto-discover it. Trigger it by starting greenfield work, or by saying
"bootstrap this project" / "let's build X" / "help me architect this".

## Layout

- [SKILL.md](SKILL.md) — the gated 5-phase workflow (start here)
- [references/](references/)
  - [templates.md](references/templates.md) — copy-paste deliverable templates per phase
  - [decision-gates.md](references/decision-gates.md) — detailed pass/fail criteria for each gate
  - [methodology.md](references/methodology.md) — the "why" — read on demand
- [README.md](README.md) / [README.zh-CN.md](README.zh-CN.md) — this file

No project-specific content — drop it into anything (backend, frontend, CMS,
automation, pipeline, or LLM/agent app).

When a workflow stabilizes, capture it as a skill with
[skill-authoring](../skill-authoring/) and hand off to skill-creator for eval.
