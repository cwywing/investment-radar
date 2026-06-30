<!-- AGENT_HEADER
@file CLAUDE.md
@role claude-code-project-memory (auto-loaded every session)
@see AGENT_INDEX.md, AGENTS.md, .cursor/rules/*.mdc, docs/reality.md, eval/cases.md
@constraints C1,C2,C3,C4,C5,C6,C7
@commands npm test, npm run build, npm run dev, npm run test:live -w server, npm run audit -w server
@globs-root server/**/*.ts, client/src/**/*.{ts,tsx,css}
@keywords investment-radar, must-hold, maker-checker, harness-first, eval-first, no-trade, simulated-data, signal-determinism
@updated 2026-06-30
-->

# CLAUDE.md — Investment Radar (投资雷达)

> Claude Code 项目记忆，每次会话自动加载。修改任一条 C 约束或纪律时，MUST 同步 `AGENTS.md` / `AGENT_INDEX.md` / `.cursor/rules/*.mdc` 以免漂移。

---

## 0. Must-hold 约束速查（C1–C7）—— 前置，最重要

> 违反任一 = 严重 bug，MUST 立即修。改动前 MUST 自检：这条改法会不会让哪条 C 失守？完整表见 §4。

- **C1** — 模拟数据 MUST NOT 被当成真实信号展示；用户 MUST 能分辨。
- **C2** — 基金最新 K 线日期 MUST NOT 滞后超过 1 个交易日。
- **C3** — 信号确定性：同一份 K 线 + 同一策略，分数 MUST 恒等。
- **C4** — 回测 MUST NOT 静默丢失；数据不足 MUST 返回 `sampleInsufficient:true`，NEVER 返回 undefined。
- **C5** — 通知 MUST NOT 打扰：hold 不推、同档位 24h 防抖、重启不重推。
- **C6** — 通道失败 MUST NOT 影响主流程。
- **C7** — 工具 NEVER 下单；代码库 NEVER 出现交易/下单调用路径。

---

## 1. 这是什么

替个人投资者把"盯盘 + 凭感觉判断买卖"变成"看一张雷达图 + 收到信号推送"的工具。覆盖国内公募基金与国内 999 黄金。**工具 NEVER 替用户下单**——只产出 buy/sell/hold 信号 + 历史胜率证据，最终决策留给人。

非 LLM 应用。绝大多数步骤是 deterministic 的规则计算，唯一 fuzzy 的是"这次信不信、要不要动手"，而那一步**故意留在人手里**。

## 2. 如何探测本项目所有规则

任何 AI agent 进入本项目时，MUST 先读 `AGENT_INDEX.md`（规则文档发现地图），再按需加载：

- `AGENT_INDEX.md` — 入口索引
- `AGENTS.md` — 通用 agent 指引（与本文件内容等价）
- `.cursor/rules/*.mdc` — Cursor 细分规则（按 glob 匹配）
- `docs/reality.md` — 项目宪法（reality model + boundaries + Phase 0–4）
- `eval/cases.md` — 12 个 eval case，覆盖 C1–C7

## 3. 技术栈与目录

Monorepo（npm workspaces）：

- `server/` — Express + TypeScript + tsx + node:test，ESM（`"type": "module"`）
  - `src/db/` — SQLite 持久化（`database.ts` schema + 迁移；`holdings.ts` 持仓 CRUD；`candles.ts` K线+因子 CRUD）
  - `src/data/providers/` — 多源行情抓取（eastmoney / tiantian / fundgz / sina / csv）+ simulator 兜底
  - `src/data/goldFactors.ts` — 黄金多因子（XAU/CNH/DXY）抓取 + 对齐，历史入 SQLite
  - `src/indicators/` — 技术指标（MA/EMA/MACD/RSI/KDJ/BOLL），MUST 纯函数
  - `src/strategies/` — 评分策略（classic/gold/regime/trend/volFilter），MUST 纯函数
  - `src/services/` — backtest / notify / scan / portfolio / holdingsImport
  - `src/routes/` — Express 路由（assets / holdings）
  - `src/notifiers/` — log / mail / serverchan（CompositeNotifier 聚合）
  - `src/scheduler.ts` — 定时扫描
  - `src/test/` — node:test 单元 + 契约测试
  - `src/scripts/audit-backtest.ts` — 回测审计脚本
- `client/` — React 18 + Vite + ECharts + Vitest
  - `src/components/` — Radar / AssetList / AssetDetail / SignalBadge / StrategySwitcher 等
- `docs/reality.md` — reality model + boundaries + Phase 0–4 状态（项目宪法）
- `eval/cases.md` — 12 个 eval case，覆盖 C1–C7

## 4. 常用命令

```bash
# 同时启动 server(4000) + client(vite)
npm run dev

# 单独
npm run dev:server
npm run dev:client

# 两道绿灯（宣称完成前 MUST 跑）
npm test              # server 工作区 node:test
npm run build         # server tsc + client vite build

# 联网真实抓取测试（不在默认 CI 跑）
npm run test:live -w server
npm run audit -w server
```

## 5. Must-hold 约束（C1–C7）—— 完整表

| ID | 约束 | 落地机制 |
|----|------|----------|
| **C1** | 模拟数据 MUST NOT 被当成真实信号展示。模拟是离线兜底，不是正常路径，用户 MUST 能分辨 | `/api/datasources` 暴露 `loaded` 来源；前端对 `loaded=simulated` 显著标红；回测对模拟数据单独标注不计入结论 |
| **C2** | 数据新鲜度有底线：基金最新 K 线日期 MUST NOT 滞后超过 1 个交易日 | dataProvider 拉取后校验 `lastCandle.date`，过期视为失败、走回退并 warn |
| **C3** | 信号确定性：同一份 K 线 + 同一策略，分数 MUST 恒等 | 策略纯函数 + golden snapshot 回归测试 |
| **C4** | 回测 MUST NOT 静默丢失：数据不足 MUST 明说，NEVER 返回 undefined | `backtestSignal` 数据不足分支返回 `{matched:0, sampleInsufficient:true, note:...}`，签名收窄为 `BacktestResult` |
| **C5** | 通知 MUST NOT 打扰：hold 不推、同档位 24h 防抖、重启不重推 | notify 服务状态比对 + 防抖窗口 + `signal-state.json` 落盘 |
| **C6** | 通道失败 MUST NOT 影响主流程 | CompositeNotifier 逐通道 try/catch，失败只 warn |
| **C7** | 工具 NEVER 下单：系统 NEVER 触达交易接口 | 架构层面——代码库 NEVER 出现交易/下单调用路径（由 `e10` 静态扫描测试守住） |

## 6. Harness-first / Maker-Checker 纪律

项目用 harness-first 五阶段方法论搭骨架（详见 `docs/reality.md`），现已全部通过。后续功能开发 MUST 遵守：

- **Maker**：写改动。
- **Checker**：宣称完成前 MUST 先跑 `npm test` + `npm run build`，读失败输出，从 ground truth 调下一次。**"成功但没跑 Checker" = 没完成。**
- 同一失败持续 2–3 次先走归因表：稳定具体失败 → 修 harness/契约；失败漂移 → 收紧 spec 或缩小步；"成功但无 Checker" → 先补 Checker。
- **earned-by-failure**：每加新组件 MUST 回答"哪个观察到的失败逼出了它"。Phase 2 的规则永不过期。
- **eval-first**：先写"怎么知道它对"（`eval/cases.md` 接 case），机制自然被逼出来。参考 `eval/cases.md` 的"待接入"表——实现对应模块时同步落 case。

## 7. 代码风格

- **TypeScript strict**，no implicit any，no unused。放宽 `tsconfig.json` 前先讨论。
- **server**：ESM，`import` MUST 带扩展名或走 bundler 解析；MUST 避免顶层急切赋值造成循环依赖 TDZ（已踩过坑，见 `docs/reality.md` Phase 2）。指标/策略 MUST 纯函数。
- **client**：函数组件 + hooks；样式与组件 colocate；ECharts 实例 MUST 销毁防泄漏。
- **错误处理**：NEVER 空 `catch {}`。`catch` 内 MUST `logger.warn/error` 并按需 throw typed error。
- **测试**：离线 case 用固定 fixture（`fixedCandles` LCG），MUST NOT 读真实 CSV、MUST NOT 依赖外部接口；联网 case 单独归类 `test:live`，MUST NOT 进默认 `npm test`。
- **提交前**：`npm test && npm run build` 两道 MUST 绿。

## 8. 持久状态（跨运行继承）

| 存储 | 用途 | 失效规则 |
|------|------|----------|
| 行情缓存（内存 Map，TTL 1h） | 防限流 | TTL 到期；交易日 15:30/22:00 主动失效 |
| 回测缓存（内存 Map，键 `assetId:strategyId`） | 避免重算 | **数据刷新后 MUST 失效**（已知隐患，Phase 4 待修） |
| `candles` 表（SQLite，`server/data/radar.db`） | K 线持久化，启动读库只增量抓最新 | 历史日期 immutable；最新一两日 upsert 修正；数据源切换时 source 字段记每根来源 |
| `factors` 表（SQLite） | 黄金多因子（xau/cnh/dxy）历史，反爬时读库复用 | 历史 immutable；增量 upsert；东财反爬时回退历史因子 |
| `holdings` / `holdings_history` 表（SQLite） | 用户持仓 + 变更历史（多账户） | 用户手动改写；CSV 导入覆盖 |
| `signal-state.json`（落盘） | 通知防抖、重启不重推 | 每次扫描覆写；7 天未变化清理 |
| `AssetConfig` 模拟参数 | 离线兜底 | 真实数据可用即被覆盖；**模拟数据 NEVER 入 SQLite** |

## 9. 当前阶段

harness 五阶段已就位，进入 4 个功能模块的正常 Maker-Checker 迭代：模块 A（前端标红 + datasources）、模块 B（数据新鲜度校验）、模块 C（audit-backtest 模拟数据分组）、模块 D（notify 服务 + signal-state.json）。每个模块实现时 MUST 同步接 `eval/cases.md` 对应 case。

## 10. 边界（NEVER 主动做）

auth、多用户、自动下单（C7 永不实现）、多 agent、数据源并列冗余——均为后续或永久不做。改动若触及这些，MUST 先在 `docs/reality.md` 更新边界再动手。
