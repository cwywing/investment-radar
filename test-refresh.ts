import { refreshAsset, getSourceStatus } from './src/data/dataProvider.js';
await refreshAsset('fund-csi300');
await new Promise(r => setTimeout(r, 1000));
const status = getSourceStatus();
for (const s of status) {
  if (s.id.startsWith('fund')) console.log(`${s.id}: loaded=${s.loaded} candles=${s.candles}`);
}
