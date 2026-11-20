import { DatabaseSync } from 'node:sqlite';
import { createWallet } from '../commerce/wallet.mjs';

export function testWallet(initial) {
  const db = new DatabaseSync(':memory:');
  const wallet = createWallet(db);
  for (const [userId,amountRaw] of Object.entries(initial)) {
    wallet.credit({userId,amountRaw,reference:'test:'+userId,note:'Test opening balance'});
  }
  return { ...wallet, close:()=>db.close(),
    count:(state)=>db.prepare('SELECT count(*) AS n FROM wallet_holds WHERE state=?').get(state).n };
}
