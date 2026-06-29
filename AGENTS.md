<!-- AGENT_HEADER
@file AGENTS.md
@role generic-ai-agent-guide (Codex / Aider / other agents)
@see AGENT_INDEX.md, CLAUDE.md, .cursor/rules/*.mdc, docs/reality.md, eval/cases.md
@constraints C1,C2,C3,C4,C5,C6,C7
@commands npm test, npm run build, npm run dev, npm run test:live -w server, npm run audit -w server
@keywords investment-radar, must-hold, maker-checker, harness-first, eval-first, no-trade, simulated-data, signal-determinism
@updated 2026-06-29
-->

# AGENTS.md — Investment Radar (投资雷达)

> 通用 AI coding agent 项目指引（Codex / Aider / 其它）。Cursor 用 `.cursor/rules/`，Claude Code 用 `CLAUDE.md`，三者内容等价；修改一处时 MUST 同步其余以免漂移。先读 `AGENT_INDEX.md` 获取完整文档地图。

---

## 0. Must-hold 约束速查（C1–C7）—— 前置，最重要

> 违反任一 = 严重 bug，MUST 立即修。

- **C1** — 模拟数据 MUST NOT 被当成真实信号展示；用户 MUST 能分辨。
- **C2** — 基金最新 K 线日期 MUST NOT 滞后超过 1 个交易日。
- **C3** — 信号确定性：同一份 K 线 + 同一策略，分数 MUST 恒等。
- **C4** — 回测 MUST NOT 静默丢失；数据不足 MUST 返回 `sampleInsufficient:true`，NEVER 返回 undefined。
- **C5** — 通知 MUST NOT 打扰：hold 不推、同档位 24h 防抖、重启不重推。
- **C6** — 通道失败 MUST NOT 影响主流程。
- **C7** — 工具 NEVER 下单；代码库 NEVER 出现交易/下单调用路径。

---

## 1. 项目是什么

替个人投资者把"盯盘 + 凭感觉判断买卖"变成"看雷达图 + 收信号推送"。覆盖国内公募基金与国内 999 黄金。**工具 NEVER 替用户下单**——只产出 buy/sell/hold 信号 + 历史胜率证据，最终决策留给人。非 LLM 应用。

## 2. 技术栈

Monorepo（npm workspaces）：

- `server/` — Express + TypeScript + tsx + node:test，ESM（`"type": "module"`）
  - `src/data/providers/` 多源行情抓取 + `simulator.ts` 兜底
  - `src/indicators/` 技术指标（MUST 纯函数）
  - `src/strategies/` 评分策略（MUST 纯函数）
  - `src/services/` backtest / notify / scan
  - `src/notifiers/` log / mail / serverchan
  - `src/scheduler.ts` 定时扫描
  - `src/test/` node:test
- `client/` — React 18 + Vite + ECharts + Vitest
- `docs/reality.md` — 项目宪法（reality model + boundaries + Phase 0–4）
- `eval/cases.md` — 12 个 eval case，覆盖 C1–C7

## 3. 常用命令

```bash
npm run dev              # server(4000) + client(vite)
npm test                 # server node:test —— MUST 绿
npm run build            # server tsc + client vite build —— MUST 绿
npm run test:live -w server   # 联网真实抓取测试（不进默认 CI）
npm run audit -w server       # 回测审计脚本
```

## 4. Must-hold 约束（C1–C7）—— 完整表

| ID | 约束 | 落地机制 |
|----|------|----------|
| **C1** | 模拟数据 MUST NOT 被当成真实信号展示，用户 MUST 能分辨 | `/api/datasources` 暴露 `loaded`；前端对 `loaded=simulated` 标红；回测模拟数据单独标注不计入结论 |
| **C2** | 基金最新 K 线日期 MUST NOT 滞后超过 1 个交易日 | dataProvider 拉取后校验，过期走回退并 warn |
| **C3** | 信号确定性：同一份 K 线 + 同一策略分数 MUST 恒等 | 策略纯函数 + golden snapshot 回归 |
| **C4** | 回测 MUST NOT 静默丢失，数据不足 MUST 明说，NEVER 返回 undefined | 返回 `{matched:0, sampleInsufficient:true, note:...}`，签名收窄为 `BacktestResult` |
| **C5** | 通知 MUST NOT 打扰：hold 不推、同档位 24h 防抖、重启不重推 | notify 状态比对 + 防抖 + `signal-state.json` 落盘 |
| **C6** | 通道失败 MUST NOT 影响主流程 | CompositeNotifier 逐通道 try/catch，失败只 warn |
| **C7** | 工具 NEVER 下单，系统 NEVER 触达交易接口 | 架构层面——代码库 NEVER 出现交易/下单调用路径（`e10` 静态扫描守住） |

## 5. Maker-Checker 纪律

- **Maker** 写改动。
- **Checker**：宣称完成前 MUST 先跑 `npm test` + `npm run build`，读失败输出再调。**"成功但没跑 Checker" = 没完成。**
- 同一失败持续 2–3 次先归因：稳定具体失败 → 修 harness/契约；失败漂移 → 收紧 spec；"成功但无 Checker" → 先补 Checker。
- **earned-by-failure**：每加新组件 MUST 回答"哪个观察到的失败逼出了它"。
- **eval-first**：先写"怎么知道它对"（接 `eval/cases.md` case），机制自然被逼出来。

## 6. 代码风格

- TypeScript strict，no implicit any，no unused。放宽 `tsconfig.json` 前先讨论。
- **server**：ESM，MUST 避免顶层急切赋值造成循环依赖 TDZ；指标/策略 MUST 纯函数。
- **client**：函数组件 + hooks；样式 colocate；ECharts 实例 MUST 销毁。
- **错误处理**：NEVER 空 `catch {}`，`catch` 内 MUST log 并按需 throw typed error。
- **测试**：离线 case 用固定 fixture，MUST NOT 读真实 CSV、MUST NOT 依赖外部接口；联网 case 单独 `test:live`，MUST NOT 进默认 `npm test`。
- **提交前**：`npm test && npm run build` 两道 MUST 绿。

## 7. 持久状态

| 存储 | 失效规则 |
|------|----------|
| 行情缓存（内存，TTL 1h） | TTL 到期；交易日 15:30/22:00 主动失效 |
| 回测缓存（内存，键 `assetId:strategyId`） | **数据刷新后 MUST 失效**（已知隐患待修） |
| `signal-state.json` | 每次扫描覆写；7 天未变化清理 |

## 8. 边界（NEVER 主动做）

auth、多用户、自动下单（C7 永不实现）、多 agent、数据源并列冗余——后续或永久不做。改动若触及，MUST 先在 `docs/reality.md` 更新边界再动手。
