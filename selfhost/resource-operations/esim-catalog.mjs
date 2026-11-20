import { createEsimSupplier } from './esim-supplier.mjs';

import { esimPrice } from '../commerce/pricing.mjs';

const gibibyte = 1024 ** 3;
const mebibyte = 1024 ** 2;
const regionNames = new Intl.DisplayNames(['zh-CN'], {type:'region'});
const regionLabels = { MULTI:'跨国套餐', '!RG':'区域套餐', '!GL':'全球套餐' };
const durationUnits = { DAY:1, HOUR:1 / 24, WEEK:7, MINUTE:1 / 1440 };
const activationTypes = new Set([1,2]);
const volumeTypes = new Set([1,2,3,4]);

const textFilter = (value, max = 80) => String(value || '').trim().toLowerCase().slice(0,max);
function positiveNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function locationCodes(plan) {
  const codes = String(plan.location || '').toUpperCase().split(',')
    .map(code => code.trim()).filter(code => /^[A-Z]{2}$/.test(code) || Object.hasOwn(regionLabels,code));
  return [...new Set(codes)];
}

function locationName(code) {
  return regionLabels[code] ?? regionNames.of(code) ?? code;
}
const freshFor = 60_000;
const usableFor = 10 * 60_000;
const retryDelay = 5000;

function searchText(plan) {
  const networks = (plan.locationNetworkList || []).map(network => [
    network.locationName || '',
    ...(network.operatorList || []).map(operator => operator.operatorName + ' ' + (operator.networkType || '')),
  ].join(' '));
  return [plan.name, plan.description, plan.location, plan.slug, plan.packageCode, ...locationCodes(plan).map(locationName), ...networks].join(' ').toLowerCase();
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
  const regionCodes = locationCodes(plan);
  const activeType = Number(plan.activeType);
  const dataType = Number(plan.dataType);
  const daysPerUnit = durationUnits[String(plan.durationUnit || '').toUpperCase()];
  const duration = positiveNumber(plan.duration);
  return {
    id:plan.slug || plan.packageCode, packageCode:plan.packageCode, slug:plan.slug,
    name:plan.name, description:plan.description,
    currency:plan.currencyCode, volume:plan.volume, duration:plan.duration, durationUnit:plan.durationUnit,
    location:plan.location, speed:plan.speed || null, favoriteOnSupplier:Boolean(plan.favorite),
    countryName:plan.locationNetworkList?.[0]?.locationName || plan.location,
    countryLogo:plan.locationNetworkList?.[0]?.locationLogo || null,
    operators:[...operators.values()],
    regionCodes,
    regionName:regionCodes.length > 1 ? '覆盖 ' + regionCodes.length + ' 个国家或地区'
      : regionCodes.length ? locationName(regionCodes[0]) : plan.locationNetworkList?.[0]?.locationName || null,
    activeType:activationTypes.has(activeType) ? activeType : null,
    dataType:volumeTypes.has(dataType) ? dataType : null,
    durationDays:duration && daysPerUnit ? duration * daysPerUnit : null,
  };
}

function perGbPrice(item, priceRaw) {
  const bytes = positiveNumber(item.volume);
  const daily = item.dataType === 2 || item.dataType === 3;
  if (!bytes || item.dataType === 4 || (daily && !item.durationDays)) return null;
  const raw = Math.round(priceRaw / (bytes / gibibyte * (daily ? item.durationDays : 1)));
  return Number.isSafeInteger(raw) ? raw : null;
}

const sortKeys = {
  price: row => row.priceRaw,
  data: row => row.item.dataType === 4 ? null : positiveNumber(row.item.volume) || null,
  duration: row => row.item.durationDays,
  unitPrice: row => row.pricePerGbRaw,
};

function orderRows(rows, key, descending) {
  if (!Object.hasOwn(sortKeys,key)) return;
  const valueOf = sortKeys[key];
  rows.sort((left,right) => {
    const l = valueOf(left), r = valueOf(right);
    if (l === null || r === null) return Number(l === null) - Number(r === null);
    return descending ? r-l : l-r;
  });
}

function catalogFacets(entries, priceFor) {
  const regions = new Set(), activeTypes = new Set(), dataTypes = new Set();
  for (const entry of entries) {
    if (priceFor(entry.plan) === null) continue;
    const item = entry.item ??= publicItem(entry.plan);
    for (const code of item.regionCodes) regions.add(code);
    if (item.regionCodes.length > 1) regions.add('MULTI');
    if (item.activeType !== null) activeTypes.add(item.activeType);
    if (item.dataType !== null) dataTypes.add(item.dataType);
  }
  return {
    regions:[...regions].map(code => ({code,name:locationName(code)}))
      .sort((left,right) => left.name.localeCompare(right.name,'zh-CN') || left.code.localeCompare(right.code)),
    activeTypes:[...activeTypes].sort((left,right)=>left-right),
    dataTypes:[...dataTypes].sort((left,right)=>left-right),
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

export function createEsimCatalog(bindings, { supplier = createEsimSupplier(bindings), now = Date.now, usesSupplier = () => false } = {}) {
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

  async function response(params,user) {
    const direct = usesSupplier(user);
    const priceFor = plan => plan.currencyCode === 'USD' ? esimPrice(plan.price,user,direct) : null;
    const limit = Math.min(100, Math.max(1, Math.floor(positiveNumber(params.get('limit')) || 100)));
    const offset = Math.floor(positiveNumber(params.get('offset')));
    const ids = (params.get('ids') || '').split(',').map(id => id.trim()).filter(Boolean).slice(0,500);
    const hasIds = params.has('ids');
    const withFacets = params.get('facets') === '1';
    if (hasIds && ids.length === 0 && !withFacets) {
      return { cache:'empty', body:{ connected:true,total:0,limit,offset,hasMore:false,items:[] } };
    }
    const query = textFilter(params.get('q'));
    const name = textFilter(params.get('name'));
    const slug = textFilter(params.get('slug'));
    const minVolume = positiveNumber(params.get('minDataGb')) * gibibyte;
    const maxPrice = positiveNumber(params.get('maxPrice'));
    const maxDuration = positiveNumber(params.get('maxDuration'));
    const duration = positiveNumber(params.get('durationDays'));
    const dataAmount = positiveNumber(params.get('dataAmount'));
    const unit = params.get('dataUnit') === 'MB' ? mebibyte : gibibyte;
    const region = (params.get('region') || '').trim().toUpperCase().slice(0,5);
    const activeType = Number(params.get('activeType'));
    const dataType = Number(params.get('dataType'));
    const location = (params.get('location') || '').trim().toUpperCase().slice(0,3);
    // Keep the supplier-specific location search for older callers. The new region
    // filter uses coverage from the shared snapshot, including multi-country plans.
    const { data, stale, cache } = location
      ? { data:snapshot(await supplier.catalog(location),now()), stale:false, cache:'location' }
      : await read();
    const candidates = hasIds
      ? [...new Set(ids.flatMap(id => data.byId.get(id) || []))].sort((left,right) => left.index - right.index)
      : data.entries;
    const filtered = [];
    for (const entry of candidates) {
      const plan = entry.plan;
      const priceRaw = priceFor(plan);
      if (priceRaw === null || (maxPrice && priceRaw / 10_000 > maxPrice)) continue;
      const item = entry.item ??= publicItem(plan);
      if (region && !(region === 'MULTI' ? item.regionCodes.length > 1 : item.regionCodes.includes(region))) continue;
      if (name && !textFilter(plan.name,1000).includes(name)) continue;
      if (slug && ![plan.slug,plan.packageCode].some(code => textFilter(code,300).includes(slug))) continue;
      if (duration && item.durationDays !== duration) continue;
      if (maxDuration && (item.durationDays ?? plan.duration) > maxDuration) continue;
      if (activeType && item.activeType !== activeType) continue;
      if (dataType && item.dataType !== dataType) continue;
      if (minVolume && plan.volume < minVolume && item.dataType !== 4) continue;
      if (dataAmount && (item.dataType === 4 || plan.volume !== Math.round(dataAmount * unit))) continue;
      if (query && !(entry.search ??= searchText(plan)).includes(query)) continue;
      filtered.push({ item, priceRaw, pricePerGbRaw:perGbPrice(item,priceRaw) });
    }
    orderRows(filtered,params.get('sort'),params.get('direction') === 'desc');
    return { cache, body:{
      connected:true, total:filtered.length, limit, offset, hasMore:offset+limit<filtered.length,
      items:filtered.slice(offset,offset+limit).map(({item,priceRaw,pricePerGbRaw}) => ({
        ...item, priceRaw, price:priceRaw / 10_000, pricePerGbRaw,
      })),
      ...(withFacets ? { facets:catalogFacets(data.entries,priceFor) } : {}),
      syncedAt:new Date(data.timestamp).toISOString(), stale,
    } };
  }

  async function route(req,res,url,user) {
    if (req.method !== 'GET' || url.pathname !== '/api/esim/packages') return false;
    const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store' };
    try {
      const result = await response(url.searchParams,user);
      res.writeHead(200, { ...headers, 'x-lumen-catalog-cache':result.cache });
      const body = user?.role === 'customer' ? {...result.body,
        items:result.body.items.map(({favoriteOnSupplier,...plan})=>plan),
      } : result.body;
      res.end(JSON.stringify(body));
    } catch {
      res.writeHead(502,headers);
      res.end(JSON.stringify({ connected:false, error:'供应商目录暂时不可用，请稍后重试。' }));
    }
    return true;
  }

  return { route, response, warm:() => refresh().catch(() => {}) };
}
