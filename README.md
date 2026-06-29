# Investment Radar 📡

> Turn "staring at charts + trading on gut feel" into "glance at a radar + get signal push notifications".
>
> 中文文档：[README.zh-CN.md](./README.zh-CN.md)

Investment Radar is a personal-investor tool that scans Chinese public mutual funds and domestic 999 gold, produces deterministic `buy / sell / hold` signals backed by historical win-rate evidence, and pushes the signal to you when its tier changes. **The tool never places orders** — the final decision stays with the human.

This is **not** an LLM application. Almost every step is deterministic rule computation. The only fuzzy step — "do I trust this signal enough to act?" — is intentionally left in human hands (see `docs/reality.md`).

---

## Highlights

- **Radar visualization** — one screen shows every tracked asset's signal at a glance (React + ECharts).
- **Deterministic signals** — same candles + same strategy ⇒ identical score, every time (C3).
- **Historical win-rate backtest** — every signal comes with "how often this kind of signal won historically", never a silent `undefined` (C4).
- **Multi-source data fallback** — CSV → Eastmoney / Tiantian / fundgz → offline simulator. Simulated data is **clearly flagged** so it can never be mistaken for a real signal (C1).
- **Freshness guard** — stale fund candles (lag > 1 trading day) are treated as a failed source and trigger fallback (C2).
- **Non-intrusive notifications** — hold is never pushed, same tier is 24h-debounced, restarts don't re-push (C5). Channel failure never breaks the main flow (C6).
- **No-order architecture** — the codebase contains zero trading/broker call paths, enforced by a static-scan test (C7).

---

## Tech stack

Monorepo via npm workspaces:

| Workspace | Stack |
|-----------|-------|
| `server/` | Express + TypeScript + tsx + `node:test`, ESM (`"type": "module"`) |
| `client/` | React 18 + Vite + ECharts + Vitest |

Indicators (`MA / EMA / MACD / RSI / KDJ / BOLL`) and strategies are **pure functions** — no `Date.now()`, no `Math.random()`, no external state.

---

## Project structure

```
radar/
├─ server/
│  └─ src/
│     ├─ data/providers/   # eastmoney / tiantian / fundgz / csv + simulator fallback
│     ├─ indicators/       # MA/EMA/MACD/RSI/KDJ/BOLL (pure functions)
│     ├─ strategies/       # trend / regime / goldFactor (pure functions)
│     ├─ services/         # backtest / notify / scan
│     ├─ notifiers/        # log / mail / serverchan (CompositeNotifier aggregates)
│     ├─ routes/           # /api/assets, /api/strategies, /api/datasources, /api/gold/*, /api/news/*
│     ├─ scripts/          # audit-backtest.ts
│     ├─ scheduler.ts      # market-hours refresh + 22:10 signal push
│     └─ test/             # node:test (offline fixtures + contracts)
├─ client/
│  └─ src/components/      # Radar / AssetList / AssetDetail / SignalBadge / StrategySwitcher / ...
├─ docs/reality.md         # project constitution: reality model + boundaries + Phase 0–4
├─ eval/cases.md           # 12 eval cases covering C1–C7
└─ AGENT_INDEX.md          # discovery map for all AI rule docs
```

---

## Quick start

```bash
# install (root, workspaces)
npm install

# run server (4000) + client (vite) together
npm run dev

# or run them separately
npm run dev:server
npm run dev:client
```

Then open the Vite dev URL printed in the console. Server health check: `http://localhost:4000/api/health`.

### Configuration (optional)

Copy `server/.env.example` → `server/.env` (gitignored) and fill in the channels you want:

```bash
PORT=4000

# QQ mail push (enable IMAP/SMTP in QQ Mail settings, use the authorization code — not your login password)
SMTP_USER=123456@qq.com
SMTP_PASS=your-authorization-code
SMTP_TO=123456@qq.com   # optional, defaults to SMTP_USER

# ServerChan (WeChat push) — optional
SC_SENDKEY=SCT1234567890abcdef
```

With no `SMTP_*` and no `SC_SENDKEY` configured, notifications fall back to console-only `LogNotifier`.

---

## npm scripts

```bash
npm run dev            # server + client concurrently
npm test               # server node:test — MUST be green
npm run build          # server tsc + client vite build — MUST be green
npm run test:live -w server   # live network fetch tests (NOT in default CI)
npm run audit -w server       # backtest audit script
```

Before claiming any change is done, run `npm test && npm run build` — both must be green.

---

## HTTP API (selected)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | service health |
| GET | `/api/assets?strategy=` | all assets + current signal (radar home) |
| GET | `/api/assets/:id?strategy=&days=` | single asset detail |
| GET | `/api/assets/:id/overview` | all-strategy side-by-side for one asset |
| GET | `/api/strategies` | strategy list |
| GET | `/api/datasources` | per-asset data source (`loaded=simulated` ⇒ flag red on UI) |
| GET | `/api/gold/drivers` | Au99.99 pricing decomposition (display only, not in score) |
| GET | `/api/gold/intraday` | Au99.99 intraday/night session + VWAP (display only) |
| GET | `/api/news/:id` | background news (display only, never enters score) |

---

## Strategies

| id | name | idea | suits |
|----|------|------|-------|
| `trend` | Trend following | MA alignment + above MA60 + N-day breakout | trending markets |
| `regime` | Regime-adaptive | ADX picks trend vs grid engine + ATR volatility filter | multi-asset general |
| `goldFactor` | Gold multi-factor | grid sets direction + XAU/fx/premium/DXY confirm (same-direction adds, opposite down-weights, never flips) | gold (default strategy) |

Score → action mapping: `score ≥ 30 → buy`, `score ≤ -30 → sell`, else `hold`.

---

## Must-hold constraints (C1–C7)

Violating any of these is a serious bug. Full table in `CLAUDE.md` / `AGENTS.md`.

- **C1** — Simulated data MUST NOT be shown as a real signal; user MUST be able to tell.
- **C2** — Fund's latest candle date MUST NOT lag more than 1 trading day.
- **C3** — Signal determinism: same candles + same strategy ⇒ identical score.
- **C4** — Backtest MUST NOT silently drop; insufficient data returns `sampleInsufficient:true`, never `undefined`.
- **C5** — Notifications MUST NOT nag: no hold push, same-tier 24h debounce, no re-push after restart.
- **C6** — Channel failure MUST NOT break the main flow.
- **C7** — The tool NEVER places orders; the codebase NEVER contains a trading/broker call path.

---

## Project boundaries (never built)

auth, multi-user, **auto-ordering (C7 — permanent)**, multi-agent, redundant parallel data sources. Any change touching these MUST first update `docs/reality.md`.

---

## Testing philosophy

- **Offline cases** use fixed LCG-generated fixtures (`fixedCandles`) — never read real CSV, never hit external APIs.
- **Live cases** (`e11/e12` and future) live under `server/src/test/live/` and run only via `npm run test:live -w server`, never in default `npm test`.
- **C7** is guarded by a static-scan test (`e10`) that grep-scans the whole repo for trading/order/broker call patterns and requires **zero hits**.

---

## Documentation map

| Path | Role |
|------|------|
| `AGENT_INDEX.md` | entry point — discovery map for all rule docs |
| `CLAUDE.md` / `AGENTS.md` | project memory / generic agent guide (equivalent content) |
| `.cursor/rules/*.mdc` | Cursor-specific rules (glob-matched) |
| `docs/reality.md` | constitution: reality model + boundaries + Phase 0–4 |
| `eval/cases.md` | 12 eval cases covering C1–C7 |

---

## License

Private project, not licensed for redistribution.
