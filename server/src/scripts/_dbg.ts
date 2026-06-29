import { last, atr, adx } from '../indicators/index.js';
import { goldFactorStrategy } from '../strategies/goldFactor.js';
import type { Asset, Candle } from '../types.js';
function cf(date:string,close:number,x:number,h:number,d:number):Candle{const p=close-(x*h)/31.1035;return{date,open:close,high:close+1,low:close-1,close,volume:1000,xau:x,cnh:h,dxy:d,premium:p};}
const c:Candle[]=[];let x=2000,h=7.15;
for(let i=0;i<160;i++){x=2000+i*3;h=7.15+i*0.003;const imp=(x*h)/31.1035;c.push(cf(`2024-${String((i%28)+1).padStart(2,'0')}-15`,Math.round(imp*100)/100,Math.round(x*100)/100,Math.round(h*10000)/10000,101.5));}
const a:Asset={id:'au9999',name:'黄金',symbol:'au9999',assetClass:'metal',source:'eastmoney_gold',secid:'118.au9999',seed:1,basePrice:480,drift:0,volatility:0.1,candles:c};
const cl=c.map(z=>z.close),hi=c.map(z=>z.high),lo=c.map(z=>z.low);
console.log('ADX=',last(adx(hi,lo,cl,14)),'ATR=',last(atr(hi,lo,cl,14)),'price=',last(cl));
const s=goldFactorStrategy.evaluate(a);
console.log('score=',s.score,'action=',s.action);
console.log('indicators',JSON.stringify(s.indicators));
console.log('reasons',s.reasons);
