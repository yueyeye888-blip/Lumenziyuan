import { fault } from './wallet.mjs';

const feed = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const scale = 100_000_000n;
const day = 86_400_000;

export function createWarehousePrices({ now = Date.now, fetchImpl = fetch } = {}) {
  let cache, inFlight, nextAttempt = 0;
  async function rates() {
    if (cache && now() < cache.refresh && now()-cache.time < 7*day) return cache;
    if (!inFlight && now() >= nextAttempt) {
      nextAttempt = now()+60_000;
      inFlight = (async () => {
        const response = await fetchImpl(feed,{ signal: AbortSignal.timeout(8000), redirect:'error' });
        if (!response.ok) throw Error('ECB feed unavailable');
        const xml = await response.text();
        const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
        const time = Date.parse(date+'T00:00:00Z');
        if (!Number.isFinite(time) || time>now()+day || now()-time >= 7*day) throw Error('Invalid ECB quote date');
        const values = { EUR: scale };
        for (const match of xml.matchAll(/<Cube\s+currency=['"](USD|CNY|SGD)['"]\s+rate=['"](\d{1,5})(?:\.(\d{1,8}))?['"]/g)) {
          values[match[1]] = BigInt(match[2])*scale+BigInt((match[3]||'').padEnd(8,'0'));
        }
        if (!values.USD) throw Error('USD rate unavailable');
        cache = { date, time, values, refresh:now()+15*60_000 };
      })().finally(()=>{inFlight=null;});
    }
    if (inFlight) await inFlight.catch(()=>{});
    if (!cache || now()-cache.time >= 7*day) throw fault(503,'暂时无法取得外币参考汇率，请稍后刷新。');
    return cache;
  }
  return async function price(cents,currency) {
    if (cents===null || cents===0) return {retailUnitRaw:0,priceLabel:'免费',rateNote:'免费认领'};
    if (!Number.isSafeInteger(cents) || cents<0 || !['USD','EUR','SGD','CNY'].includes(currency)) throw fault(409,'此批次的计价币种或入库价格无效。');
    let raw=BigInt(cents)*200n;
    let rateNote='账户余额支付';
    if (currency!=='USD') {
      const rate=await rates(), denominator=rate.values[currency];
      if (!denominator) throw fault(503,'暂无此币种的参考汇率。');
      raw=(raw*rate.values.USD+denominator/2n)/denominator;
      rateNote=`按 ECB ${rate.date} 参考汇率换算`;
    }
    if (raw<=0n || raw>BigInt(Number.MAX_SAFE_INTEGER)) throw fault(409,'价格超出支持范围。');
    return {retailUnitRaw:Number(raw),priceLabel:(Number(raw)/10000)+' U',rateNote};
  };
}
