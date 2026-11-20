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
    response({ids:'id123,sg123',q:'telkomsel 5g',maxPrice:'2.5',maxDuration:'7',minDataGb:'2'}),
  ]);
  assert.equal(fetches,1);
  assert.equal(first.body.total,2);
  assert.equal(first.body.hasMore,true);
  assert.deepEqual(first.body.items.map(plan=>plan.id),['ID_Data']);
  assert.deepEqual(second.body.items.map(plan=>plan.id),['CN_Data']);
  assert.equal(second.body.hasMore,false);
  assert.deepEqual(third.body.items[0].operators,[{name:'Telkomsel',networkType:'5G'}]);
  assert.equal(third.body.items[0].priceRaw,24690);
  assert.equal((await response({ids:'id123',maxPrice:'2.4'})).body.total,0);
  assert.equal(third.body.items[0].price,2.469);
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
  assert.equal(first.body.items[0].priceRaw,24690);
  await catalog.response(params);
  assert.equal(calls,2);
  const refreshed = catalog.warm();
  next.resolve([{...sample[0],price:17100}]);
  await refreshed;
  assert.equal((await catalog.response(params)).body.items[0].priceRaw,34200);
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

test('cached supplier products are independently priced and filtered per account', async () => {
  let fetches=0;
  const catalog=createEsimCatalog({}, {
    usesSupplier:user=>user?.id==='owner',
    supplier:{async catalog(){fetches++;return [...sample,{...sample[0],slug:'malformed',price:NaN}];}},
  });
  const params=new URLSearchParams({ids:'ID_Data,malformed'});
  const owner={id:'owner'};
  const agent={id:'agent',discountBps:8000};
  const publicUser={id:'public'};
  const [original,discounted,retail]=await Promise.all([owner,agent,publicUser].map(user=>catalog.response(params,user)));
  assert.deepEqual([original,discounted,retail].map(result=>result.body.items.map(plan=>plan.priceRaw)),
    [[12_345],[19_752],[24_690]]);
  const limit=new URLSearchParams({ids:'ID_Data',maxPrice:'2'});
  assert.equal((await catalog.response(limit,owner)).body.total,1);
  assert.equal((await catalog.response(limit,agent)).body.total,1);
  assert.equal((await catalog.response(limit,publicUser)).body.total,0);
  assert.equal(fetches,1);
});

test('comparison filters and sorting apply across the full catalog before pagination', async () => {
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;
  const plans = [
    {...sample[0],durationUnit:'DAY',activeType:2,dataType:1,price:60000},
    {...sample[1],durationUnit:'DAY',activeType:1,dataType:1,price:35000},
    {...sample[2],durationUnit:'DAY',activeType:2,dataType:1,price:76000},
    {slug:'Asia_Daily',packageCode:'Asia-SG-MY',name:'Regional Day Pass',location:'SG, MY, SG',
      price:30000,currencyCode:'USD',volume:500*mb,duration:1,durationUnit:'DAY',activeType:'2',dataType:'2'},
    {slug:'Unlimited_ID',packageCode:'unli789',name:'Unlimited Indonesia',location:'ID',price:12000,
      currencyCode:'USD',volume:0,duration:24,durationUnit:'HOUR',activeType:1,dataType:4},
    {...sample[1],slug:'foreign_currency',location:'MX',currencyCode:'EUR'},
  ];
  const received = [];
  const catalog=createEsimCatalog({}, {supplier:{async catalog(location){received.push(location);return plans;}}});
  const search = fields => catalog.response(new URLSearchParams(fields));
  const onlyRegional = await search({region:'SG',name:'regional',slug:'asia-sg',
    durationDays:'1',activeType:'2',dataType:'2',dataAmount:'500',dataUnit:'MB',facets:'1'});
  assert.deepEqual(onlyRegional.body.items.map(({id,regionCodes,activeType,dataType,durationDays,pricePerGbRaw}) =>
    [id,regionCodes,activeType,dataType,durationDays,pricePerGbRaw]),
    [['Asia_Daily',['SG','MY'],2,2,1,122880]]);
  assert.deepEqual(new Set(onlyRegional.body.facets.regions.map(region=>region.code)),new Set(['CN','ID','SG','MY','MULTI']));
  assert.deepEqual(onlyRegional.body.facets.activeTypes,[1,2]);
  assert.deepEqual(onlyRegional.body.facets.dataTypes,[1,2,4]);

  const alternative = await search({region:'multi',q:'马来西亚'});
  assert.deepEqual(alternative.body.items.map(plan=>plan.id),['Asia_Daily']);
  const first = await search({sort:'unitPrice',direction:'asc',limit:'1'});
  assert.equal(first.body.hasMore,true);
  assert.equal(first.body.total,5);
  assert.deepEqual(first.body.items.map(plan=>plan.id),['CN_Data']);
  const last = await search({sort:'unitPrice',direction:'desc',offset:'4',limit:'1'});
  assert.deepEqual(last.body.items.map(plan=>[plan.id,plan.pricePerGbRaw]),[['Unlimited_ID',null]]);
  assert.equal(last.body.hasMore,false);
  const byData = await search({sort:'data',direction:'desc',dataAmount:'1',dataUnit:'GB'});
  assert.deepEqual(byData.body.items.map(plan=>[plan.id,plan.volume]),[['SG_Data',gb]]);
  assert.equal((await search({sort:'duration',direction:'asc',limit:'1'})).body.items[0].durationDays,1);
  assert.equal(received.length,1);
  assert.equal((await search({location:'SG'})).cache,'location');
  assert.deepEqual(received,[undefined,'SG']);
});

test('favorites lead the default catalog order even when they were beyond the first page', async () => {
  const catalog=createEsimCatalog({}, {supplier:{async catalog(){return sample;}}});
  const search = fields => catalog.response(new URLSearchParams(fields));
  const favorites = 'cn123,SG_Data,unknown';
  const first = await search({favorites,limit:'1'});
  const second = await search({favorites,limit:'1',offset:'1'});
  const third = await search({favorites,limit:'1',offset:'2'});
  assert.deepEqual([first,second,third].map(result => result.body.items[0].id),
    ['SG_Data','CN_Data','ID_Data']);
  const restricted = await search({ids:'ID_Data,CN_Data',favorites,region:'ID'});
  assert.deepEqual(restricted.body.items.map(plan => plan.id), ['ID_Data']);
  const requestedOrder = await search({favorites,sort:'price',direction:'asc'});
  assert.deepEqual(requestedOrder.body.items.map(plan => plan.id), ['ID_Data','SG_Data','CN_Data']);
});
