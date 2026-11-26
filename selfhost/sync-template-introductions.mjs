import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const officialCatalog = 'https://addrs.xyz/template-library/catalog-public.json';
const source = process.argv[2];
async function download() {
  const response = await fetch(officialCatalog, { redirect:'error', signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('Catalog returned HTTP ' + response.status);
  return response.json();
}
const catalog = source ? JSON.parse(await readFile(source, 'utf8')) : await download();
if (!Array.isArray(catalog.items) || !catalog.items.length || catalog.items.length !== catalog.totalTemplates ||
    !catalog.items.every(row => Number.isSafeInteger(row?.publicId) && row.publicId > 0 && row.displayName) ||
    new Set(catalog.items.map(row=>row.publicId)).size !== catalog.items.length ||
    !catalog.items.some(row=>typeof row.summary === 'string' && row.summary.trim())) {
  throw Error('Invalid official template catalog');
}
const directory = fileURLToPath(new URL('./data/',import.meta.url));
const dest = path.join(directory, 'supplier-template-introductions.json');
const temp = dest + '.' + randomUUID();
await mkdir(directory,{recursive:true});
try {
  await writeFile(temp, JSON.stringify({items:catalog.items}),{flag:'wx'});
  await rename(temp,dest);
} finally {
  await rm(temp,{force:true});
}
console.log('Saved official introductions for ' + catalog.items.length + ' templates.');
