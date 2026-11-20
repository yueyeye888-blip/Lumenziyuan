import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { worker } from './runtime.mjs';

const root = process.cwd();
const marker = 'data/initialized.json';
if (existsSync(marker)) throw Error('Existing initialization marker. No changes were made.');
const config = JSON.parse(readFileSync('config/runtime.json','utf8'));
mkdirSync('data',{recursive:true,mode:0o700});
const mf = worker(root,config,null);
try {
  const db = await mf.getD1Database('DB');
  const previous = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' LIMIT 1").first();
  if (previous) throw Error('Existing database tables detected. No migrations were run.');
  const migrations = readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort();
  const statements = migrations.flatMap(file=>readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean));
  await db.batch(statements.map(sql=>db.prepare(sql)));
  writeFileSync(marker,JSON.stringify({initializedAt:new Date().toISOString(),migrations}),{flag:'wx',mode:0o600});
  console.log('Database initialized.');
} finally { await mf.dispose(); }
