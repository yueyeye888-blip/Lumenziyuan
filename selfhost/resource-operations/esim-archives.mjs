import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export function openEsimArchives(root) {
  const db = new DatabaseSync(path.join(root, 'data', 'site-esim-archive.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS esim_resource_archives (
      user_id TEXT NOT NULL,
      esim_tran_no TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (user_id, esim_tran_no)
    ) WITHOUT ROWID`);

  const select = db.prepare('SELECT esim_tran_no, archived_at FROM esim_resource_archives WHERE user_id=?');
  const archive = db.prepare(`INSERT INTO esim_resource_archives (user_id, esim_tran_no, archived_at)
    VALUES (?,?,?) ON CONFLICT (user_id, esim_tran_no) DO UPDATE SET archived_at=excluded.archived_at`);
  const restore = db.prepare('DELETE FROM esim_resource_archives WHERE user_id=? AND esim_tran_no=?');

  return {
    list(userId) {
      return new Map(select.all(userId).map(row => [row.esim_tran_no, row.archived_at]));
    },
    set(userId, ids, archived) {
      const archivedAt = archived ? new Date().toISOString() : null;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const id of ids) {
          if (archived) archive.run(userId, id, archivedAt);
          else restore.run(userId, id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return archivedAt;
    },
    close() { db.close(); },
  };
}
