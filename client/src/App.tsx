import { useEffect, useState } from 'react';
import type {
  AssetRadarItem,
  AssetDetail,
  StrategyMeta,
} from './types';
import { fetchAssets, fetchAssetDetail, fetchStrategies } from './api/client';
import { StrategySwitcher } from './components/StrategySwitcher';
import { Radar } from './components/Radar';
import { AssetList } from './components/AssetList';
import { AssetDetail as AssetDetailPanel } from './components/AssetDetail';

export default function App() {
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [strategy, setStrategy] = useState('classic');
  const [items, setItems] = useState<AssetRadarItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // 加载策略列表(仅一次)
  useEffect(() => {
    fetchStrategies()
      .then((r) => setStrategies(r.strategies))
      .catch(() => setStrategies([]));
  }, []);

  // 资产雷达列表随策略变化刷新
  useEffect(() => {
    let cancelled = false;
    setListError(null);
    fetchAssets(strategy)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        // 默认选中信号最强的
        if (r.items.length > 0) {
          const top = [...r.items].sort((a, b) => b.signal.score - a.signal.score)[0];
          setActiveId(top.id);
        }
      })
      .catch(() => {
        if (!cancelled) setListError('无法连接后端,请确认后端服务已启动(:4000)');
      });
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  // 选中资产 -> 加载详情
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          投资雷达
          <small>买卖信号扫描系统</small>
        </div>
        <div className="spacer" />
        <StrategySwitcher strategies={strategies} active={strategy} onChange={setStrategy} />
      </header>

      <main className="main">
        {/* 左:雷达 + 信号榜 */}
        <section className="panel">
          <div className="panel-head">
            <h2>📡 实时雷达</h2>
            <span className="sub">{activeMeta ? `${activeMeta.name} · ${activeMeta.suitable}` : ''}</span>
          </div>
          <div className="radar-wrap">
            {listError ? (
              <div className="error-box">{listError}</div>
            ) : items.length === 0 ? (
              <div className="loading">扫描中…</div>
            ) : (
              <Radar items={items} activeId={activeId} onSelect={setActiveId} />
            )}
            <div className="legend">
              <span><i style={{ background: 'var(--buy)' }} /> 买入信号</span>
              <span><i style={{ background: 'var(--hold)' }} /> 观望</span>
              <span><i style={{ background: 'var(--sell)' }} /> 卖出信号</span>
            </div>
          </div>
          <AssetList items={items} activeId={activeId} onSelect={setActiveId} />
        </section>

        {/* 右:详情 */}
        <section className="panel">
          <div className="panel-head">
            <h2>📊 资产详情</h2>
            <span className="sub">K线 · 指标 · 买卖理由</span>
          </div>
          <AssetDetailPanel detail={detail} loading={detailLoading} error={detailError} />
        </section>
      </main>

      <div className="disclaimer">
        ⚠ 本工具基于技术指标提供参考信号,当前使用模拟数据,仅供学习研究,不构成任何投资建议。投资有风险,决策需谨慎。
      </div>
    </div>
  );
}
