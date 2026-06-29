# 投资雷达 📡

> 替个人投资者把"盯盘 + 凭感觉判断买卖"变成"看一张雷达图 + 收到信号推送"。
>
> English: [README.md](./README.md)

投资雷达扫描国内公募基金与国内 999 黄金，产出**确定性的** `buy / sell / hold` 信号，并附上历史胜率证据；信号档位变化时主动推送给你。**工具永远不会替你下单** —— 最终决策留在人手里。

本项目**不是 LLM 应用**。除了"这次信不信、要不要动手"这一步，其余绝大多数步骤都是确定性的规则计算，而那一步是**有意保留的人类关卡**（见 `docs/reality.md`）。

---

## 核心特性

- **雷达可视化** —— 一屏看完所有跟踪标的的信号（React + ECharts）。
- **信号确定性** —— 同一份 K 线 + 同一策略 ⇒ 分数恒等（C3）。
- **历史胜率回测** —— 每个信号都附带"历史上同类信号的胜率"，永不静默返回 `undefined`（C4）。
- **多源数据回退** —— CSV → 东方财富 / 天天基金 / fundgz → 离线模拟器。模拟数据**显著标红**，绝不被当成真实信号（C1）。
- **新鲜度守卫** —— 基金最新 K 线滞后超过 1 个交易日即视为失败、走回退（C2）。
- **不打扰的通知** —— hold 不推、同档位 24h 防抖、重启不重推（C5）；任一通道失败都不影响主流程（C6）。
- **不下单架构** —— 代码库中不存在任何交易/券商调用路径，由静态扫描测试守住（C7）。

---

## 技术栈

npm workspaces monorepo：

| 工作区 | 技术栈 |
|--------|--------|
| `server/` | Express + TypeScript + tsx + `node:test`，ESM（`"type": "module"`） |
| `client/` | React 18 + Vite + ECharts + Vitest |

技术指标（`MA / EMA / MACD / RSI / KDJ / BOLL`）与策略都是**纯函数** —— 不读 `Date.now()`、不读 `Math.random()`、不读外部状态。

---

## 目录结构

```
radar/
├─ server/
│  └─ src/
│     ├─ data/providers/   # eastmoney / tiantian / fundgz / csv + simulator 兜底
│     ├─ indicators/       # MA/EMA/MACD/RSI/KDJ/BOLL（纯函数）
│     ├─ strategies/       # trend / regime / goldFactor（纯函数）
│     ├─ services/         # backtest / notify / scan
│     ├─ notifiers/        # log / mail / serverchan（CompositeNotifier 聚合）
│     ├─ routes/           # /api/assets、/api/strategies、/api/datasources、/api/gold/*、/api/news/*
│     ├─ scripts/          # audit-backtest.ts
│     ├─ scheduler.ts      # 交易日关键时点刷新 + 22:10 信号推送
│     └─ test/             # node:test（离线 fixture + 契约测试）
├─ client/
│  └─ src/components/      # Radar / AssetList / AssetDetail / SignalBadge / StrategySwitcher / ...
├─ docs/reality.md         # 项目宪法：reality model + boundaries + Phase 0–4
├─ eval/cases.md           # 12 个 eval case，覆盖 C1–C7
└─ AGENT_INDEX.md          # 所有 AI 规则文档的发现地图
```

---

## 快速开始

```bash
# 安装（根目录，含 workspaces）
npm install

# 同时启动 server(4000) + client(vite)
npm run dev

# 或分别启动
npm run dev:server
npm run dev:client
```

然后在控制台输出的 Vite dev URL 打开前端。服务端健康检查：`http://localhost:4000/api/health`。

### 配置（可选）

复制 `server/.env.example` → `server/.env`（已被 gitignore），按需填通道：

```bash
PORT=4000

# QQ 邮箱通知（在 QQ 邮箱 设置→账户 开启 IMAP/SMTP，使用"授权码"，非登录密码）
SMTP_USER=123456@qq.com
SMTP_PASS=你的授权码
SMTP_TO=123456@qq.com   # 可选，默认发给自己 SMTP_USER

# Server酱（微信推送）—— 可选
SC_SENDKEY=SCT1234567890abcdef
```

未配置 `SMTP_*` 与 `SC_SENDKEY` 时，通知降级为仅控制台输出的 `LogNotifier`。

---

## 常用命令

```bash
npm run dev            # server + client 并发启动
npm test               # server node:test —— MUST 绿
npm run build          # server tsc + client vite build —— MUST 绿
npm run test:live -w server   # 联网真实抓取测试（不进默认 CI）
npm run audit -w server       # 回测审计脚本
```

宣称任何改动完成前，MUST 跑 `npm test && npm run build`，两道都绿才算完成。

---

## HTTP API（节选）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/health` | 服务健康 |
| GET | `/api/assets?strategy=` | 全部资产 + 当前信号（雷达主页） |
| GET | `/api/assets/:id?strategy=&days=` | 单资产详情 |
| GET | `/api/assets/:id/overview` | 单资产全策略并排对比 |
| GET | `/api/strategies` | 策略列表 |
| GET | `/api/datasources` | 各资产数据来源（`loaded=simulated` ⇒ 前端标红） |
| GET | `/api/gold/drivers` | Au99.99 定价拆解（只展示，不进分数） |
| GET | `/api/gold/intraday` | Au99.99 日内/夜盘分时 + VWAP（只展示） |
| GET | `/api/news/:id` | 背景新闻（只展示，永不进分数） |

---

## 策略

| id | 名称 | 思路 | 适用 |
|----|------|------|------|
| `trend` | 趋势跟踪 | 均线多空排列 + 站上 MA60 + N 日突破 | 单边行情 |
| `regime` | 市场状态自适应 | ADX 判趋势/震荡，自动切趋势或网格引擎 + ATR 波动过滤 | 多资产通用 |
| `goldFactor` | 黄金多因子（确认） | grid 定方向 + XAU/汇率/溢价/DXY 做确认（同向加分，反向降权，不翻转） | 黄金（默认策略） |

分数 → 动作映射：`分数 ≥ 30 → buy`、`分数 ≤ -30 → sell`，否则 `hold`。

---

## Must-hold 约束（C1–C7）

违反任一 = 严重 bug。完整表见 `CLAUDE.md` / `AGENTS.md`。

- **C1** —— 模拟数据 MUST NOT 被当成真实信号展示；用户 MUST 能分辨。
- **C2** —— 基金最新 K 线日期 MUST NOT 滞后超过 1 个交易日。
- **C3** —— 信号确定性：同一份 K 线 + 同一策略，分数 MUST 恒等。
- **C4** —— 回测 MUST NOT 静默丢失；数据不足 MUST 返回 `sampleInsufficient:true`，NEVER 返回 undefined。
- **C5** —— 通知 MUST NOT 打扰：hold 不推、同档位 24h 防抖、重启不重推。
- **C6** —— 通道失败 MUST NOT 影响主流程。
- **C7** —— 工具 NEVER 下单；代码库 NEVER 出现交易/下单调用路径。

---

## 项目边界（永不主动做）

auth、多用户、**自动下单（C7 永久边界）**、多 agent、数据源并列冗余。任何触及这些的改动 MUST 先在 `docs/reality.md` 更新边界讨论。

---

## 测试纪律

- **离线 case** 用固定 LCG 生成的 fixture（`fixedCandles`），MUST NOT 读真实 CSV、MUST NOT 依赖外部接口。
- **联网 case**（`e11/e12` 及未来新增）放在 `server/src/test/live/`，ONLY 通过 `npm run test:live -w server` 跑，MUST NOT 进默认 `npm test`。
- **C7** 由静态扫描测试 `e10` 守住：全代码库搜索交易/下单/券商调用模式，要求 **0 命中**。

---

## 文档地图

| 路径 | 角色 |
|------|------|
| `AGENT_INDEX.md` | 入口 —— 所有规则文档的发现地图 |
| `CLAUDE.md` / `AGENTS.md` | Claude Code 项目记忆 / 通用 agent 指引（内容等价） |
| `.cursor/rules/*.mdc` | Cursor 细分规则（按 glob 匹配） |
| `docs/reality.md` | 项目宪法：reality model + boundaries + Phase 0–4 |
| `eval/cases.md` | 12 个 eval case，覆盖 C1–C7 |

---

## License

私有项目，未授权对外发布。
