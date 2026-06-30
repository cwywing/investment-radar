import type { AssetRadarItem } from '../types';
import { SignalBadge } from './SignalBadge';

interface Props {
  items: AssetRadarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const CLASS_LABEL: Record<string, string> = {
  fund: '基金',
  metal: '贵金属',
};

export function AssetList({ items, activeId, onSelect }: Props) {
  // 按信号强度排序:买入(高分在前) -> 观望 -> 卖出(低分在后)
  const sorted = [...items].sort((a, b) => b.signal.score - a.signal.score);

  return (
    <div className="signal-list">
      {sorted.map((item) => {
        const chgClass = item.changePct >= 0 ? 'up' : 'down';
        const simulated = item.loaded === 'simulated';
        const proxy = !simulated && item.proxyNote;
        const stale = item.stale && !simulated; // 模拟已标红,过期只对真实数据额外提示
        // 有盘中快照时,主价显示快照价(更实时),并标注估值/实时
        const live = item.intraday;
        const showPrice = live ? live.price : item.price;
        const showChg = live ? live.changePct : item.changePct;
        const chgClassLive = showChg >= 0 ? 'up' : 'down';
        return (
          <div
            key={item.id}
            className={`signal-row ${activeId === item.id ? 'active' : ''} ${simulated ? 'simulated' : ''} ${proxy ? 'proxy' : ''} ${stale ? 'stale' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <SignalBadge action={item.signal.action} score={item.signal.score} />
            <div style={{ minWidth: 0 }}>
              <div className="name">
                {item.name}{' '}
                <span className="sym">{item.symbol} · {CLASS_LABEL[item.assetClass]}</span>
                {simulated && <span className="sim-tag" title="真实数据拉取失败,当前为模拟数据,信号不可信">模拟</span>}
                {proxy && <span className="proxy-tag" title={`真实行情接口不可用,当前用近似数据源: ${item.proxyNote}`}>近似</span>}
                {stale && <span className="stale-tag" title="最新行情日期已过期,数据源可能异常">过期</span>}
                {item.lowConfidence && (
                  <span className="lowconf-tag" title="该信号历史回测胜率低于50%,历史上十次错超五次,谨慎参考">低置信</span>
                )}
              </div>
              <div className="reason">{item.signal.reasons[0]}</div>
            </div>
            <div className="price">
              {showPrice}
              <div className={`chg ${chgClassLive}`}>
                {showChg >= 0 ? '+' : ''}{showChg}%
              </div>
              {live && (
                <div className={`live-tag ${live.isEstimate ? 'est' : 'rt'}`}>
                  {live.isEstimate ? '盘中估值' : '实时'}
                </div>
              )}
              {!live && (
                <div className={`chg ${chgClass}`}>
                  收盘 {item.changePct >= 0 ? '+' : ''}{item.changePct}%
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
