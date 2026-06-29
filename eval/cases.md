# Eval: 投资雷达（Investment Radar）

## How we know it succeeded
- **信号确定性**：同一份 K 线 + 同一策略，多次调用分数/动作/理由恒等（C3）。
- **数据真实性可见**：任一资产掉到模拟数据时，`/api/datasources` 返回 `loaded=simulated`，且雷达主页该标的显著标红（C1）。
- **数据新鲜度达标**：交易日次日起，基金最新 K 线日期不滞后超过 1 个交易日（C2）。
- **回测不静默**：历史样本不足时，详情接口返回 `sampleInsufficient:true` + note，而非 `backtest: undefined`（C4）。
- **通知不打扰**：hold 不推；同档位 24h 内不重复推；进程重启后不重推已发送过的信号（C5）。
- **通道失败不崩**：任一通知通道报错，雷达/调度主流程不受影响（C6）。
- **不下单**：代码库中不存在任何交易/下单调用路径（C7）。

## How we know it failed
- 信号出现非确定性（同输入不同分数）。
- 模拟数据被当成真实信号展示且**未标注**（用户可能据此下单 = 最危险失败 F1）。
- 数据已过期（滞后 >1 交易日）却仍缓存返回、未触发回退/告警。
- 回测返回 `undefined` 或前端渲染为空白，用户以为"没这功能"。
- hold 档位触发推送；或重启后把昨天的信号又推一遍。
- 通知通道异常导致调度任务抛错中断。
- 代码库出现指向任何券商/交易接口的调用。

## On failure, record
- **输入**：触发 case 的资产 id、策略 id、K 线快照（或模拟数据标志）、时间戳。
- **轨迹**：dataProvider 命中的 provider 链与 `usedProvider`、缓存命中/失效、调度触发时点。
- **状态 diff**：`/api/datasources` 前后快照、`signal-state.json` 前后内容、回测缓存 key 状态。
- **日志**：`📡` / `⚠` 行 + 通知通道的 try/catch warn。
- **成本/延迟**：单次扫描耗时、单资产回测耗时、通知单推耗时；超预算即记录为 failing signal。
- **可复现前提**：注明是否需要联网（真实源）、是否需要 mock 时钟/通道。

## Cases

| id | input | expected outcome | check type | budget (cost/latency) | mirrors prod? |
|----|-------|------------------|------------|-----------------------|---------------|
| e1 | 同一份 120 根固定 K 线，classic 策略，调用 evaluate 两次 | 分数/动作/reasons 完全相等 | deterministic test | ≤ $0 / ≤ 1s | yes |
| e2 | 强制某资产 `loaded=simulated`（断网或 mock provider 全失败） | `/api/datasources` 该行 `loaded='simulated'`；雷达主页该标的标红可见 | state check + DOM 断言 | ≤ $0 / ≤ 5s | yes（离线即此情形） |
| e3 | 基金最新 K 线日期 = 今天前 3 个交易日 | dataProvider 判定过期 → 走回退并 warn，不直接返回旧缓存 | deterministic test (mock 日期) | ≤ $0 / ≤ 2s | yes |
| e4 | 资产 candles 长度 < `60+HORIZON+10`（样本不足） | `backtest` 返回 `{matched:0, sampleInsufficient:true, note:'历史数据不足…'}`，非 undefined | deterministic test | ≤ $0 / ≤ 1s | yes |
| e5 | 模拟数据资产 × 回测 | 回测结果 note 含"模拟数据"标注，且**不**纳入全局胜率结论（audit 脚本单独分组） | transcript/state review | ≤ $0 / ≤ 5s | yes |
| e6 | `lastSignalState` 为 hold，本次扫描仍 hold | 不触发任何通知 | state check | ≤ $0 / ≤ 1s | yes |
| e7 | `lastSignalState` 为 hold，本次变 buy；24h 内再次 buy | 仅第一次推送，第二次被防抖吞掉 | state check + 通道 mock 计数 | ≤ $0 / ≤ 2s | yes |
| e8 | 已推过 buy，重启进程后首次扫描仍 buy | **不**重推（`signal-state.json` 落盘恢复） | state check | ≤ $0 / ≤ 3s | yes |
| e9 | 通知通道 mock 抛错 | 该通道 warn，其他通道仍发，调度/扫描不抛错中断 | transcript review | ≤ $0 / ≤ 2s | yes |
| e10 | 全代码库搜索交易/下单相关调用 | 0 命中（grep `下单\|trade\|order\|buy.*api\|sell.*api` 在交易语义下） | static analysis | ≤ $0 / ≤ 5s | yes |
| e11 | 拉取真实黄金/基金数据（联网） | 至少主源或备源之一成功，`usedProvider` 落到真实源；模拟回退率 < 5% | state check | ≤ $0 / ≤ 30s | yes（需联网） |
| e12 | `/api/assets` 端到端（联网） | 200，items 数 = `ASSET_CONFIGS.length`，每个 item 有合法 signal | state check | ≤ $0 / ≤ 30s | yes（需联网） |

> 预算列是粗略上限，不是 SLA。超预算记为 failing signal 去排查，不静默吞掉。本项目无 LLM 调用，cost 列基本恒为 $0；latency 预算才是主关注点（回测遍历整段历史是已知重操作，e11/e12 给到 30s）。

## Leakage guard
- 本项目不是 LLM 应用，不存在"prompt 记忆 eval 答案"的泄露路径。
- 真实泄露风险是**测试 fixture 与生产数据混用**：
  - e1/e4/e6/e7/e8/e9 用**测试内自造的固定 K 线**（`fixedCandles` LCG），不读 `server/data/csv/*`，不依赖外部接口 → 离线可复现、不受真实行情漂移影响。
  - e2/e3 用 **mock provider / mock 时钟**，强制失败路径，不污染真实缓存。
  - e11/e12 是**联网真实环境**检查，单独归类，离线 CI 里跳过（`npm test` 不跑联网 case；联网 case 用单独脚本 `npm run test:live` 或 `audit-backtest`，明确标注需网络）。
- 回测 golden 值若将来引入，必须基于**固定 fixture**，不能基于某天抓到的真实净值——否则真实数据更新后 golden 失效，测试变 flaky。
- `signal-state.json` 测试用临时目录隔离，不读写真实落盘文件。

## Phase 3 注解
- 12 个 case 覆盖全部 7 条 must-hold 约束（C1→e2, C2→e3, C3→e1, C4→e4/e5, C5→e6/e7/e8, C6→e9, C7→e10）。
- 失败可复现：所有离线 case 用固定种子/mock，按需重现；联网 case 单独归类并标注。
- 成本/延迟预算存在且超支可见——本项目 cost≈$0，重点在 latency（回测/抓取是重操作）。
- 本项目无 LLM、无 agent 轨迹，故 check type 以 deterministic test / state check / static analysis 为主，无 transcript 长链分析需求。
