import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { AssetDetail, BacktestResult, NewsItem, GoldDrivers, GoldIntraday } from '../types';
import { SignalBadge } from './SignalBadge';
import { Stars } from './Stars';
import { fetchAssetNews, fetchGoldDrivers, fetchGoldIntraday } from '../api/client';
import type { Theme, ThemeColors } from '../theme';

interface Props {
  detail: AssetDetail | null;
  loading: boolean;
  error: string | null;
  colors: ThemeColors;
  theme: Theme;
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

export function AssetDetail({ detail, loading, error, colors, theme }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current || !detail) return;
    // 主题切换时旧实例(用 'dark' 内置主题初始化)需销毁重建,否则配色残留
    if (chartInst.current) {
      chartInst.current.dispose();
      chartInst.current = null;
    }
    chartInst.current = echarts.init(chartRef.current, theme === 'dark' ? 'dark' : undefined);
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
        axisLine: { lineStyle: { color: colors.border } },
        axisLabel: { color: colors.textFaint, fontSize: 10 },
        boundaryGap: true,
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: colors.borderSoft } },
        axisLabel: { color: colors.textFaint, fontSize: 10 },
      },
      dataZoom: [
        { type: 'inside', start: 60, end: 100 },
        {
          type: 'slider',
          start: 60,
          end: 100,
          height: 18,
          bottom: 8,
          borderColor: colors.border,
          fillerColor: theme === 'dark' ? 'rgba(45,212,191,0.12)' : 'rgba(13,148,136,0.15)',
          textStyle: { color: colors.textFaint },
        },
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.bgPanel,
        borderColor: colors.border,
        textStyle: { color: colors.text, fontSize: 12 },
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
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [detail, theme, colors]);

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
  // C3:详情页用回测胜率派生低置信(与列表同口径),信号卡显式警示 F4
  const btWinRate = backtest?.winRate;
  const lowConfidence = !!backtest && !backtest.sampleInsufficient
    && backtest.matched >= 10 && btWinRate != null && Number.isFinite(btWinRate) && btWinRate < 0.5;
  const lowConfPct = btWinRate != null && Number.isFinite(btWinRate) ? Math.round(btWinRate * 100) : null;

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
        {lowConfidence && lowConfPct != null && (
          <div className="lowconf-warn">
            ⚠ 历史胜率低({lowConfPct}%):该信号历史上十次错超五次,谨慎参考
          </div>
        )}
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

      {detail.id === 'au9999' && <GoldIntradayPanel />}
      {detail.id === 'au9999' && <GoldDriversPanel />}

      <NewsPanel assetId={detail.id} />
    </div>
  );
}

// 黄金日内/夜盘分时 —— 仅 au9999 显示。背景参考,不参与信号/回测(C3/C4 不受影响)。
// 呼应 Gemini 战情简报的「VWAP 分水岭 / 夜盘监控 / 盘中战术观测点」。
function GoldIntradayPanel() {
  const [d, setD] = useState<GoldIntraday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchGoldIntraday()
      .then((r) => { if (!cancelled) setD(r.intraday); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
  const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—');
  const signClass = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  const phaseClass = d ? `gd-phase-${d.sessionPhase}` : '';

  return (
    <>
      <div className="section-title">
        🌙 日内/夜盘分时
        <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>背景参考,不参与信号计算</span>
      </div>
      {loading ? (
        <div className="loading">加载分时数据中…</div>
      ) : error || !d ? (
        <div className="hint">分时数据源暂不可用(不影响信号)</div>
      ) : (
        <div className="gold-intraday">
          <div className="gd-row">
            <span className="gd-label">最新价</span>
            <span className="gd-value">{fmt(d.current)}</span>
            <span className={`gd-phase ${phaseClass}`}>{d.sessionPhase}</span>
          </div>

          <div className="gd-vwap">
            <div className="gd-vwap-main">
              <span>VWAP 分水岭</span>
              <b>{fmt(d.vwap)}</b>
            </div>
            <div className={`gd-dist ${signClass(d.distVwap)}`}>
              距 VWAP {d.distVwap >= 0 ? '+' : ''}{fmt(d.distVwap)} 元 ({fmtPct(d.distVwapPct)})
              <span className="gd-dist-hint">{d.distVwap > 0 ? '偏强' : d.distVwap < 0 ? '偏弱' : '持平'}</span>
            </div>
          </div>

          <div className="gd-session-grid">
            <div className="gd-sess-block">
              <div className="gd-sess-title">夜盘 20:00-02:30</div>
              {d.night.hasData ? (
                <>
                  <div className="gd-sess-row"><span>开</span><b>{fmt(d.night.open)}</b><span>收</span><b>{fmt(d.night.close)}</b></div>
                  <div className="gd-sess-row"><span>高</span><b>{fmt(d.night.high)}</b><span>低</span><b>{fmt(d.night.low)}</b></div>
                  <div className={`gd-sess-chg ${signClass(d.night.chgPct)}`}>夜盘涨跌 {fmtPct(d.night.chgPct)}</div>
                </>
              ) : <div className="hint">暂无夜盘数据</div>}
            </div>
            <div className="gd-sess-block">
              <div className="gd-sess-title">日盘 09:00-15:30</div>
              {d.day.hasData ? (
                <>
                  <div className="gd-sess-row"><span>开</span><b>{fmt(d.day.open)}</b></div>
                  <div className="gd-sess-row"><span>高</span><b>{fmt(d.day.high)}</b><span>低</span><b>{fmt(d.day.low)}</b></div>
                </>
              ) : <div className="hint">尚未开盘或无数据</div>}
            </div>
          </div>

          <div className="gd-session-range">
            本会话区间: <b>{fmt(d.sessionLow)}</b> ~ <b>{fmt(d.sessionHigh)}</b> · 共 {d.barsCount} 根 1 分钟线
          </div>
          <div className="gd-note">VWAP = Σ(价×量)/Σ量,日内分水岭。数据源: {d.source}</div>
        </div>
      )}
    </>
  );
}

// 黄金定价拆解 —— 仅 au9999 显示。
// 把"Au99.99 涨了"拆成 国际金价 / 人民币汇率 / 国内溢价 三因子贡献,呼应 ChatGPT/Gemini 建议。
// 这些驱动因子(XAU/USD、USD/CNH、DXY、溢价)现已进入 goldFactor 策略评分
// (挂在每根日线上,回测切片随 K 线走,确定性可回测)。本面板展示当日拆解,
// 评分逻辑见 goldFactor 策略(顶栏策略切换可选)。
function GoldDriversPanel() {
  const [d, setD] = useState<GoldDrivers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchGoldDrivers()
      .then((r) => { if (!cancelled) setD(r.drivers); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
  const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—');
  const signClass = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

  return (
    <>
      <div className="section-title">
        🧮 黄金定价拆解
        <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>因子已进入 goldFactor 策略评分(顶栏可切换)</span>
      </div>
      {loading ? (
        <div className="loading">加载国际行情中…</div>
      ) : error || !d ? (
        <div className="hint">国际行情源暂不可用(不影响信号)</div>
      ) : (
        <div className="gold-drivers">
          <div className="gd-row">
            <span className="gd-label">国内溢价</span>
            <span className={`gd-value ${signClass(d.premium)}`}>
              {d.premium >= 0 ? '+' : ''}{fmt(d.premium)} 元/克
            </span>
            <span className={`gd-tag gd-tag-${d.premiumStatus === '正常' ? 'normal' : d.premiumStatus === '异常偏高' ? 'high' : 'low'}`}>
              {d.premiumStatus}
            </span>
          </div>
          <div className="gd-explain">
            人民币计价国际金价 = {fmt(d.xauUsd)} × {fmt(d.usdCnh, 4)} ÷ 31.1035 = <b>{fmt(d.rmbImplied)} 元/克</b>
          </div>

          <div className="gd-subtitle">今日 Au99.99 涨幅拆解</div>
          <div className="gd-decomp">
            <div className="gd-total">
              <span>Au99.99</span>
              <span className={`gd-big ${signClass(d.auChgPct)}`}>{fmtPct(d.auChgPct)}</span>
            </div>
            <div className="gd-eq">=</div>
            <div className="gd-factor">
              <span>国际金价</span>
              <span className={signClass(d.intlContrib)}>{fmtPct(d.intlContrib)}</span>
            </div>
            <div className="gd-plus">+</div>
            <div className="gd-factor">
              <span>人民币汇率</span>
              <span className={signClass(d.fxContrib)}>{fmtPct(d.fxContrib)}</span>
            </div>
            <div className="gd-plus">+</div>
            <div className="gd-factor">
              <span>国内溢价</span>
              <span className={signClass(d.premiumContrib)}>{fmtPct(d.premiumContrib)}</span>
            </div>
          </div>

          <div className="gd-snapshot">
            <div className="gd-snap-item"><span>XAU/USD</span><b>${fmt(d.xauUsd)}</b><span className={signClass(d.xauChgPct)}>{fmtPct(d.xauChgPct)}</span></div>
            <div className="gd-snap-item"><span>USD/CNH</span><b>{fmt(d.usdCnh, 4)}</b><span className={signClass(d.cnyChgPct)}>{fmtPct(d.cnyChgPct)}</span></div>
            <div className="gd-snap-item"><span>美元指数 DXY</span><b>{d.dxy != null ? fmt(d.dxy) : '—'}</b><span className={signClass(d.dxyChgPct ?? 0)}>{d.dxyChgPct != null ? fmtPct(d.dxyChgPct) : '—'}</span></div>
          </div>
          <div className="gd-note">
            汇率贡献为正 = 人民币贬值,利多人民币金价。溢价贡献为正 = 国内买盘强于国际。
            数据源: {d.source}
          </div>
        </div>
      )}
    </>
  );
}

// 近期相关动态 —— 背景参考,不参与信号/回测(C3/C4 不受影响)。
// 只是把主题相关新闻摆在你做最终判断时能看到的地方,呼应 reality.md 里 human 那一步。
function NewsPanel({ assetId }: { assetId: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchAssetNews(assetId)
      .then((r) => { if (!cancelled) setItems(r.items); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  return (
    <>
      <div className="section-title">
        📰 近期相关动态
        <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>背景参考,不参与信号计算 · 方向为规则初判</span>
      </div>
      {loading ? (
        <div className="loading">加载新闻中…</div>
      ) : error ? (
        <div className="hint">新闻加载失败(不影响信号)</div>
      ) : items.length === 0 ? (
        <div className="hint">暂无相关新闻</div>
      ) : (
        <ul className="news-list">
          {items.map((n, i) => (
            <li key={i} className="news-item">
              <span className={`news-sentiment news-sent-${n.sentiment}`}>{n.sentiment}</span>
              <a className="news-title" href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
              <span className="news-meta">{n.source} · {n.date.slice(5, 16)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
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
  // winRate 可能为 null 或 NaN(样本不足/数据不足两种情形)——都视为"无统计",只展示 note。
  const winPct = data.winRate == null || Number.isNaN(data.winRate)
    ? null
    : Math.round(data.winRate * 100);
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
