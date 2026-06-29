# Reality model: 投资雷达（Investment Radar）

## What this is
一个替个人投资者把"盯盘 + 凭感觉判断买卖"这件事，变成"看一张雷达图 + 收到信号推送"的工具——覆盖国内公募基金与国内 999 黄金两类标的。

## The real workflow today
> 不用这个工具时，一个真实的个人投资者现在怎么做这件事。

1. 打开支付宝 / 银行 APP / 天天基金，逐个点开持仓基金看当日净值和涨跌 — 人手动
2. 切到黄金页面看积存金/999 金报价 — 人手动
3. 心算或凭感觉判断："涨太多了吧？该止盈？跌这么多了，该补仓？" — 人脑，情绪化
4. 偶尔翻 K 线图，瞄一眼 MA/MACD 佐证自己的直觉 — 人脑 + 图表
5. 想起来才看；忙起来连看都不看，信号来了也错过 — 人，靠记忆
6. 做出买卖决定，手动在 APP 下单 — 人手动
7. 事后偶尔复盘："上次那个决定对不对？" — 人脑，通常没有数据依据

## Anatomy
- **Who does it today:** 一个持有几只基金 + 少量黄金的个人投资者（非专业、非高频）
- **Trigger / context:** 通常是交易日收盘后、晚上有空时；或半夜想到去看一眼黄金
- **Input(s):** 持仓标的清单（基金代码、黄金品种）；每个标的的历史净值/K线；最新价
- **Intermediate judgment points:**
  - 这个标的现在贵了还是便宜了？（估值判断）
  - 趋势是向上还是向下？（趋势判断）
  - 现在这个信号历史上靠不靠谱？（要不要信）
  - 要不要真的动手，还是再等等？（最终决策，受情绪/仓位/资金影响）
- **Final deliverable:** 一个"该买 / 该卖 / 继续拿"的明确动作 + 支撑理由 + 历史胜率证据
- **Success criteria:** 信号能及时触达（不用主动盯）；信号有历史依据而非拍脑袋；不会基于假数据给出误导动作；最终决策仍由人做（工具不替你下单）
- **Where it usually fails:**
  - **F1 数据断流**：行情接口限流/改字段，拉不到真实数据 → 掉回模拟数据 → 雷达显示**假信号**，用户据此下单是最危险的事
  - **F2 凭感觉**：涨了想追、跌了想割，工具若只是把直觉可视化，没真正约束情绪，价值有限
  - **F3 看不过来 / 忘记看**：标的多了顾此失彼，信号来了人不在屏幕前 → 雷达变"马后炮"
  - **F4 信号无依据**：给个 buy/sell 但说不出"历史上这类信号胜率多少"，用户不敢信也不敢用

## Step nature
> 标注每步是 deterministic（机器能精确做）还是 fuzzy（需要判断/LLM）。
> 本项目的关键特征：绝大多数步骤是 deterministic 的规则计算，唯一 fuzzy 的是"最终要不要动手"——而那一步**故意留在人手里**。

| # | Step | deterministic / fuzzy | notes |
|---|------|-----------------------|-------|
| 1 | 拉取行情数据（基金净值 / 黄金 K线） | deterministic | HTTP 接口抓取，但会失败（见 F1） |
| 2 | 数据标准化为统一 Candle 序列 | deterministic | 不同源字段/单位归一 |
| 3 | 计算技术指标（MA/MACD/RSI/KDJ/BOLL） | deterministic | 纯数学，固定公式 |
| 4 | 指标共振 → 综合分数（-100~+100） | deterministic | 规则固定，权重写死在策略里 |
| 5 | 分数 → buy/sell/hold 映射 | deterministic | 阈值固定（±30） |
| 6 | 历史回测：同类信号过去 N 次的胜率 | deterministic | 遍历历史切片，统计 |
| 7 | 信号档位变化 → 触发通知 | deterministic | 比对上次状态，非 hold 才推 |
| 8 | "这个信号我这次信不信、要不要重仓" | fuzzy | **人的最终决策**——仓位/资金/情绪/外部信息，工具不替你做 |
| 9 | 下单执行 | deterministic | 人手动在 APP 操作（未来可选自动化，但本次明确不做） |

> Phase 0 注解：本项目不是 LLM 应用，没有"把一切丢给模型"的诱惑。fuzzy 步骤只有第 8 步，且是有意保留的人类关卡（human checkpoint）——这正好是 Gate 1 要求的"deterministic 步骤已被识别"且"failure-prone step 已命名"（F1–F4）。

---

## Boundaries — who owns each step

| # | Step | owner | guard / checkpoint | failure zone? |
|---|------|-------|--------------------|---------------|
| 1 | 拉取行情数据（基金净值 / 黄金 K线） | tool | 多源回退链 + 重试退避 + **数据新鲜度校验**（见 C1） | **yes** — F1 假信号源头 |
| 2 | 数据标准化为统一 Candle 序列 | code | Candle 类型 + 单元测试（字段/单位归一） | no |
| 3 | 计算技术指标 | code | 指标函数纯函数 + 固定输入快照断言 | no |
| 4 | 指标共振 → 综合分数 | code | 策略单测：固定 K 线 → 固定分数（确定性回归） | no |
| 5 | 分数 → buy/sell/hold 映射 | code | 阈值常量 + 边界测试（29/30/31、-29/-30/-31） | no |
| 6 | 历史回测：同类信号胜率 | code | 样本不足时返回明确"样本不足"对象（不静默 undefined） | yes — F4 静默丢失信任 |
| 7 | 信号档位变化 → 触发通知 | code | 状态比对 + 防抖 + 非_hold 才推 + 落盘状态 | yes — F3 忘记看 |
| 8 | "这个信号我这次信不信、要不要重仓" | **human** | **人类最终关卡**——工具不下单，不替人决策 | yes — F2 凭感觉（工具不消除，只提供依据） |
| 9 | 下单执行 | **human** | 手动在 APP 操作；本次范围明确不做自动化 | yes — 但归人，不归系统 |

### Must-hold constraints → mechanism
> 必须始终成立的约束。每条路由到 mechanism，不是 prompt 里的希望。

| Constraint | Enforced by (mechanism) |
|------------|-------------------------|
| **C1 不许基于模拟数据给出"真实信号"** —— 模拟数据是离线兜底，不是正常路径，用户必须能分辨 | `/api/datasources` 暴露每资产 `loaded` 来源；**雷达主页对 `loaded=simulated` 的标的显著标红**（前端 mechanism）；回测对模拟数据行单独标注不计入结论 |
| **C2 数据新鲜度有底线** —— 基金最新 K 线日期不能滞后超过 1 个交易日（交易日次日起算） | dataProvider 拉取后校验 `lastCandle.date`；过期则视为失败、走回退并 warn |
| **C3 信号是确定性的** —— 同一份 K 线 + 同一策略，分数必须恒等 | 策略纯函数 + 快照回归测试（golden snapshot） |
| **C4 回测不许静默丢失** —— 数据不足要明说，不返回 undefined | backtest 返回 `sampleInsufficient:true` 对象 + 前端渲染该 note |
| **C5 通知不打扰** —— hold 不推、同档位 24h 防抖、重启不重推 | notify 服务：状态比对 + 防抖窗口 + `signal-state.json` 落盘 |
| **C6 通道失败不影响主流程** —— 推送挂了不能让雷达/调度崩 | CompositeNotifier 逐通道 try/catch，失败只 warn |
| **C7 工具不下单** —— 系统永远不触达交易接口 | 架构层面：不存在任何交易/下单代码路径；通知只含只读信息 |

### Persistent memory / inherited context
> 本项目跨运行继承的持久状态。

| What is stored | Why it helps future runs | Invalidation rule (when it expires / is re-validated / is deleted) |
|----------------|--------------------------|--------------------------------------------------------------------|
| 行情数据缓存（内存 Map，TTL 1h） | 避免每请求都打外部接口、防限流 | TTL 到期失效；交易日关键时点（15:30/22:00）主动失效重拉（见 C2） |
| 回测结果缓存（内存 Map，键 `assetId:strategyId`） | 回测遍历整段历史较重，避免重复算 | **数据刷新后必须失效**——否则会拿旧数据算的胜率配新信号（已识别为现存隐患） |
| 信号状态 `signal-state.json`（拟新增，落盘） | 通知防抖、重启不重推 | 每次扫描后覆写为最新；单条记录 7 天未变化则清理（防无限堆积） |
| 模拟参数（`AssetConfig` 里的 seed/drift/volatility） | 离线兜底用 | 真实数据可用时即被覆盖；不作为长期记忆，仅 fallback |

> Phase 1 注解：所有 high-failure 步骤（1、6、7）都有 deterministic code/tool 守卫，没有"裸露的高危步骤交给模型"。第 8、9 步是**有意的人类关卡**（C7 用架构层面"不存在交易代码"来强制，比 prompt 里写"请勿下单"可靠得多）。C1 是整个项目最重的约束——**模拟数据兜底是安全网，不是正常路径，必须让用户看得见**。

---

## Phase 2 — Minimum runnable link

骨架早已存在并跑通（server:4000 + client:vite + `/api/health`、`/api/assets`）。Phase 2 的工作不是重搭骨架，而是**补上唯一缺失的绿灯检查命令**，并让每个在场组件都能说出"它防止了哪个失败"。

### 第一个绿灯：`npm test`（server 工作区）
- 4 个测试，全部通过：
  1. 指标是纯函数（相同输入恒等输出）—— 防"指标被改成有状态/非确定性"
  2. 指标 golden snapshot（MA/EMA/RSI/BOLL/MACD/KDJ 有效值校验）—— 防"公式被意外改错"
  3. **C3 策略确定性**（同一份 K 线 → 恒等分数/动作/理由）—— 满足 must-hold C3
  4. **C5 阈值边界**（29/30/31、-29/-30/-31）—— 防"买卖阈值漂移"

### 期间暴露并修复的真实缺陷
- **循环依赖 TDZ**：`strategies/types.ts` 顶层急切赋值 `STRATEGIES.classic = classicStrategy`，与 `classic.ts` 反向 import 形成循环。生产能跑纯属 import 顺序巧合；测试先 import `classic.ts` 即触发 `ReferenceError`。
- **修法**：去掉顶层急切赋值，改 `ensureLoaded()` 在首次 `getStrategy`/`listStrategies` 调用时才解析（请求时所有模块已初始化，无 TDZ）。治本、最小手术，生产构建仍通过。

### 在场组件的"earned-by-failure"自证
| 组件 | 它防止的具体失败 |
|---|---|
| 三级数据回退链 | 主源限流时掉模拟而非崩——但见 C1：必须让用户看见是模拟 |
| `retry` + 退避 | 国内接口偶发空响应/限流导致的瞬时失败 |
| 回测缓存 | 重复遍历整段历史的性能浪费（已识别失效规则缺口，Phase 4 修） |
| 信号阈值常量 ±30 | 买卖判定漂移（现由测试 4 守住） |
| 策略纯函数 | 非确定性信号（现由测试 3 守住） |

### 明确推迟（不在本次最小链内）
auth、多用户、自动下单（C7 永不实现）、多 agent、通知中心（Phase 1 已划界，Phase 4 再加）、数据源并列冗余、调度刷新、回测审计脚本——均为后续阶段/模块，非最小链。

### 可观测性
- `npm test` TAP 输出可见每个测试通过/失败与耗时
- `npm run build`（tsc）作为第二道静态守卫，本次也通过
- 服务器运行时日志：`📡 [id] 已加载真实数据 N 根K线` / `⚠ 真实数据拉取失败` 可观察数据源健康

---

## Phase 4 — Maker-Checker loop

把 `eval/cases.md` 的**离线确定性 case** 接成可跑测试，让后续功能开发有 ground truth。联网 case（e11/e12）与依赖未实现通知服务的 case（e6/e7/e8/e9）按"complexity earned by failure"原则**不提前落**——等对应模块实现时同步接，避免为不存在的组件写永远红着的测试。

### 已接入的测试（`npm test`，6/6 绿）
| eval case | 测试 | 守的约束 | 状态 |
|---|---|---|---|
| e1 | 指标纯函数 + 策略确定性黄金快照 | C3 | ✅ 绿 |
| e4 | 回测数据不足返回 `sampleInsufficient` 而非 undefined | C4 | ✅ 绿（先补机制再接测试） |
| e10 | 全源码静态扫描无交易/券商调用 | C7 | ✅ 绿 |

### 为接入 e4 而补的机制（C4 落地）
- `BacktestResult` 加 `sampleInsufficient?: boolean`
- `backtestSignal` 数据不足分支由 `return undefined` 改为返回 `{matched:0, sampleInsufficient:true, note:'历史数据不足,无法回测'}`，签名收窄为 `BacktestResult`（不再可能 undefined）
- 这就是计划模块 C2 的内容，因 eval 驱动而提前落地——**eval-first 的价值**：先写"怎么知道它对"，机制自然就被逼出来

### 待接入（依赖未实现模块，实现时同步落）
| eval case | 依赖 | 落地时机 |
|---|---|---|
| e2 模拟数据标红可见 | 前端标红 + datasources usedProvider | 模块 A 前端改动时 |
| e3 数据新鲜度校验 | dataProvider 过期判定 | 模块 A/B 时 |
| e5 模拟数据回测不计入结论 | audit-backtest 脚本 | 模块 C 时 |
| e6/e7/e8 通知不打扰 | notify 服务 + signal-state.json | 模块 D 时 |
| e9 通道失败不崩 | CompositeNotifier | 模块 D 时 |
| e11/e12 联网真实抓取 | 单独 `test:live` 脚本 | 模块 A 完成后 |

### Maker-Checker 运行规则（后续写功能时遵守）
- **Maker**：写改动。
- **Checker**：必须先跑 `npm test` + `npm run build` 再宣称完成；读失败输出，从 ground truth 调下一次。
- 同一失败持续 2–3 次先走归因表：稳定具体失败 → 修 harness/契约；失败漂移 → 收紧 spec 或缩小步；"成功但无 Checker" → 先补 Checker。
- 每加新组件仍需回答"哪个观察到的失败逼出了它"——Phase 2 的 earned-by-failure 规则永不过期。

### harness-first 五阶段完成状态
五阶段全部通过，harness 已就位。后续 4 模块功能开发进入正常的 Maker-Checker 迭代：每个模块实现时同步补对应的 eval case（见上表），保持 `npm test` 持续绿。
