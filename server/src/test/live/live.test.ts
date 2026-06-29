// 联网 eval case(e11/e12)——默认 `npm test` 不跑(需网络),用 `npm run test:live` 单独跑。
// 失败即真实信号:要么数据源全挂(回退模拟),要么端点异常,要么超 latency budget。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { refreshAsset, getAssetSource } from '../../data/dataProvider.js';
import { router } from '../../routes/assets.js';
import { ASSET_CONFIGS } from '../../data/assets.js';
import { timedAsync, assertWithinBudget } from '../util/budget.js';

const LIVE_ASSETS = ['au9999', 'fund-csi300']; // 一金一基金,代表两类源

// e11 —— 真实数据源可达:主源或备源之一成功,usedProvider 落到真实源(非 simulated)。
test('e11 联网:真实黄金/基金数据源可达,不回退模拟', async () => {
  for (const id of LIVE_ASSETS) {
    const { ms } = await timedAsync(() => refreshAsset(id));
    assertWithinBudget(`e11 ${id} refresh`, ms, 30_000);

    const src = getAssetSource(id);
    if (!src) throw new Error(`${id} 应有 source 记录(可能未加载)`);
    assert.ok(
      src.loaded === 'csv' || src.loaded === 'real',
      `${id} 应加载真实数据,实际 loaded=${src.loaded}(可能数据源全挂)`,
    );
    assert.ok(src.usedProvider, `${id} 应有 usedProvider,实际=${src.usedProvider}`);
  }
});

// e12 —— /api/assets 端到端:起真实 HTTP 服务,200 + 数量一致 + 每个 item 合法 signal。
test('e12 联网:/api/assets 端到端 200 + 全标的合法信号', async () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', router);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;

  try {
    const { result: res, ms } = await timedAsync(() =>
      fetch(`http://localhost:${port}/api/assets`),
    );
    assertWithinBudget('e12 /api/assets', ms, 30_000);
    assert.equal(res.status, 200, `HTTP ${res.status}`);

    const body = (await res.json()) as { items: { id: string; signal: { action: string } }[] };
    const items = Array.isArray(body) ? body : body.items;
    assert.equal(items.length, ASSET_CONFIGS.length, 'items 数量与配置一致');
    for (const it of items) {
      assert.ok(
        ['buy', 'sell', 'hold'].includes(it.signal.action),
        `${it.id} signal.action 合法`,
      );
    }
  } finally {
    server.close();
  }
});
