/** The phone's own copy of what the app works on, so a site visit carries
 *  on with no signal (see lib/offline/store for how screens use it).
 *
 *  `rows` mirrors server rows — projects, drawings, inspections, zones,
 *  observations — as JSON, with the columns the screens look them up by.
 *  A row changed on the phone and not yet uploaded carries `_pending`, and
 *  a refresh from the server never overwrites it. Fields starting with `_`
 *  stay on the phone; they are never sent.
 *
 *  `outbox` is the queue of changes waiting to go up (lib/offline/sync),
 *  `files` the photos and recordings saved here first (lib/offline/files). */

import * as SQLite from 'expo-sqlite'

export type Table = 'projects' | 'drawings' | 'inspections' | 'zones' | 'observations'

let opening: Promise<SQLite.SQLiteDatabase> | null = null

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) opening = open()
  return opening
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const d = await SQLite.openDatabaseAsync('siteiq-offline.db')
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rows (
      tbl TEXT NOT NULL, id TEXT NOT NULL,
      project_id TEXT, parent_id TEXT,
      data TEXT NOT NULL,
      PRIMARY KEY (tbl, id)
    );
    CREATE INDEX IF NOT EXISTS rows_project ON rows (tbl, project_id);
    CREATE INDEX IF NOT EXISTS rows_parent  ON rows (tbl, parent_id);
    CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT, kind TEXT NOT NULL, target TEXT NOT NULL,
      inspection_id TEXT, payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS files (
      local TEXT PRIMARY KEY, remote TEXT NOT NULL, kind TEXT NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      uploaded_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS files_remote ON files (remote);
    CREATE TABLE IF NOT EXISTS offline_projects (
      project_id TEXT PRIMARY KEY, owner TEXT,
      downloaded_at INTEGER, bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transcribe_jobs (
      observation_id TEXT NOT NULL, audio TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (observation_id, audio)
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  // Columns added since the first offline build; already there is fine.
  for (const sql of [
    "ALTER TABLE files ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE files ADD COLUMN last_error TEXT",
  ]) await d.execAsync(sql).catch(() => {})
  return d
}

/** What a row is looked up by: its project, and the row it hangs off. */
function keys(tbl: Table, row: any): { project: string | null; parent: string | null } {
  switch (tbl) {
    case 'projects':     return { project: row.id, parent: null }
    case 'drawings':     return { project: row.project_id ?? null, parent: null }
    case 'inspections':  return { project: row.project_id ?? null, parent: null }
    case 'zones':        return { project: row.project_id ?? null, parent: row.drawing_id ?? null }
    case 'observations': return { project: row.project_id ?? null, parent: row.inspection_id ?? null }
  }
}

export async function putRow(tbl: Table, row: any): Promise<void> {
  const d = await db()
  const { project, parent } = keys(tbl, row)
  await d.runAsync(
    'INSERT OR REPLACE INTO rows (tbl, id, project_id, parent_id, data) VALUES (?, ?, ?, ?, ?)',
    tbl, row.id, project, parent, JSON.stringify(row))
}

export async function getRow<T = any>(tbl: Table, id: string): Promise<T | null> {
  const d = await db()
  const r = await d.getFirstAsync<{ data: string }>('SELECT data FROM rows WHERE tbl = ? AND id = ?', tbl, id)
  return r ? JSON.parse(r.data) : null
}

export async function getRows<T = any>(tbl: Table, by: { project?: string; parent?: string } = {}): Promise<T[]> {
  const d = await db()
  let sql = 'SELECT data FROM rows WHERE tbl = ?'
  const args: string[] = [tbl]
  if (by.project) { sql += ' AND project_id = ?'; args.push(by.project) }
  if (by.parent)  { sql += ' AND parent_id = ?'; args.push(by.parent) }
  const rs = await d.getAllAsync<{ data: string }>(sql, ...args)
  return rs.map(r => JSON.parse(r.data))
}

export async function deleteRow(tbl: Table, id: string): Promise<void> {
  const d = await db()
  await d.runAsync('DELETE FROM rows WHERE tbl = ? AND id = ?', tbl, id)
}

/** Takes the server's rows for one scope (e.g. a project's drawings) as the
 *  truth: they replace what's here, and rows here that the server no longer
 *  has go — except ones changed on the phone and still waiting to upload. */
export async function replaceRows(tbl: Table, existing: any[], fresh: any[]): Promise<void> {
  const d = await db()
  const freshIds = new Set(fresh.map(r => r.id))
  const pending = new Set(existing.filter(r => r._pending).map(r => r.id))
  await d.withTransactionAsync(async () => {
    for (const old of existing) {
      if (!freshIds.has(old.id) && !pending.has(old.id)) {
        await d.runAsync('DELETE FROM rows WHERE tbl = ? AND id = ?', tbl, old.id)
      }
    }
    for (const row of fresh) {
      if (pending.has(row.id)) continue
      const { project, parent } = keys(tbl, row)
      await d.runAsync(
        'INSERT OR REPLACE INTO rows (tbl, id, project_id, parent_id, data) VALUES (?, ?, ?, ?, ?)',
        tbl, row.id, project, parent, JSON.stringify(row))
    }
  })
}

export async function getMeta<T = any>(key: string): Promise<T | null> {
  const d = await db()
  const r = await d.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
  return r ? JSON.parse(r.value) : null
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const d = await db()
  await d.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, JSON.stringify(value))
}

/** A row as the server should see it: the phone-only `_` fields removed. */
export function serverFields<T extends Record<string, any>>(row: T): Partial<T> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) out[k] = v
  return out as Partial<T>
}

/** Forgets everything cached for the previous account (sign-out / a
 *  different account signing in). The queue is kept: it belongs to whoever
 *  made it and only uploads while they're signed in (lib/offline/sync). */
export async function clearCache(): Promise<void> {
  const d = await db()
  await d.execAsync("DELETE FROM rows; DELETE FROM meta WHERE key NOT LIKE 'device:%';")
}
