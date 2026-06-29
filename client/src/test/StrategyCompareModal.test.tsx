import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';

const overviewRows = [
  { id: 'grid', name: '网格区间', desc: '高抛低吸', suitable: '震荡', action: 'buy' as const, score: 88, confidence: 0.88, topReason: '区间 6% 分位', matched: 368, winRate: 0.62, avgReturn: 0.7, lowConfidence: false },
  { id: 'goldFactor', name: '黄金多因子(确认)', desc: 'grid 定方向+因子确认', suitable: '黄金', action: 'buy' as const, score: 62, confidence: 0.62, topReason: '同向确认', matched: 232, winRate: 0.70, avgReturn: 1.2, lowConfidence: false },
  { id: 'trend', name: '趋势跟踪', desc: 'EMA+MACD', suitable: '趋势', action: 'sell' as const, score: -85, confidence: 0.85, topReason: '均线空头', matched: 482, winRate: 0.45, avgReturn: 0.1, lowConfidence: true },
];

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StrategyCompareModal', () => {
  it('加载并渲染策略对比表,含信号徽章+胜率+可靠性', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ asset: { id: 'au9999', name: '黄金 9999', symbol: 'AU9999' }, rows: overviewRows }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { StrategyCompareModal } = await import('../components/StrategyCompareModal');
    const onClose = vi.fn();
    render(<StrategyCompareModal assetId="au9999" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('网格区间')).toBeInTheDocument());
    // 信号徽章带分数
    expect(screen.getByText(/买入 \+88/)).toBeInTheDocument();
    expect(screen.getByText(/卖出 -85/)).toBeInTheDocument();
    // 胜率
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    // 可靠性标签(两个策略≥60% 都是"可靠")
    expect(screen.getAllByText('可靠').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('不可靠')).toBeInTheDocument(); // trend lowconf
    // 调用了 overview 接口
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/assets/au9999/overview'));
  });

  it('点击遮罩或 ESC 关闭', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ asset: { id: 'au9999', name: '黄金', symbol: 'AU' }, rows: overviewRows }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { StrategyCompareModal } = await import('../components/StrategyCompareModal');
    const onClose = vi.fn();
    const { container } = render(<StrategyCompareModal assetId="au9999" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('网格区间')).toBeInTheDocument());
    // 点遮罩关闭
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('接口失败显示错误提示', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    const { StrategyCompareModal } = await import('../components/StrategyCompareModal');
    render(<StrategyCompareModal assetId="au9999" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('加载策略概览失败')).toBeInTheDocument());
  });
});
