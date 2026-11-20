import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEsimCatalog } from '../resource-operations/esim-catalog.mjs';

const sample = [
  {slug:'ID_Data',packageCode:'id123',name:'Indonesia Data',location:'ID',description:'Travel',price:12345,
    duration:7,currencyCode:'USD',volume:1024**3*2,locationNetworkList:[{locationName:'Indonesia',
    operatorList:[{operatorName:'Telkomsel',networkType:'5G'},{operatorName:'Telkomsel',networkType:'5G'}]}]},
  {slug:'SG_Data',packageCode:'sg123',name:'Singapore Data',location:'SG',price:22000,duration:7,currencyCode:'USD',volume:1024**3},
  {slug:'CN_Data',packageCode:'cn123',name:'China Data',location:'CN',price:89000,duration:30,currencyCode:'USD',volume:1024**3*4},
];

test('all group lookups share one supplier fetch and keep order, codes, search and paging', async () => {
  let fetches = 0;
  const catalog = createEsimCatalog({}, {supplier:{async catalog(){fetches++; return sample;}}});
  const response = fields => catalog.response(new URLSearchParams(fields));
  assert.equal((await response({ids:''})).body.total,0);
  assert.equal(fetches,0);
  const [first,second,third] = await Promise.all([
    response({ids:'cn123,ID_Data,id123,missing',limit:1}),
    response({ids:'cn123,ID_Data',limit:1,offset:1}),
    response({ids:'id123,sg123',q:'telkomsel 5g',maxPrice:'2',maxDuration:'7',minDataGb:'2'}),
  ]);
  assert.equal(fetches,1);
  assert.equal(first.body.total,2);
  assert.equal(first.body.hasMore,true);
  assert.deepEqual(first.body.items.map(plan=>plan.id),['ID_Data']);
  assert.deepEqual(second.body.items.map(plan=>plan.id),['CN_Data']);
  assert.equal(second.body.hasMore,false);
  assert.deepEqual(third.body.items[0].operators,[{name:'Telkomsel',networkType:'5G'}]);
  assert.equal(third.body.items[0].priceRaw,12345);
  assert.equal(third.body.items[0].price,1.2345);
  assert.equal((await response({ids:'sg123'})).cache,'hit');
  assert.equal(fetches,1);
});

test('expired snapshots refresh in background once, and outage fallback ages out', async () => {
  let timestamp = 10_000;
  let next;
  let calls = 0;
  const catalog=createEsimCatalog({},{now:()=>timestamp,supplier:{catalog(){
    calls++;
    if (calls===1) return Promise.resolve(sample);
    return new Promise((resolve,reject)=>{next={resolve,reject};});
  }}});
  await catalog.warm();
  const params=new URLSearchParams({ids:'ID_Data'});
  timestamp+=60_100;
  const first=await catalog.response(params);
  assert.equal(first.cache,'stale');
  assert.equal(first.body.items[0].priceRaw,12345);
  await catalog.response(params);
  assert.equal(calls,2);
  const refreshed = catalog.warm();
  next.resolve([{...sample[0],price:17100}]);
  await refreshed;
  assert.equal((await catalog.response(params)).body.items[0].priceRaw,17100);
  timestamp+=60_100;
  assert.equal((await catalog.response(params)).cache,'stale');
  const failed=catalog.warm();
  next.reject(Error('upstream unavailable'));
  await failed;
  await catalog.response(params);
  assert.equal(calls,3);
  timestamp+=600_001;
  const expired=assert.rejects(catalog.response(params));
  await Promise.resolve();
  next.reject(Error('upstream unavailable'));
  await expired;
  assert.equal(calls,4);
});
