import { useEffect, useMemo, useState } from 'react';
import type {
  AssetRadarItem,
  AssetDetail,
  StrategyMeta,
} from './types';
import { fetchAssets, fetchAssetDetail, fetchStrategies } from './api/client';
import { StrategySwitcher } from './components/StrategySwitcher';
import { StrategyCompareModal } from './components/StrategyCompareModal';
import { Radar } from './components/Radar';
import { AssetList } from './components/AssetList';
import { AssetDetail as AssetDetailPanel } from './components/AssetDetail';
import {
  type Theme,
  getStoredTheme,
  applyTheme,
  getThemeColors,
} from './theme';

type ViewTab = 'gold' | 'fund';

// 每个视图的默认策略依据回测审计证据(2026-06-29):
//   金属 au9999 → goldFactor(确认版) 历史胜率 70% / 平均 +1.2%,优于 grid 的 62% / +0.7%。
//     机制:grid 定方向(均值回归边际),XAU/汇率/溢价/DXY 做确认——同向加分、反向降权(不翻转),
//     剔除与国际面冲突的弱信号(样本 368→232,更纯)。无因子时自动回退纯 grid,不退化。
//   基金 → trend 平均胜率 51%;regime 在半导体 65%/消费 74% 更优,但 fund-gold 仅 23%。
//     基金无因子字段,goldFactor 在基金上回退 grid(46%),不及 trend,故基金默认 trend。
//   regime 在金属上仅 22%(ADX 把均值回归误判为趋势),不作为默认。
// 两边策略独立,可随时在顶栏切换,后期加新策略只需注册到 STRATEGIES。
const DEFAULT_GOLD_STRATEGY = 'goldFactor';
const DEFAULT_FUND_STRATEGY = 'trend';

export default function App() {
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [tab, setTab] = useState<ViewTab>('gold');
  const [goldStrategy, setGoldStrategy] = useState<string>(DEFAULT_GOLD_STRATEGY);
  const [fundStrategy, setFundStrategy] = useState<string>(DEFAULT_FUND_STRATEGY);
  const [allItems, setAllItems] = useState<AssetRadarItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [showCompare, setShowCompare] = useState(false);

  // 当前视图的策略(黄金/基金各自独立)
  const strategy = tab === 'gold' ? goldStrategy : fundStrategy;
  const setStrategy = tab === 'gold' ? setGoldStrategy : setFundStrategy;

  // 应用主题到 <html> 并持久化
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const colors = getThemeColors(theme);

  // 加载策略列表(仅一次)
  useEffect(() => {
    fetchStrategies()
      .then((r) => setStrategies(r.strategies))
      .catch(() => setStrategies([]));
  }, []);

  // 资产列表随「当前视图策略」变化刷新(拉全量,前端按 tab 过滤)
  useEffect(() => {
    let cancelled = false;
    setListError(null);
    fetchAssets(strategy)
      .then((r) => {
        if (!cancelled) setAllItems(r.items);
      })
      .catch(() => {
        if (!cancelled) setListError('无法连接后端,请确认后端服务已启动(:4000)');
      });
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  // 当前视图展示的标的:黄金=仅 AU9999(对应银行积存金),基金=全部 fund 类
  const items = useMemo(() => {
    if (tab === 'gold') return allItems.filter((i) => i.id === 'au9999');
    return allItems.filter((i) => i.assetClass === 'fund');
  }, [allItems, tab]);

  // 切 tab 或列表刷新后,选定默认查看项:黄金固定 au9999;基金选信号最强那只
  useEffect(() => {
    if (items.length === 0) {
      setActiveId(null);
      return;
    }
    if (tab === 'gold') {
      setActiveId(items[0]?.id ?? null);
    } else {
      const top = [...items].sort((a, b) => b.signal.score - a.signal.score)[0];
      setActiveId(top.id);
    }
  }, [items, tab]);

  // 选中资产 -> 加载详情(用当前视图策略)
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetchAssetDetail(activeId, strategy)
      .then((r) => {
        if (!cancelled) setDetail(r.asset);
      })
      .catch(() => {
        if (!cancelled) setDetailError('加载详情失败');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, strategy]);

  const activeMeta = strategies.find((s) => s.id === strategy);
  // 单资产(黄金)时雷达无意义,隐藏只留列表
  const showRadar = items.length > 1;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          投资雷达
          <small>买卖信号扫描系统</small>
        </div>
        <div className="spacer" />
        <div className="view-tabs">
          <button
            className={`view-tab ${tab === 'gold' ? 'active' : ''}`}
            onClick={() => setTab('gold')}
          >
            🥇 黄金
          </button>
          <button
            className={`view-tab ${tab === 'fund' ? 'active' : ''}`}
            onClick={() => setTab('fund')}
          >
            📈 基金
          </button>
        </div>
        <StrategySwitcher strategies={strategies} active={strategy} onChange={setStrategy} />
        <button
          className="compare-btn"
          onClick={() => setShowCompare(true)}
          disabled={!activeId}
          title="对比各策略在当前资产上的信号与历史胜率"
        >
          📊 对比
        </button>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
        >
          <span className="icon">{theme === 'dark' ? '☀' : '☾'}</span>
          {theme === 'dark' ? '白天' : '夜间'}
        </button>
      </header>

      <main className="main">
        {/* 左:雷达 + 信号榜 */}
        <section className="panel">
          <div className="panel-head">
            <h2>{tab === 'gold' ? '🥇 黄金信号' : '📈 基金信号'}</h2>
            <span className="sub">{activeMeta ? `${activeMeta.name}` : ''}</span>
          </div>
          {showRadar && (
            <div className="radar-wrap">
              {listError ? (
                <div className="error-box">{listError}</div>
              ) : items.length === 0 ? (
                <div className="loading">扫描中…</div>
              ) : (
                <Radar items={items} activeId={activeId} onSelect={setActiveId} colors={colors} />
              )}
              <div className="legend">
                <span><i style={{ background: 'var(--buy)' }} /> 买入信号</span>
                <span><i style={{ background: 'var(--hold)' }} /> 观望</span>
                <span><i style={{ background: 'var(--sell)' }} /> 卖出信号</span>
              </div>
            </div>
          )}
          {!showRadar && listError && <div className="error-box">{listError}</div>}
          <AssetList items={items} activeId={activeId} onSelect={setActiveId} />
        </section>

        {/* 右:策略说明 + 详情 */}
        <section className="panel">
          <div className="panel-head">
            <h2>📊 资产详情</h2>
            <span className="sub">K线 · 指标 · 买卖理由</span>
          </div>
          {activeMeta && (
            <div className="strategy-info">
              <div className="strategy-info-head">
                <strong>策略:{activeMeta.name}</strong>
                <span className="sub">适用:{activeMeta.suitable}</span>
              </div>
              <div className="strategy-info-desc">{activeMeta.desc}</div>
            </div>
          )}
          <AssetDetailPanel detail={detail} loading={detailLoading} error={detailError} colors={colors} theme={theme} />
        </section>
      </main>

      <div className="disclaimer">
        ⚠ 本工具基于技术指标提供参考信号,仅供学习研究,不构成任何投资建议。投资有风险,决策需谨慎。
      </div>

      {showCompare && activeId && (
        <StrategyCompareModal assetId={activeId} onClose={() => setShowCompare(false)} />
      )}
    </div>
  );
}
