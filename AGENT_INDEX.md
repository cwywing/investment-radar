<!-- AGENT_HEADER
@file AGENT_INDEX.md
@role agent-entrypoint (discovery map for all AI rule docs)
@load-order CLAUDE.md (Claude Code) | AGENTS.md (generic) | .cursor/rules/*.mdc (Cursor) | docs/reality.md (constitution) | eval/cases.md (eval truth)
@constraints C1,C2,C3,C4,C5,C6,C7
@commands npm test, npm run build, npm run dev, npm run test:live -w server, npm run audit -w server
@skills .agents/skills/harness-first/SKILL.md (source of truth; .cursor/skills and .claude/skills are symlinks)
@updated 2026-06-29
-->

# AGENT_INDEX — Investment Radar 规则文档发现地图

> 本文件是给大模型看的入口。任何 AI coding agent 进入本项目时，MUST 先读本文件，再按需加载列出的规则文档。文件路径稳定，可 grep。

## 0. 一句话项目摘要

替个人投资者把"盯盘 + 凭感觉判断买卖"变成"看雷达图 + 收信号推送"。覆盖国内公募基金 + 999 黄金。**工具 NEVER 下单**，只产出 buy/sell/hold 信号 + 历史胜率证据，最终决策留给人。非 LLM 应用。

## 1. 规则文档清单（按优先级）

| 路径 | 角色 | 加载时机 | 必读 |
|------|------|----------|------|
| `CLAUDE.md` | Claude Code 项目记忆 | 每次会话自动 | YES |
| `AGENTS.md` | 通用 agent 指引（Codex/Aider/其它） | 每次会话 | YES |
| `.cursor/rules/project-overview.mdc` | 项目总览 + C1–C7 | Cursor 每次会话（alwaysApply） | YES |
| `.cursor/rules/harness-discipline.mdc` | Maker-Checker 纪律 | Cursor 每次会话（alwaysApply） | YES |
| `.cursor/rules/no-trade-c7.mdc` | C7 不下单硬约束 | Cursor 每次会话（alwaysApply） | YES |
| `.cursor/rules/server-typescript.mdc` | 后端约定 | 改 `server/**/*.ts` 时 | 按需 |
| `.cursor/rules/client-react.mdc` | 前端约定 | 改 `client/src/**` 时 | 按需 |
| `docs/reality.md` | 项目宪法（reality model + boundaries + Phase 0–4） | 重大改动前 | YES |
| `eval/cases.md` | 12 个 eval case，覆盖 C1–C7 | 加功能/测试前 | YES |
| `.agents/skills/harness-first/SKILL.md` | harness-first 五阶段方法论 skill（source of truth） | 启动新项目/重构骨架前 | 按需 |
| `.cursor/skills` → `../.agents/skills` | Cursor 自动加载的 skills（软链） | Cursor IDE 自动 | 自动 |
| `.claude/skills` → `../.agents/skills` | Claude Code 自动加载的 skills（软链） | Claude Code 自动 | 自动 |

## 2. Must-hold 约束速查（C1–C7）

> 完整版在 `CLAUDE.md` §4 / `AGENTS.md` / `.cursor/rules/project-overview.mdc`。违反任一 = 严重 bug，MUST 立即修。

- **C1** — 模拟数据 MUST NOT 被当成真实信号展示；用户 MUST 能分辨。
- **C2** — 基金最新 K 线日期 MUST NOT 滞后超过 1 个交易日。
- **C3** — 信号确定性：同一份 K 线 + 同一策略，分数 MUST 恒等。
- **C4** — 回测 MUST NOT 静默丢失；数据不足 MUST 返回 `sampleInsufficient:true`，NEVER 返回 undefined。
- **C5** — 通知 MUST NOT 打扰：hold 不推、同档位 24h 防抖、重启不重推。
- **C6** — 通道失败 MUST NOT 影响主流程。
- **C7** — 工具 NEVER 下单；代码库 NEVER 出现交易/下单调用路径。

## 3. 必跑命令（两道绿灯）

```bash
npm test          # server node:test —— MUST 绿
npm run build     # server tsc + client vite build —— MUST 绿
```

宣称任何改动完成前，MUST 先跑这两道。**"成功但没跑 Checker" = 没完成。**

## 4. 边界（NEVER 主动做）

auth、多用户、自动下单（C7 永不实现）、多 agent、数据源并列冗余。触及前 MUST 先在 `docs/reality.md` 更新边界讨论。

## 5. 如何用本索引

1. 进入项目 → 读本文件。
2. 按上表"必读"列加载对应文档。
3. 改动前对照 §2 的 C1–C7 自检：这条改法会不会让哪条 C 失守？
4. 改完跑 §3 两道绿灯。
5. 加新组件回答"哪个观察到的失败逼出了它"（earned-by-failure）。
