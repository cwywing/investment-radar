import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AssetDetail } from '../types';
import { getThemeColors } from '../theme';

// echarts 在 jsdom 无 canvas/SVG 布局,会抛错;mock 成空实现以测纯渲染逻辑
vi.mock('echarts', () => ({
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}));

const { AssetDetail } = await import('../components/AssetDetail');

function makeDetail(over: Partial<AssetDetail>): AssetDetail {
  return {
    id: 'au',
    name: '黄金 9999',
    symbol: 'AU9999',
    assetClass: 'metal',
    candles: [{ date: '2026-06-29', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
    signal: {
      action: 'buy', score: 30, confidence: 0.5,
      reasons: ['MA金叉'], indicators: { MA5: 1.4 },
    },
    ...over,
  };
}

const colors = getThemeColors('dark');

describe('AssetDetail — 回测卡 NaN/样本不足(C4)', () => {
  it('winRate=NaN + sampleInsufficient:显示 note,绝不渲染「NaN%」', () => {
    render(
      <AssetDetail
        detail={makeDetail({
          backtest: { matched: 0, winRate: NaN, avgReturn: null, horizon: 20, note: '历史数据不足,无法回测', sampleInsufficient: true },
        })}
        loading={false}
        error={null}
        colors={colors}
        theme="dark"
      />,
    );
    expect(screen.getByText('历史数据不足,无法回测')).toBeInTheDocument();
    expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
    expect(screen.queryByText(/历史上涨概率/)).not.toBeInTheDocument();
  });

  it('winRate=null:同样只显示 note', () => {
    render(
      <AssetDetail
        detail={makeDetail({
          backtest: { matched: 0, winRate: null, avgReturn: null, horizon: 20, note: '无匹配历史样本' },
        })}
        loading={false}
        error={null}
        colors={colors}
        theme="dark"
      />,
    );
    expect(screen.getByText('无匹配历史样本')).toBeInTheDocument();
    expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
  });

  it('winRate=0.65:渲染 65% 与「历史上涨概率」(买入)', () => {
    render(
      <AssetDetail
        detail={makeDetail({
          backtest: { matched: 12, winRate: 0.65, avgReturn: 2.3, horizon: 20, note: '样本可靠' },
        })}
        loading={false}
        error={null}
        colors={colors}
        theme="dark"
      />,
    );
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('历史上涨概率')).toBeInTheDocument();
    expect(screen.getByText('+2.3%')).toBeInTheDocument();
  });

  it('无 backtest 字段:不渲染回测卡', () => {
    const { container } = render(
      <AssetDetail detail={makeDetail({})} loading={false} error={null} colors={colors} theme="dark" />,
    );
    expect(container.querySelector('.backtest-card')).not.toBeInTheDocument();
  });

  it('C3: matched>=10 且 winRate<0.5:信号卡显示「历史胜率低」警示', () => {
    render(
      <AssetDetail
        detail={makeDetail({
          backtest: { matched: 44, winRate: 0.38, avgReturn: 0.7, horizon: 20, note: '不可靠' },
        })}
        loading={false}
        error={null}
        colors={colors}
        theme="dark"
      />,
    );
    expect(screen.getByText(/历史胜率低\(38%\)/)).toBeInTheDocument();
  });

  it('C3: winRate>=0.5:不显示「历史胜率低」警示', () => {
    render(
      <AssetDetail
        detail={makeDetail({
          backtest: { matched: 368, winRate: 0.62, avgReturn: 0.7, horizon: 20, note: '可靠' },
        })}
        loading={false}
        error={null}
        colors={colors}
        theme="dark"
      />,
    );
    expect(screen.queryByText(/历史胜率低/)).not.toBeInTheDocument();
  });

  it('C3: 小样本(matched<10):不显示「历史胜率低」(避免噪声误判)', () => {
    render(
      <AssetDetail
        detail={makeDetail({
          backtest: { matched: 5, winRate: 0.2, avgReturn: -1, horizon: 20, note: '样本少' },
        })}
        loading={false}
        error={null}
        colors={colors}
        theme="dark"
      />,
    );
    expect(screen.queryByText(/历史胜率低/)).not.toBeInTheDocument();
  });

  it('近期相关动态:mock fetch 返回新闻 → 渲染标题+方向标签(且标注不参与信号)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ assetId: 'au', count: 1, items: [{ title: '测试新闻标题ABC', date: '2026-06-29 10:00:00', url: 'http://x', source: '测试源', sentiment: '利好' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as any;
    try {
      render(
        <AssetDetail detail={makeDetail({})} loading={false} error={null} colors={colors} theme="dark" />,
      );
      expect(await screen.findByText('测试新闻标题ABC')).toBeInTheDocument();
      expect(screen.getByText(/不参与信号计算/)).toBeInTheDocument();
      // 方向标签必须渲染
      expect(screen.getByText('利好')).toBeInTheDocument();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('黄金定价拆解:au9999 详情 + mock /api/gold/drivers → 渲染溢价与三因子', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/gold/drivers')) {
        return new Response(
          JSON.stringify({ drivers: {
            auPrice: 886, auPrevClose: 880, auChgPct: 0.68,
            xauUsd: 4059, xauPrevClose: 4081, xauChgPct: -0.54,
            usdCnh: 6.7988, cnyPrevClose: 6.8045, cnyChgPct: -0.08,
            dxy: 101.29, dxyChgPct: -0.09,
            rmbImplied: 887.24, premium: -1.24, premiumStatus: '正常',
            intlContrib: -0.54, fxContrib: -0.08, premiumContrib: 1.3,
            ts: Date.now(), source: 'test',
          }}),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // news 端点返回空
      return new Response(JSON.stringify({ assetId: 'au9999', count: 0, items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
    try {
      render(
        <AssetDetail detail={makeDetail({ id: 'au9999' })} loading={false} error={null} colors={colors} theme="dark" />,
      );
      expect(await screen.findByText(/黄金定价拆解/)).toBeInTheDocument();
      // 国内溢价值渲染
      expect(screen.getByText(/-1\.24 元\/克/)).toBeInTheDocument();
      // 三因子标签
      expect(screen.getByText('国际金价')).toBeInTheDocument();
      expect(screen.getByText('人民币汇率')).toBeInTheDocument();
      // 国际快照
      expect(screen.getByText('XAU/USD')).toBeInTheDocument();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
