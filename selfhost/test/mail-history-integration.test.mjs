import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEsimMailLog } from '../resource-operations/esim-mail-log.mjs';

test('mail log migration keeps historical times and ownership, and records actual future outcomes', () => {
  const root = mkdtempSync(join(tmpdir(),'lumen-mail-history-'));
  let log;
  try {
    mkdirSync(join(root,'data'));
    const db = new DatabaseSync(join(root,'data','site-esim-mail.sqlite'));
    db.exec(`CREATE TABLE esim_mail (
      user_id TEXT NOT NULL, request_id TEXT NOT NULL, account TEXT NOT NULL, recipient TEXT NOT NULL,
      selection_hash TEXT NOT NULL, item_count INTEGER NOT NULL, qr_count INTEGER NOT NULL,
      status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, PRIMARY KEY (user_id, request_id)
    )`);
    db.prepare('INSERT INTO esim_mail VALUES (?,?,?,?,?,?,?,?,?,?)').run('owner','old','owner@example.invalid','recipient@example.invalid','digest',1,1,'accepted',null,'2026-11-26T05:01:02Z');
    db.close();

    const owner = {id:'owner',email:'owner@example.invalid'};
    const other = {id:'other',email:'other@example.invalid'};
    log = openEsimMailLog(root);
    const previous = log.list(owner,false)[0];
    assert.equal(previous.createdAt,'2026-11-26T05:01:02Z');
    assert.equal(previous.updatedAt,null);
    const key = log.sendKey(owner,'new','recipient@example.invalid',new Set(['fake-esim']));
    log.begin(key,1,1);
    assert.equal(log.list(owner,false).find(row=>row.id==='owner:new').updatedAt,null);
    log.finish(key,{status:'accepted'});
    const current = log.list(owner,false).find(row=>row.id==='owner:new');
    assert.equal(current.delivery.code,'accepted');
    assert.ok(Date.parse(current.updatedAt)>=Date.parse(current.createdAt));
    assert.deepEqual(log.list(other,false),[]);
    assert.equal(log.list(other,true).length,2);
    log.close();
    log = openEsimMailLog(root);
    assert.equal(log.list(owner,false).find(row=>row.id==='owner:new').updatedAt,current.updatedAt);
  } finally {
    log?.close();
    rmSync(root,{recursive:true,force:true});
  }
});
