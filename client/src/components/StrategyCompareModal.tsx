import { useEffect, useState } from 'react';
import type { StrategyOverviewResponse } from '../types';
import { fetchStrategiesOverview } from '../api/client';
import { SignalBadge } from './SignalBadge';

interface Props {
  assetId: string;
  onClose: () => void;
}

// 策略对比弹窗:对当前选中资产,并排展示 5 个策略的信号 + 历史回测胜率,
// 一目了然谁说买谁说卖、哪个历史上更靠谱。点击行可了解该策略思路。
export function StrategyCompareModal({ assetId, onClose }: Props) {
  const [data, setData] = useState<StrategyOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStrategiesOverview(assetId)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setError('加载策略概览失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pct(v: number | null): string {
    if (v == null || Number.isNaN(v)) return '—';
    return `${Math.round(v * 100)}%`;
  }
  function ret(v: number | null): string {
    if (v == null || Number.isNaN(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  }
  function reliability(row: { matched: number; winRate: number | null; lowConfidence: boolean }): { label: string; cls: string } {
    if (row.matched === 0) return { label: '无样本', cls: 'none' };
    if (row.lowConfidence) return { label: '不可靠', cls: 'bad' };
    if (row.winRate == null || Number.isNaN(row.winRate)) return { label: '样本不足', cls: 'none' };
    if (row.winRate >= 0.6) return { label: '可靠', cls: 'good' };
    if (row.winRate >= 0.5) return { label: '参考', cls: 'mid' };
    return { label: '不可靠', cls: 'bad' };
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal strategy-compare" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📊 策略对比 {data ? `· ${data.asset.name}` : ''}</h3>
          <button className="modal-close" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="modal-body">
          {loading && <div className="loading">加载中…</div>}
          {error && <div className="error-box">{error}</div>}
          {data && (
            <>
              <p className="modal-tip">同一资产,各策略各自的信号与历史回测。胜率=该策略同类信号历史上 20 日内获胜比例。</p>
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>策略</th>
                    <th>信号</th>
                    <th>胜率</th>
                    <th>样本</th>
                    <th>均收益</th>
                    <th>可靠性</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const rel = reliability(r);
                    return (
                      <tr key={r.id} className={r.lowConfidence ? 'lowconf' : ''}>
                        <td className="strat-cell">
                          <div className="strat-name">{r.name}</div>
                          <div className="strat-desc">{r.desc}</div>
                          <div className="strat-reason">{r.topReason}</div>
                        </td>
                        <td><SignalBadge action={r.action} score={r.score} /></td>
                        <td className="winrate">{pct(r.winRate)}</td>
                        <td>{r.matched}</td>
                        <td className={r.avgReturn != null && r.avgReturn >= 0 ? 'up' : 'down'}>{ret(r.avgReturn)}</td>
                        <td><span className={`rel-tag ${rel.cls}`}>{rel.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
