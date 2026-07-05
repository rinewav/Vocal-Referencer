/* Library database (better-sqlite3, userData/library.db).
   songs — projects: an optional reference source (src_path '' = not set yet),
           an optional thumbnail image, plus attached stems.
   stems — separated outputs + the user's own vocal bounces, keyed to a song.
   analysis_cache — serialized compare-view analysis per ref/own stem pair. */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

export type StemKind = 'vocals' | 'instrumental' | 'lead' | 'backing' | 'own'

export interface SongRow {
  id: string
  title: string
  artist: string | null
  /* copied reference source; '' while the project has no reference yet */
  src_path: string
  duration: number | null
  tags: string // JSON array
  thumb: string | null
  created_at: number
}

export interface StemRow {
  id: string
  song_id: string
  kind: StemKind
  label: string | null
  path: string
  created_at: number
}

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  mkdirSync(app.getPath('userData'), { recursive: true })
  db = new Database(join(app.getPath('userData'), 'library.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT,
      src_path TEXT NOT NULL DEFAULT '',
      duration REAL,
      tags TEXT NOT NULL DEFAULT '[]',
      thumb TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stems (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL REFERENCES songs(id),
      kind TEXT NOT NULL,
      label TEXT,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stems_song ON stems(song_id);
    CREATE TABLE IF NOT EXISTS analysis_cache (
      key TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)
  // pre-thumbnail installs: add the column in place
  const cols = db.prepare('PRAGMA table_info(songs)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'thumb')) db.exec('ALTER TABLE songs ADD COLUMN thumb TEXT')
  return db
}

export function libraryRoot(): string {
  return join(app.getPath('userData'), 'library')
}

export function dbPath(): string {
  return join(app.getPath('userData'), 'library.db')
}

/* release the sqlite handle so the file can be deleted (factory reset) */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
