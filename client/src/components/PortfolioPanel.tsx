import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetOption, HoldingHistoryRecord, PortfolioSummary } from '../types';
import {
  deleteHolding,
  fetchAssetOptions,
  fetchHoldingsHistory,
  fetchPortfolio,
  importHoldingsCsv,
  upsertHolding,
} from '../api/client';
import { SignalBadge } from './SignalBadge';

interface Props {
  fundStrategy: string;
  goldStrategy: string;
  onSelectAsset: (id: string) => void;
}

const ACTION_LABEL: Record<string, string> = {
  upsert: '更新',
  delete: '删除',
  import: '导入',
};

const SOURCE_LABEL: Record<string, string> = {
  manual: '手动',
  csv: 'CSV',
  api: 'API',
};

function formatHistoryLine(h: HoldingHistoryRecord, nameById: Map<string, string>): string {
  const name = nameById.get(h.assetId) ?? h.assetId;
  const acct = h.accountKey !== 'default' ? ` [${h.accountKey}]` : '';
  const before = h.sharesBefore !== null ? h.sharesBefore : '-';
  const after = h.sharesAfter !== null ? h.sharesAfter : '-';
  return `${name}${acct}: ${before} → ${after} 份`;
}

// 通用弹窗:遮罩 + ESC 关闭 + 点击遮罩关闭。复用全局 .modal-overlay/.modal 样式。
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal portfolio-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function PortfolioPanel({ fundStrategy, goldStrategy, onSelectAsset }: Props) {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [options, setOptions] = useState<AssetOption[]>([]);
  const [history, setHistory] = useState<HoldingHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetId, setAssetId] = useState('');
  const [accountKey, setAccountKey] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [shares, setShares] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const nameById = new Map(options.map((o) => [o.id, o.name]));

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPortfolio(fundStrategy, goldStrategy),
      fetchAssetOptions(),
      fetchHoldingsHistory(30),
    ])
      .then(([p, o, h]) => {
        setSummary(p);
        setOptions(o.options);
        setHistory(h.history);
      })
      .catch(() => setError('加载持仓失败,请确认后端已启动'))
      .finally(() => setLoading(false));
  }, [fundStrategy, goldStrategy]);

  useEffect(() => {
    reload();
  }, [reload]);

  function resetForm() {
    setShares('');
    setCostPrice('');
    setNote('');
    setAccountKey('');
    setAccountLabel('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId) return;
    const sharesNum = Number(shares);
    if (!Number.isFinite(sharesNum) || sharesNum < 0) return;
    setSaving(true);
    setImportMsg(null);
    try {
      await upsertHolding(assetId, {
        shares: sharesNum,
        costPrice: costPrice === '' ? null : Number(costPrice),
        note: note.trim() || null,
        accountKey: accountKey.trim() || 'default',
        accountLabel: accountLabel.trim() || null,
      });
      resetForm();
      reload();
      setShowFormModal(false);
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assetId: string, acctKey: string) {
    try {
      await deleteHolding(assetId, acctKey);
      reload();
    } catch {
      setError('删除失败');
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportMsg(null);
    setError(null);
    try {
      const csv = await file.text();
      const r = await importHoldingsCsv(csv);
      setImportMsg(`已导入 ${r.imported} 条${r.errors.length ? `, ${r.errors.length} 条跳过` : ''}`);
      if (r.errors.length > 0) {
        setError(r.errors.slice(0, 3).join('; '));
      }
      reload();
    } catch {
      setError('CSV 导入失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (loading && !summary) {
    return <div className="loading">加载持仓…</div>;
  }

  if (error && !summary) {
    return <div className="error-box">{error}</div>;
  }

  const s = summary!;

  return (
    <div className="portfolio-panel">
      <div className="portfolio-metrics">
        <div className="metric">
          <span className="metric-label">总市值(估)</span>
          <span className="metric-value">¥{s.totalValue.toLocaleString()}</span>
        </div>
        <div className="metric">
          <span className="metric-label">加权信号</span>
          <span className={`metric-value ${s.weightedScore >= 30 ? 'up' : s.weightedScore <= -30 ? 'down' : ''}`}>
            {s.weightedScore}
            <span className="metric-suffix">{s.overallTone}</span>
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">配置</span>
          <span className="metric-value metric-duo">
            <span>基金 <b>{s.allocation.fundPct}%</b></span>
            <span>贵金属 <b>{s.allocation.metalPct}%</b></span>
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">信号分布</span>
          <span className="metric-value metric-dist">
            <span className="dist-buy">买 {s.actionCounts.buy}</span>
            <span className="dist-hold">观 {s.actionCounts.hold}</span>
            <span className="dist-sell">卖 {s.actionCounts.sell}</span>
          </span>
        </div>
      </div>

      <p className="portfolio-notify-hint">
        有持仓时,通知仅针对持仓标的;卖出信号需仓位 ≥20% 才推送(可在服务端用 PORTFOLIO_SELL_MIN_WEIGHT 调整)。
      </p>

      {s.advisories.length > 0 && (
        <div className="portfolio-advice">
          <h3>综合建议</h3>
          <ul>
            {s.advisories.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <p className="sub">
            基金策略 {s.fundStrategy} · 黄金策略 {s.goldStrategy} · 仅供参考,不构成投资建议
          </p>
        </div>
      )}

      <div className="portfolio-actions-bar">
        <button type="button" className="action-btn primary" onClick={() => setShowFormModal(true)}>
          ＋ 录入持仓
        </button>
        <button type="button" className="action-btn" onClick={() => { setImportMsg(null); setShowImportModal(true); }}>
          📥 CSV 导入
        </button>
        <button
          type="button"
          className="action-btn ghost"
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory ? '收起' : '查看'}变更历史 ({history.length})
        </button>
      </div>

      {showHistory && (
        <div className="portfolio-history-box">
          <ul className="history-list">
            {history.length === 0 ? (
              <li className="empty-hint">暂无变更记录</li>
            ) : (
              history.map((h) => (
                <li key={h.id}>
                  <span className="history-time">{h.createdAt.slice(0, 19).replace('T', ' ')}</span>
                  <span className="history-action">{ACTION_LABEL[h.action] ?? h.action}</span>
                  <span className="history-source">{SOURCE_LABEL[h.source] ?? h.source}</span>
                  <span>{formatHistoryLine(h, nameById)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      <div className="signal-list portfolio-list">
        {s.items.length === 0 ? (
          <div className="empty-hint">暂无持仓,请点击上方"录入持仓"或"CSV 导入"。份额:基金=份,黄金=克。</div>
        ) : (
          s.items.map((item) => (
            <div
              key={item.holdingKey}
              className={`holding-row ${item.loaded === 'simulated' ? 'simulated' : ''} ${(!item.loaded || item.loaded !== 'simulated') && item.proxyNote ? 'proxy' : ''}`}
            >
              <div className="holding-signal">
                <SignalBadge action={item.signal.action} score={item.signal.score} />
                <span className="holding-weight">{(item.weight * 100).toFixed(1)}%</span>
              </div>
              <div className="holding-body" onClick={() => onSelectAsset(item.assetId)}>
                <div className="holding-title">
                  <span className="holding-name">{item.accountLabel ?? item.name}</span>
                  <span className="holding-sym">{item.symbol}{item.accountKey !== 'default' && ` · ${item.accountKey}`}</span>
                  {item.loaded === 'simulated' && (
                    <span className="sim-tag">模拟</span>
                  )}
                  {item.loaded !== 'simulated' && item.proxyNote && (
                    <span className="proxy-tag" title={`真实行情接口不可用,当前用近似数据源: ${item.proxyNote}`}>近似</span>
                  )}
                  {item.lowConfidence && (
                    <span className="lowconf-tag">低置信</span>
                  )}
                </div>
                <div className="holding-stats">
                  <span className="stat-chip">{item.shares} 份</span>
                  <span className="stat-chip">市值 ¥{item.marketValue.toFixed(2)}</span>
                  {item.pnlPct !== null && (
                    <span className={`pnl-pill ${item.pnlPct >= 0 ? 'pos' : 'neg'}`}>
                      {item.pnlPct >= 0 ? '+' : ''}{item.pnlPct}%
                    </span>
                  )}
                </div>
                <div className="holding-reason">{item.signal.reasons[0]}</div>
              </div>
              <div className="holding-actions">
                <button type="button" className="link-btn" onClick={() => onSelectAsset(item.assetId)}>
                  详情
                </button>
                <button type="button" className="link-btn danger" onClick={() => handleDelete(item.assetId, item.accountKey)}>
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showFormModal && (
        <Modal title="录入 / 更新持仓" onClose={() => setShowFormModal(false)}>
          <form className="portfolio-form" onSubmit={handleSave}>
            <div className="form-grid">
              <label className="form-field">
                <span className="form-label">选择标的</span>
                <select value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
                  <option value="">选择标的</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.symbol})
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">账户标识(如 cmb-1852)</span>
                <input
                  type="text"
                  placeholder="cmb-1852"
                  value={accountKey}
                  onChange={(e) => setAccountKey(e.target.value)}
                  pattern="[a-z0-9_-]{1,32}"
                  title="小写字母/数字/下划线/连字符"
                />
              </label>
              <label className="form-field">
                <span className="form-label">账户名称(如 招行黄金)</span>
                <input
                  type="text"
                  placeholder="招行黄金"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  maxLength={64}
                />
              </label>
              <label className="form-field">
                <span className="form-label">份额</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="份额"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                <span className="form-label">成本价(可选)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="成本价"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span className="form-label">备注(可选)</span>
                <input
                  type="text"
                  placeholder="备注"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="action-btn ghost" onClick={() => setShowFormModal(false)}>取消</button>
              <button type="submit" className="action-btn primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showImportModal && (
        <Modal title="CSV 批量导入" onClose={() => setShowImportModal(false)}>
          <p className="modal-tip">
            表头需含 shares 与 asset_id(或 symbol);可选 account_key、account_label。示例见 server/data/holdings.example.csv
          </p>
          <div className="portfolio-import-body">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
              }}
            />
            {importing && <span className="sub">导入中…</span>}
            {importMsg && <span className="sub up">{importMsg}</span>}
          </div>
          <div className="form-actions">
            <button type="button" className="action-btn ghost" onClick={() => setShowImportModal(false)}>关闭</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
