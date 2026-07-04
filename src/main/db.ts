/* Library database (better-sqlite3, userData/library.db).
   songs — reference tracks added by the user (original file copied in).
   stems — separated outputs + the user's own vocal bounces, keyed to a song. */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

export type StemKind = 'vocals' | 'instrumental' | 'lead' | 'backing' | 'own'

export interface SongRow {
  id: string
  title: string
  artist: string | null
  src_path: string
  duration: number | null
  tags: string // JSON array
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
      src_path TEXT NOT NULL,
      duration REAL,
      tags TEXT NOT NULL DEFAULT '[]',
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
  `)
  return db
}

export function libraryRoot(): string {
  return join(app.getPath('userData'), 'library')
}
