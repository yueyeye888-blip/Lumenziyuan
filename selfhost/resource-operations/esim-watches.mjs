import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

// Observations belong to the eSIM itself. An authorized owner and the operator
// see the same group, and the expiry reminder uses that same state.
export function openEsimWatches(root) {
  const db = new DatabaseSync(path.join(root, 'data', 'site-esim-watch.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS esim_resource_watches (
      esim_tran_no TEXT PRIMARY KEY NOT NULL,
      watched_at TEXT NOT NULL
    ) WITHOUT ROWID`);

  const select = db.prepare('SELECT esim_tran_no, watched_at FROM esim_resource_watches');
  const contains = db.prepare('SELECT 1 FROM esim_resource_watches WHERE esim_tran_no=?');
  const revision = db.prepare('SELECT watched_at FROM esim_resource_watches WHERE esim_tran_no=?');
  const watch = db.prepare(`INSERT INTO esim_resource_watches (esim_tran_no, watched_at)
    VALUES (?,?) ON CONFLICT (esim_tran_no) DO UPDATE SET watched_at=excluded.watched_at`);
  const remove = db.prepare('DELETE FROM esim_resource_watches WHERE esim_tran_no=?');
  const removeRevision = db.prepare('DELETE FROM esim_resource_watches WHERE esim_tran_no=? AND watched_at=?');
  let lastWatchTime = 0;

  return {
    list() {
      return new Map(select.all().map(row => [row.esim_tran_no, row.watched_at]));
    },
    has(id) {
      return Boolean(contains.get(id));
    },
    get(id) {
      return revision.get(id)?.watched_at ?? null;
    },
    removeIfWatchedAt(id, watchedAt) {
      return typeof watchedAt === 'string' && removeRevision.run(id, watchedAt).changes === 1;
    },
    set(ids, watching) {
      if (watching) lastWatchTime = Math.max(Date.now(),lastWatchTime + 1);
      const watchedAt = watching ? new Date(lastWatchTime).toISOString() : null;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const id of ids) {
          if (watching) watch.run(id, watchedAt);
          else remove.run(id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return watchedAt;
    },
    close() { db.close(); },
  };
}
