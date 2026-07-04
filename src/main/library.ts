/* Library operations: add songs (copy into userData/library/<id>/),
   attach own-vocal stems, list everything for the renderer. */
import { randomUUID } from 'crypto'
import { mkdirSync, copyFileSync, rmSync } from 'fs'
import { join, extname, basename } from 'path'
import { getDb, libraryRoot, SongRow, StemRow, StemKind } from './db'

export interface SongWithStems extends SongRow {
  stems: StemRow[]
}

export function addSong(filePath: string): SongWithStems {
  const db = getDb()
  const id = randomUUID()
  const dir = join(libraryRoot(), id)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'original' + extname(filePath).toLowerCase())
  copyFileSync(filePath, dest)
  const title = basename(filePath, extname(filePath))
  const row: SongRow = {
    id,
    title,
    artist: null,
    src_path: dest,
    duration: null,
    tags: '[]',
    created_at: Date.now()
  }
  db.prepare(
    'INSERT INTO songs (id,title,artist,src_path,duration,tags,created_at) VALUES (@id,@title,@artist,@src_path,@duration,@tags,@created_at)'
  ).run(row)
  return { ...row, stems: [] }
}

export function addOwnStem(songId: string, filePath: string): StemRow {
  const db = getDb()
  const dir = join(libraryRoot(), songId)
  mkdirSync(dir, { recursive: true })
  const id = randomUUID()
  const dest = join(dir, `own-${id.slice(0, 8)}` + extname(filePath).toLowerCase())
  copyFileSync(filePath, dest)
  const row: StemRow = {
    id,
    song_id: songId,
    kind: 'own',
    label: basename(filePath, extname(filePath)),
    path: dest,
    created_at: Date.now()
  }
  db.prepare(
    'INSERT INTO stems (id,song_id,kind,label,path,created_at) VALUES (@id,@song_id,@kind,@label,@path,@created_at)'
  ).run(row)
  return row
}

export function registerStem(songId: string, kind: StemKind, label: string | null, path: string): StemRow {
  const db = getDb()
  const row: StemRow = {
    id: randomUUID(),
    song_id: songId,
    kind,
    label,
    path,
    created_at: Date.now()
  }
  db.prepare(
    'INSERT INTO stems (id,song_id,kind,label,path,created_at) VALUES (@id,@song_id,@kind,@label,@path,@created_at)'
  ).run(row)
  return row
}

export function listSongs(): SongWithStems[] {
  const db = getDb()
  const songs = db.prepare('SELECT * FROM songs ORDER BY created_at DESC').all() as SongRow[]
  const stemsBySong = new Map<string, StemRow[]>()
  const stems = db.prepare('SELECT * FROM stems ORDER BY created_at ASC').all() as StemRow[]
  for (const s of stems) {
    const list = stemsBySong.get(s.song_id) ?? []
    list.push(s)
    stemsBySong.set(s.song_id, list)
  }
  return songs.map((s) => ({ ...s, stems: stemsBySong.get(s.id) ?? [] }))
}

export function renameSong(songId: string, title: string): void {
  const trimmed = title.trim()
  if (!trimmed) return
  getDb().prepare('UPDATE songs SET title = ? WHERE id = ?').run(trimmed, songId)
}

export function deleteSong(songId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM stems WHERE song_id = ?').run(songId)
  db.prepare('DELETE FROM songs WHERE id = ?').run(songId)
  rmSync(join(libraryRoot(), songId), { recursive: true, force: true })
}

export function getSong(songId: string): SongRow | undefined {
  return getDb().prepare('SELECT * FROM songs WHERE id = ?').get(songId) as SongRow | undefined
}

export function songStems(songId: string): StemRow[] {
  return getDb().prepare('SELECT * FROM stems WHERE song_id = ? ORDER BY created_at ASC').all(songId) as StemRow[]
}
