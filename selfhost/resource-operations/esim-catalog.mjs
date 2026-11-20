import { createEsimSupplier } from './esim-supplier.mjs';

const gibibyte = 1024 ** 3;
const freshFor = 60_000;
const usableFor = 10 * 60_000;
const retryDelay = 5000;

function searchText(plan) {
  const networks = (plan.locationNetworkList || []).map(network => [
    network.locationName || '',
    ...(network.operatorList || []).map(operator => operator.operatorName + ' ' + (operator.networkType || '')),
  ].join(' '));
  return [plan.name, plan.description, plan.location, plan.slug, ...networks].join(' ').toLowerCase();
}

function publicItem(plan) {
  const operators = new Map();
  for (const network of plan.locationNetworkList || []) {
    for (const entry of network.operatorList || []) {
      const name = entry.operatorName || '未知运营商';
      const networkType = entry.networkType || '';
      operators.set(name + '-' + networkType, { name, networkType });
    }
  }
  return {
    id:plan.slug || plan.packageCode, packageCode:plan.packageCode, slug:plan.slug,
    name:plan.name, description:plan.description, priceRaw:plan.price, price:plan.price / 10_000,
    currency:plan.currencyCode, volume:plan.volume, duration:plan.duration, durationUnit:plan.durationUnit,
    location:plan.location, speed:plan.speed || null, favoriteOnSupplier:Boolean(plan.favorite),
    countryName:plan.locationNetworkList?.[0]?.locationName || plan.location,
    countryLogo:plan.locationNetworkList?.[0]?.locationLogo || null,
    operators:[...operators.values()],
  };
}

function snapshot(plans, timestamp) {
  if (!Array.isArray(plans)) throw Error('Invalid supplier catalog');
  const byId = new Map();
  const entries = plans.map((plan, index) => {
    const entry = { plan, index };
    for (const id of new Set([plan.slug, plan.packageCode].filter(Boolean))) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(entry);
    }
    return entry;
  });
  return { entries, byId, timestamp };
}

export function createEsimCatalog(bindings, { supplier = createEsimSupplier(bindings), now = Date.now } = {}) {
  let current;
  let pending;
  let retryAt = 0;

  function refresh() {
    if (!pending) {
      pending = Promise.resolve().then(() => supplier.catalog()).then(plans => {
        current = snapshot(plans, now());
        retryAt = 0;
        return current;
      }).catch(error => {
        retryAt = now() + retryDelay;
        throw error;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  }

  async function read() {
    const timestamp = now();
    if (current && timestamp - current.timestamp < usableFor) {
      const stale = timestamp - current.timestamp >= freshFor;
      if (stale && timestamp >= retryAt) void refresh().catch(() => {});
      return { data: current, stale, cache: stale ? 'stale' : 'hit' };
    }
    if (timestamp < retryAt) throw Error('Catalog temporarily unavailable');
    return { data: await refresh(), stale: false, cache: 'refreshed' };
  }

  async function response(params) {
    const limit = Math.min(100, Math.max(1, Math.floor(Number(params.get('limit')) || 100)));
    const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0));
    const ids = (params.get('ids') || '').split(',').map(id => id.trim()).filter(Boolean).slice(0,500);
    if (params.has('ids') && ids.length === 0) {
      return { cache:'empty', body:{ connected:true,total:0,limit,offset,hasMore:false,items:[] } };
    }
    const query = (params.get('q') || '').trim().toLowerCase().slice(0,80);
    const minVolume = Math.max(Number(params.get('minDataGb')) || 0, 0) * gibibyte;
    const maxPrice = Math.max(Number(params.get('maxPrice')) || 0, 0);
    const maxDuration = Math.max(Number(params.get('maxDuration')) || 0, 0);
    const { data, stale, cache } = await read();
    const candidates = ids.length
      ? [...new Set(ids.flatMap(id => data.byId.get(id) || []))].sort((left,right) => left.index - right.index)
      : data.entries;
    const filtered = candidates.filter(entry => {
      const plan = entry.plan;
      if (minVolume && plan.volume < minVolume) return false;
      if (maxPrice && plan.price / 10_000 > maxPrice) return false;
      if (maxDuration && plan.duration > maxDuration) return false;
      return !query || (entry.search ??= searchText(plan)).includes(query);
    });
    return { cache, body:{
      connected:true, total:filtered.length, limit, offset, hasMore:offset+limit<filtered.length,
      items:filtered.slice(offset,offset+limit).map(entry => entry.item ??= publicItem(entry.plan)),
      syncedAt:new Date(data.timestamp).toISOString(), stale,
    } };
  }

  async function route(req,res,url) {
    // Country-filtered queries retain the supplier-specific region behavior of the existing route.
    if (req.method !== 'GET' || url.pathname !== '/api/esim/packages' || url.searchParams.get('location')) return false;
    const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store' };
    try {
      const result = await response(url.searchParams);
      res.writeHead(200, { ...headers, 'x-lumen-catalog-cache':result.cache });
      res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(502,headers);
      res.end(JSON.stringify({ connected:false, error:'供应商目录暂时不可用，请稍后重试。' }));
    }
    return true;
  }

  return { route, response, warm:() => refresh().catch(() => {}) };
}
