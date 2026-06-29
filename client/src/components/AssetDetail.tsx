import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { AssetDetail, BacktestResult } from '../types';
import { SignalBadge } from './SignalBadge';
import { Stars } from './Stars';

interface Props {
  detail: AssetDetail | null;
  loading: boolean;
  error: string | null;
}

const CLASS_LABEL: Record<string, string> = {
  fund: '基金',
  metal: '贵金属',
};

const ACTION_TEXT: Record<string, string> = {
  buy: '建议买入',
  sell: '建议卖出',
  hold: '建议观望',
};

function ma(arr: number[], n: number): (number | '-')[] {
  const out: (number | '-')[] = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out.push(Math.round((sum / n) * 10000) / 10000);
    else out.push('-');
  }
  return out;
}

export function AssetDetail({ detail, loading, error }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current || !detail) return;
    if (!chartInst.current) {
      chartInst.current = echarts.init(chartRef.current, 'dark');
    }
    const chart = chartInst.current;

    const closes = detail.candles.map((c) => c.close);
    const ohlc = detail.candles.map((c) => [c.open, c.close, c.low, c.high]);
    const dates = detail.candles.map((c) => c.date);

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 50, right: 20, top: 20, bottom: 60 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#1b3050' } },
        axisLabel: { color: '#5a7090', fontSize: 10 },
        boundaryGap: true,
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#142540' } },
        axisLabel: { color: '#5a7090', fontSize: 10 },
      },
      dataZoom: [
        { type: 'inside', start: 60, end: 100 },
        {
          type: 'slider',
          start: 60,
          end: 100,
          height: 18,
          bottom: 8,
          borderColor: '#1b3050',
          fillerColor: 'rgba(45,212,191,0.12)',
          textStyle: { color: '#5a7090' },
        },
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0a1628',
        borderColor: '#1b3050',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
      },
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: ohlc,
          itemStyle: {
            color: '#22c55e',
            color0: '#ef4444',
            borderColor: '#22c55e',
            borderColor0: '#ef4444',
          },
        },
        {
          name: 'MA5',
          type: 'line',
          data: ma(closes, 5),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, color: '#facc15' },
        },
        {
          name: 'MA20',
          type: 'line',
          data: ma(closes, 20),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, color: '#38bdf8' },
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [detail]);

  if (loading) return <div className="loading">扫描资产数据中…</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!detail) {
    return (
      <div className="loading">
        点击雷达上的光点或右侧资产,查看详细买卖分析。
      </div>
    );
  }

  const { signal, backtest } = detail;
  const isPositive = signal.score >= 0;
  const indEntries = Object.entries(signal.indicators);
  const dims = signal.dimensions;
  const checks = signal.checks ?? [];
  const bullCount = checks.filter((c) => c.direction === 'bullish').length;
  const bearCount = checks.filter((c) => c.direction === 'bearish').length;

  return (
    <div className="detail-body">
      <div className="detail-title">
        <h3>{detail.name}</h3>
        <span className="class-tag">{CLASS_LABEL[detail.assetClass]}</span>
        <span className="class-tag">{detail.symbol}</span>
      </div>
      <div className="detail-price">
        <span className="now">{detail.candles.at(-1)?.close}</span>
        <SignalBadge action={signal.action} />
        <Stars score={signal.score} />
      </div>

      <div className="chart-box" ref={chartRef} />

      {/* 多维拆分 */}
      {dims && (
        <>
          <div className="section-title">维度评分</div>
          <DimBar label="趋势" score={dims.trend} />
          <DimBar label="估值" score={dims.valuation} />
          <DimBar label="风险" score={dims.risk} hint={dims.risk > 50 ? '较低' : '偏高'} />
        </>
      )}

      {/* 指标共振 */}
      {checks.length > 0 && (
        <>
          <div className="section-title">指标共振 · 多空票数</div>
          <div className="resonance">
            <span className="bull">▲ 看多 {bullCount}</span>
            <span className="bear">▼ 看空 {bearCount}</span>
            <span>中性 {checks.length - bullCount - bearCount}</span>
            <span>共 {checks.length} 项</span>
          </div>
          <div className="checks">
            {checks.map((c, i) => (
              <div className="check-item" key={i}>
                <span className={`tag ${c.direction}`}>
                  {c.direction === 'bullish' ? '多' : c.direction === 'bearish' ? '空' : '中'}
                </span>
                <span className="lbl">{c.label}</span>
                {c.detail && <span className="det">{c.detail}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 历史回测证据 */}
      {backtest && <BacktestCard data={backtest} action={signal.action} />}

      {/* 买卖理由 */}
      <div className={`signal-card ${signal.action}`}>
        <div className="head">
          <strong>{ACTION_TEXT[signal.action]}</strong>
          <span className="hint">综合评分 {signal.score > 0 ? '+' : ''}{signal.score}</span>
        </div>
        <div className="score-bar">
          <div
            className="fill"
            style={{
              width: `${Math.abs(signal.score) / 2}%`,
              left: isPositive ? '50%' : `${50 - Math.abs(signal.score) / 2}%`,
              background:
                signal.action === 'buy' ? 'var(--buy)' : signal.action === 'sell' ? 'var(--sell)' : 'var(--hold)',
            }}
          />
        </div>
        <div className="reasons-title">为什么{ACTION_TEXT[signal.action]}?</div>
        <ul className="reasons">
          {signal.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="section-title">当前指标值</div>
      <div className="ind-grid">
        {indEntries.map(([k, v]) => (
          <div className="ind-item" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DimBar({ label, score, hint }: { label: string; score: number; hint?: string }) {
  const pct = Math.abs(score) / 2; // 0~50%
  const positive = score >= 0;
  const color = score > 20 ? 'var(--buy)' : score < -20 ? 'var(--sell)' : 'var(--hold)';
  return (
    <div className="dim-row">
      <span className="k">{label}</span>
      <div className="dim-track">
        <div className="midline" />
        <div
          className="fill"
          style={{
            width: `${pct}%`,
            left: positive ? '50%' : `${50 - pct}%`,
            background: color,
          }}
        />
      </div>
      <span className="v">
        {score > 0 ? '+' : ''}{Math.round(score)}{hint ? ` · ${hint}` : ''}
      </span>
    </div>
  );
}

function BacktestCard({ data, action }: { data: BacktestResult; action: string }) {
  const winPct = data.winRate == null ? null : Math.round(data.winRate * 100);
  // 强弱:买入胜率>=60/卖出胜率>=60 为可靠,40~59 仅供参考,<40 不可靠
  const reliable = winPct == null ? 'unsure' : winPct >= 60 ? 'ok' : winPct >= 40 ? 'unsure' : 'weak';
  const cls = reliable === 'weak' ? 'weak' : reliable === 'unsure' ? 'unsure' : '';
  const icon = reliable === 'weak' ? '⚠' : '🛰';

  return (
    <div className={`backtest-card ${cls}`}>
      <div className="backtest-head">
        <span className="icon">{icon}</span> 历史回测证据
        <span className="hint" style={{ marginLeft: 'auto', fontWeight: 400 }}>
          未来 {data.horizon} 个交易日
        </span>
      </div>
      {winPct == null ? (
        <div className="backtest-note">{data.note}</div>
      ) : (
        <>
          <div className="backtest-stats">
            <div className="backtest-stat">
              <div className="num" style={{ color: reliable === 'weak' ? 'var(--sell)' : reliable === 'ok' ? 'var(--buy)' : 'var(--hold)' }}>
                {winPct}%
              </div>
              <div className="lab">{action === 'buy' ? '历史上涨概率' : '历史下跌概率'}</div>
            </div>
            <div className="backtest-stat">
              <div className="num">{data.avgReturn != null ? `${data.avgReturn >= 0 ? '+' : ''}${data.avgReturn.toFixed(1)}%` : '—'}</div>
              <div className="lab">平均收益</div>
            </div>
            <div className="backtest-stat">
              <div className="num">{data.matched}</div>
              <div className="lab">历史样本数</div>
            </div>
          </div>
          <div className="backtest-note">{data.note}</div>
        </>
      )}
    </div>
  );
}
