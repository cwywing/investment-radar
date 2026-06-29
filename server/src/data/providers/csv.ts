import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Candle } from '../../types.js';

// CSV 导入:把你导出的净值/K线覆盖进系统。
// 文件位置: server/data/csv/{资产id}.csv
// 支持两种表头:
//   (1) date,open,high,low,close,volume   (黄金/K线类)
//   (2) date,nav                           (基金净值类,自动补齐OHLC=nav)
// 数据按日期升序读取。此文件存在时,优先级高于在线抓取。
const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_DIR = join(__dirname, 'csv');

export function loadCsvCandles(id: string): Candle[] | null {
  const path = join(CSV_DIR, `${id}.csv`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const header = lines[0].toLowerCase().split(',').map((s) => s.trim());
  const di = header.indexOf('date');
  if (di < 0) return null;

  const candles: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const date = (cols[di] || '').trim();
    if (!date) continue;

    let open: number, high: number, low: number, close: number, volume = 0;
    const oi = header.indexOf('open');
    const ci = header.indexOf('close');
    const ni = header.indexOf('nav'); // 净值模式

    if (ni >= 0) {
      // 基金净值模式:nav 作为统一价格
      const nav = num(cols[ni]);
      open = high = low = close = nav;
    } else {
      open = oi >= 0 ? num(cols[oi]) : NaN;
      close = ci >= 0 ? num(cols[ci]) : NaN;
      const hi = header.indexOf('high');
      const li = header.indexOf('low');
      high = hi >= 0 ? num(cols[hi]) : close;
      low = li >= 0 ? num(cols[li]) : close;
      const vi = header.indexOf('volume');
      volume = vi >= 0 ? Math.round(Number(cols[vi]) || 0) : 0;
      // 若只有 close,补齐 open/high/low
      if (Number.isNaN(open)) open = close;
    }
    if (Number.isNaN(close)) continue;
    candles.push({ date, open, high, low, close, volume });
  }
  // 升序
  candles.sort((a, b) => (a.date < b.date ? -1 : 1));
  return candles;
}

function num(s: string): number {
  return Math.round(Number((s || '').trim()) * 10000) / 10000;
}
