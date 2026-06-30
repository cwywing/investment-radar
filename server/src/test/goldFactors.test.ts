import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignFactors, parseXauJsonp, parseEmKlines, parseComexJson } from '../data/goldFactors.js';
import { goldFactorStrategy } from '../strategies/goldFactor.js';
import type { Asset, Candle } from '../types.js';

// —— alignFactors 纯函数 ——
function mkCandle(date: string, close: number): Candle {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

test('alignFactors: 前向填充 + 溢价计算正确', () => {
  const candles = [
    mkCandle('2024-01-02', 480), // au 人民币/克
    mkCandle('2024-01-03', 482),
    mkCandle('2024-01-04', 485),
  ];
  const xau = [
    { date: '2024-01-01', close: 2000 }, // 美元/盎司
    { date: '2024-01-03', close: 2050 },
  ];
  const cnh = [
    { date: '2024-01-02', close: 7.15 },
    { date: '2024-01-04', close: 7.20 },
  ];
  const dxy = [
    { date: '2024-01-02', close: 101.5 },
  ];
  const out = alignFactors(candles, xau, cnh, dxy);

  // 2024-01-02: xau floor=2000(1/1), cnh=7.15, dxy=101.5
  // 隐含 = 2000*7.15/31.1035 = 459.78; 溢价 = 480 - 459.78 = 20.22
  assert.equal(out[0].xau, 2000);
  assert.equal(out[0].cnh, 7.15);
  assert.equal(out[0].dxy, 101.5);
  assert.ok(Math.abs(out[0].premium! - 20.22) < 0.1, `溢价应≈20.22, 实际 ${out[0].premium}`);

  // 2024-01-03: xau=2050(当天有), cnh floor=7.15(2号), dxy=101.5
  assert.equal(out[1].xau, 2050);
  assert.equal(out[1].cnh, 7.15); // 前向填充,3号没有cnh,用2号
  assert.equal(out[1].dxy, 101.5);
  // 隐含 = 2050*7.15/31.1035 = 471.30; 溢价 = 482 - 471.30 = 10.70
  assert.ok(Math.abs(out[1].premium! - 10.70) < 0.1, `溢价应≈10.70, 实际 ${out[1].premium}`);

  // 2024-01-04: xau=2050(前向), cnh=7.20(当天), dxy=101.5(前向)
  assert.equal(out[2].xau, 2050);
  assert.equal(out[2].cnh, 7.20);
  assert.equal(out[2].dxy, 101.5);
});

test('alignFactors: 缺 xau 或 cnh 的日期不加因子(整根跳过)', () => {
  const candles = [
    mkCandle('2023-01-01', 400), // 早于所有因子源 → 无 floor
    mkCandle('2024-01-02', 480),
  ];
  const xau = [{ date: '2024-01-01', close: 2000 }];
  const cnh = [{ date: '2024-01-02', close: 7.15 }];
  const out = alignFactors(candles, xau, cnh, []);
  assert.equal(out[0].xau, undefined, '无 xau floor 不应填充');
  assert.equal(out[0].cnh, undefined);
  assert.equal(out[0].premium, undefined);
  assert.equal(out[1].xau, 2000);
});

test('parseXauJsonp / parseEmKlines: 解析 + 过滤非法', () => {
  const jsonp = 'var_XAU([{"date":"2024-01-01","open":"2050","high":"2060","low":"2040","close":"2055","volume":"0","position":"0","s":"0"},{"date":"2024-01-02","close":"bad"}])';
  const xau = parseXauJsonp(jsonp);
  assert.equal(xau.length, 1, 'bad close 应被过滤');
  assert.equal(xau[0].date, '2024-01-01');
  assert.equal(xau[0].close, 2055);

  const em = parseEmKlines({ data: { klines: ['2024-01-01,7.12,7.13,7.14,7.11,0', 'bad,line'] } });
  assert.equal(em.length, 1);
  assert.equal(em[0].close, 7.13);

  assert.deepEqual(parseEmKlines({}), []);
  assert.deepEqual(parseXauJsonp('nope'), []);
});

test('parseComexJson: 解析东财 COMEX 库存返回 + 过滤非法', () => {
  const json = {
    result: {
      data: [
        { REPORT_DATE: '2026-06-25 00:00:00', STORAGE_TON: 860.86 },
        { REPORT_DATE: '2026-06-24 00:00:00', STORAGE_TON: '864.98' },
        { REPORT_DATE: '2026-06-23 00:00:00', STORAGE_TON: null },
        { REPORT_DATE: 'bad', STORAGE_TON: 100 },
        { REPORT_DATE: '2026-06-22 00:00:00', STORAGE_TON: 'not-a-number' },
      ],
    },
  };
  const out = parseComexJson(json);
  assert.equal(out.length, 2, 'null/非法日期/非法数值应被过滤');
  assert.equal(out[0].date, '2026-06-25');
  assert.equal(out[0].close, 860.86);
  assert.equal(out[1].date, '2026-06-24');
  assert.equal(out[1].close, 864.98);
  assert.deepEqual(parseComexJson({}), []);
  assert.deepEqual(parseComexJson({ result: { data: [] } }), []);
});

test('alignFactors: comex 前向填充到 au 交易日', () => {
  const candles = [
    mkCandle('2024-01-02', 480),
    mkCandle('2024-01-03', 482),
    mkCandle('2024-01-04', 485),
  ];
  const xau = [{ date: '2024-01-01', close: 2000 }];
  const cnh = [{ date: '2024-01-02', close: 7.15 }];
  const comex = [
    { date: '2024-01-02', close: 860 },
    { date: '2024-01-04', close: 855 },
  ];
  const out = alignFactors(candles, xau, cnh, [], comex);
  assert.equal(out[0].comex, 860, '2024-01-02 当天有 comex');
  assert.equal(out[1].comex, 860, '2024-01-03 前向填充 2024-01-02 的 860');
  assert.equal(out[2].comex, 855, '2024-01-04 当天有 comex');
});

test('alignFactors: comex 缺失时该字段为 undefined(不影响其它因子)', () => {
  const candles = [mkCandle('2024-01-02', 480)];
  const xau = [{ date: '2024-01-01', close: 2000 }];
  const cnh = [{ date: '2024-01-02', close: 7.15 }];
  const out = alignFactors(candles, xau, cnh, [], []);
  assert.equal(out[0].comex, undefined, '无 comex 序列应为 undefined');
  assert.equal(out[0].xau, 2000, '其它因子不受影响');
  assert.ok(out[0].premium! > 0);
});

// —— goldFactor 策略 ——
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

function candleWithFactor(date: string, close: number, xau: number, cnh: number, dxy: number, comex?: number): Candle {
  const premium = close - (xau * cnh) / 31.1035;
  return { date, open: close, high: close + 1, low: close - 1, close, volume: 1000, xau, cnh, dxy, premium, comex };
}

function factorAsset(seed = 7): Asset {
  const rnd = lcg(seed);
  const candles: Candle[] = [];
  let p = 480, x = 2000, h = 7.15, d = 101.5;
  for (let i = 0; i < 160; i++) {
    p = p + (rnd() - 0.5) * 4 + Math.sin(i / 9) * 1.2;
    x = x + (rnd() - 0.5) * 15;
    h = h + (rnd() - 0.5) * 0.02;
    d = d + (rnd() - 0.5) * 0.3;
    const cc = Math.round(p * 100) / 100;
    const xx = Math.round(x * 100) / 100;
    const hh = Math.round(h * 10000) / 10000;
    const dd = Math.round(d * 100) / 100;
    candles.push(candleWithFactor(`2024-${String((i % 28) + 1).padStart(2, '0')}-15`, cc, xx, hh, dd));
  }
  return {
    id: 'au9999', name: '黄金', symbol: 'au9999', assetClass: 'metal',
    source: 'eastmoney_gold', secid: '118.au9999',
    seed, basePrice: 480, drift: 0, volatility: 0.1, candles,
  };
}

function noFactorAsset(seed = 7): Asset {
  const rnd = lcg(seed);
  const candles: Candle[] = [];
  let p = 480;
  for (let i = 0; i < 160; i++) {
    p = p + (rnd() - 0.5) * 4 + Math.sin(i / 9) * 1.2;
    const c = Math.round(p * 100) / 100;
    candles.push({ date: `2024-${String((i % 28) + 1).padStart(2, '0')}-15`, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 });
  }
  return {
    id: 'au9999', name: '黄金', symbol: 'au9999', assetClass: 'metal',
    source: 'simulated', seed, basePrice: 480, drift: 0, volatility: 0.1, candles,
  };
}

test('goldFactor: 纯函数确定性 + 动作合法 + 分数范围', () => {
  const a = factorAsset(7);
  const s1 = goldFactorStrategy.evaluate(a);
  const s2 = goldFactorStrategy.evaluate(a);
  assert.equal(s1.score, s2.score, '分数确定性');
  assert.equal(s1.action, s2.action);
  assert.deepEqual(s1.reasons, s2.reasons);
  assert.ok(['buy', 'sell', 'hold'].includes(s1.action));
  assert.ok(s1.score >= -100 && s1.score <= 100);
  // 有因子时必须暴露 XAU / 溢价 指标
  assert.ok('XAU' in s1.indicators, '必须暴露 XAU');
  assert.ok('溢价' in s1.indicators, '必须暴露溢价');
});

test('goldFactor: 无因子时回退 grid(指标无 XAU,理由含回退提示)', () => {
  const a = noFactorAsset(7);
  const s = goldFactorStrategy.evaluate(a);
  assert.ok(!('XAU' in s.indicators), '无因子不应暴露 XAU');
  assert.ok(s.reasons.some((r) => r.includes('回退纯 grid')), '必须有回退提示');
  // 回退到 grid,分数应与 grid 策略一致(同区间位置)
  assert.ok(s.score >= -100 && s.score <= 100);
});

test('goldFactor: grid 与因子同向应加分确认(偏多)', () => {
  // 确认版语义:方向由 grid 定。构造 au 跌到 60 日区间底部(grid buy)+ XAU/CNY 上行(因子 buy)。
  // 两者同向 → 加分确认 → buy。溢价会跌(premScore 负),但 XAU+CNH 占主导,净因子仍为正。
  const candles: Candle[] = [];
  let x = 2000, h = 7.15;
  for (let i = 0; i < 160; i++) {
    x = 2000 + i * 3;        // XAU 稳步上涨(因子 buy)
    h = 7.15 + i * 0.003;    // CNH 贬值(因子 buy)
    // au:前 100 天高位 540,后 60 天跌到 470 → 末尾处于 60 日区间底部 → grid buy(+100)
    const au = i < 100 ? 540 : 540 - (i - 100) * 1.2;
    const c = Math.round(au * 100) / 100;
    candles.push(candleWithFactor(`2024-${String((i % 28) + 1).padStart(2, '0')}-15`, c, Math.round(x * 100) / 100, Math.round(h * 10000) / 10000, 101.5));
  }
  const a: Asset = {
    id: 'au9999', name: '黄金', symbol: 'au9999', assetClass: 'metal',
    source: 'eastmoney_gold', secid: '118.au9999',
    seed: 1, basePrice: 480, drift: 0, volatility: 0.1, candles,
  };
  const s = goldFactorStrategy.evaluate(a);
  assert.ok(s.score > 0, `同向确认应偏多,实际 score=${s.score}`);
  assert.equal(s.action, 'buy');
  assert.ok(s.reasons.some((r) => r.includes('同向')), '理由应含"同向"确认');
});

test('goldFactor: COMEX 库存下降利多,上升利空 → 下降场景分数更高', () => {
  // 干净场景:grid 中性(au 固定) + XAU/CNH/DXY/溢价全平稳(fs 仅由 comex 决定)。
  // 版本A 末尾库存下降(comexScore 正,fs 正 → score 正);
  // 版本B 末尾库存上升(comexScore 负,fs 负 → score 负)。A.score 应 > B.score。
  function build(comexTrend: 'down' | 'up'): Asset {
    const candles: Candle[] = [];
    for (let i = 0; i < 160; i++) {
      const comex = comexTrend === 'down'
        ? 850 - (i - 140) * 2   // 末尾下降
        : 850 + (i - 140) * 2;  // 末尾上升
      candles.push(candleWithFactor(
        `2024-${String((i % 28) + 1).padStart(2, '0')}-15`,
        480, 2000, 7.15, 101.5,
        Math.round(comex * 100) / 100,
      ));
    }
    return {
      id: 'au9999', name: '黄金', symbol: 'au9999', assetClass: 'metal',
      source: 'eastmoney_gold', secid: '118.au9999',
      seed: 1, basePrice: 480, drift: 0, volatility: 0.1, candles,
    };
  }
  const sDown = goldFactorStrategy.evaluate(build('down'));
  const sUp = goldFactorStrategy.evaluate(build('up'));
  assert.ok(sDown.score > sUp.score, `库存下降场景分数应更高,down=${sDown.score} up=${sUp.score}`);
  assert.ok(sDown.score > 0, `库存下降应得正分,down=${sDown.score}`);
  assert.ok(sUp.score < 0, `库存上升应得负分,up=${sUp.score}`);
  assert.ok(sDown.reasons.some((r) => r.includes('COMEX 库存') && r.includes('利多')), '库存下降应提示利多');
  assert.ok(sUp.reasons.some((r) => r.includes('COMEX 库存') && r.includes('利空')), '库存上升应提示利空');
});
