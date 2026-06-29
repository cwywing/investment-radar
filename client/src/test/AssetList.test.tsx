import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AssetList } from '../components/AssetList';
import type { AssetRadarItem } from '../types';

function makeItem(over: Partial<AssetRadarItem>): AssetRadarItem {
  return {
    id: 'x',
    name: '测试标的',
    symbol: 'TEST',
    assetClass: 'fund',
    price: 1.5,
    changePct: 0.3,
    signal: { action: 'buy', score: 30, confidence: 0.5, reasons: ['理由A'], indicators: {} },
    loaded: 'real',
    stale: false,
    ...over,
  };
}

describe('AssetList — C1/C2 标签 + 盘中快照', () => {
  it('C1: loaded=simulated 时行带 simulated 类与「模拟」标签', () => {
    const { container } = render(
      <AssetList items={[makeItem({ id: 'sim', loaded: 'simulated' })]} activeId={null} onSelect={() => {}} />,
    );
    const row = container.querySelector('.signal-row') as HTMLElement;
    expect(row.className).toContain('simulated');
    expect(within(row).getByText('模拟')).toBeInTheDocument();
  });

  it('C2: 真实数据 + stale 时行带 stale 类与「过期」标签', () => {
    const { container } = render(
      <AssetList items={[makeItem({ id: 'stl', loaded: 'real', stale: true })]} activeId={null} onSelect={() => {}} />,
    );
    const row = container.querySelector('.signal-row') as HTMLElement;
    expect(row.className).toContain('stale');
    expect(within(row).getByText('过期')).toBeInTheDocument();
    // 模拟已标红时不再叠加过期
    expect(row.className).not.toContain('simulated');
  });

  it('真实且未过期:无模拟/过期标签', () => {
    const { container } = render(
      <AssetList items={[makeItem({ id: 'ok', loaded: 'real', stale: false })]} activeId={null} onSelect={() => {}} />,
    );
    const row = container.querySelector('.signal-row') as HTMLElement;
    expect(row.className).not.toContain('simulated');
    expect(row.className).not.toContain('stale');
    expect(screen.queryByText('模拟')).not.toBeInTheDocument();
    expect(screen.queryByText('过期')).not.toBeInTheDocument();
  });

  it('盘中估值(fundgz):显示「盘中估值」标签与快照价', () => {
    const { container } = render(
      <AssetList
        items={[makeItem({
          id: 'gz',
          intraday: { price: 1.62, changePct: 0.8, time: '11:30', source: 'fundgz', isEstimate: true },
        })]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('盘中估值')).toBeInTheDocument();
    expect(screen.queryByText('收盘')).not.toBeInTheDocument();
    expect(container.textContent).toContain('1.62');
  });

  it('实时快照(eastmoney_rt):显示「实时」标签', () => {
    render(
      <AssetList
        items={[makeItem({
          id: 'rt',
          intraday: { price: 888.5, changePct: 0.5, time: '11:30', source: 'eastmoney_rt', isEstimate: false },
        })]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('实时')).toBeInTheDocument();
  });

  it('无盘中快照:显示「收盘」行', () => {
    render(
      <AssetList items={[makeItem({ id: 'close' })]} activeId={null} onSelect={() => {}} />,
    );
    expect(screen.getByText(/收盘/)).toBeInTheDocument();
  });

  it('C3: lowConfidence=true 时显示「低置信」标签', () => {
    render(
      <AssetList items={[makeItem({ id: 'lc', lowConfidence: true })]} activeId={null} onSelect={() => {}} />,
    );
    expect(screen.getByText('低置信')).toBeInTheDocument();
  });

  it('C3: lowConfidence 缺省时不显示「低置信」标签', () => {
    render(
      <AssetList items={[makeItem({ id: 'ok2' })]} activeId={null} onSelect={() => {}} />,
    );
    expect(screen.queryByText('低置信')).not.toBeInTheDocument();
  });
});
