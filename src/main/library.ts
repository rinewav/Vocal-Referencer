/* Library operations: projects (empty or created from a reference file),
   reference/own registration, thumbnails, analysis cache. Files are copied
   into userData/library/<id>/. */
import { randomUUID } from 'crypto'
import { mkdirSync, copyFileSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { getDb, closeDb, dbPath, libraryRoot, SongRow, StemRow, StemKind } from './db'

export interface SongWithStems extends SongRow {
  stems: StemRow[]
}

export function createProject(title?: string): SongWithStems {
  const db = getDb()
  const id = randomUUID()
  mkdirSync(join(libraryRoot(), id), { recursive: true })
  const row: SongRow = {
    id,
    title: title?.trim() || 'New Project',
    artist: null,
    src_path: '',
    duration: null,
    tags: '[]',
    thumb: null,
    created_at: Date.now()
  }
  db.prepare(
    'INSERT INTO songs (id,title,artist,src_path,duration,tags,thumb,created_at) VALUES (@id,@title,@artist,@src_path,@duration,@tags,@thumb,@created_at)'
  ).run(row)
  return { ...row, stems: [] }
}

/* register/replace the reference source. Replacing invalidates previously
   separated stems (they came from the old file) and the cached analyses. */
export function setReference(songId: string, filePath: string): void {
  const db = getDb()
  const song = getSong(songId)
  if (!song) throw new Error('project not found')
  const dir = join(libraryRoot(), songId)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'original' + extname(filePath).toLowerCase())
  if (song.src_path && song.src_path !== dest && existsSync(song.src_path)) unlinkSync(song.src_path)
  copyFileSync(filePath, dest)
  const separated = db
    .prepare("SELECT * FROM stems WHERE song_id = ? AND kind != 'own'")
    .all(songId) as StemRow[]
  for (const s of separated) {
    if (existsSync(s.path)) try { unlinkSync(s.path) } catch { /* keep going */ }
  }
  db.prepare("DELETE FROM stems WHERE song_id = ? AND kind != 'own'").run(songId)
  db.prepare('DELETE FROM analysis_cache WHERE song_id = ?').run(songId)
  const title = song.title === 'New Project' ? basename(filePath, extname(filePath)) : song.title
  db.prepare('UPDATE songs SET src_path = ?, title = ? WHERE id = ?').run(dest, title, songId)
  // embedded cover art → thumbnail (best effort; video thumbs come from the renderer)
  void extractCoverArt(songId, dest)
}

async function extractCoverArt(songId: string, filePath: string): Promise<void> {
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(filePath, { skipPostHeaders: true })
    const pic = meta.common.picture?.[0]
    if (!pic) return
    const ext = pic.format.includes('png') ? '.png' : '.jpg'
    const thumbPath = join(libraryRoot(), songId, 'thumb' + ext)
    writeFileSync(thumbPath, Buffer.from(pic.data))
    getDb().prepare('UPDATE songs SET thumb = ? WHERE id = ?').run(thumbPath, songId)
  } catch {
    /* no metadata support for this container — waveform fallback remains */
  }
}

export function setThumbFromFile(songId: string, imagePath: string): string {
  const dir = join(libraryRoot(), songId)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'thumb' + extname(imagePath).toLowerCase())
  copyFileSync(imagePath, dest)
  getDb().prepare('UPDATE songs SET thumb = ? WHERE id = ?').run(dest, songId)
  return dest
}

/* PNG data URL from the renderer (video frame capture) */
export function setThumbFromData(songId: string, dataUrl: string): string {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
  if (!m) throw new Error('expected a PNG data URL')
  const dir = join(libraryRoot(), songId)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'thumb.png')
  writeFileSync(dest, Buffer.from(m[1], 'base64'))
  getDb().prepare('UPDATE songs SET thumb = ? WHERE id = ?').run(dest, songId)
  return dest
}

export function cacheGet(key: string): string | null {
  const row = getDb().prepare('SELECT data FROM analysis_cache WHERE key = ?').get(key) as { data: string } | undefined
  return row?.data ?? null
}

export function cacheSet(key: string, songId: string, data: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO analysis_cache (key, song_id, data, created_at) VALUES (?,?,?,?)')
    .run(key, songId, data, Date.now())
}

export function addSong(filePath: string): SongWithStems {
  const project = createProject(basename(filePath, extname(filePath)))
  setReference(project.id, filePath)
  const fresh = getSong(project.id)!
  return { ...fresh, stems: [] }
}

/* video references: the renderer decodes the audio track and sends a WAV so
   analysis and the separation engine always work from plain audio. The
   original video stays only long enough to grab a thumbnail frame. */
export function convertRefToWav(songId: string, wav: Buffer): string {
  const song = getSong(songId)
  if (!song) throw new Error('project not found')
  const dir = join(libraryRoot(), songId)
  const dest = join(dir, 'original.wav')
  writeFileSync(dest, wav)
  if (song.src_path && song.src_path !== dest && existsSync(song.src_path)) {
    try { unlinkSync(song.src_path) } catch { /* leave the video behind */ }
  }
  getDb().prepare('UPDATE songs SET src_path = ? WHERE id = ?').run(dest, songId)
  return dest
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
  db.prepare('DELETE FROM analysis_cache WHERE song_id = ?').run(songId)
  db.prepare('DELETE FROM songs WHERE id = ?').run(songId)
  rmSync(join(libraryRoot(), songId), { recursive: true, force: true })
}

/* factory reset: drop every project, stem and cached analysis, plus the copied
   media under userData/library. Closes the DB first so the file (and its WAL
   sidecars) can be removed; the engine install is left untouched.
   The main DB is deleted first and its error is allowed to propagate — if it's
   locked (e.g. a separation subprocess is mid-write on Windows), the caller
   aborts the relaunch and the user can retry, rather than restarting on top of
   a still-populated library. Sidecars and copied media are best-effort. */
export function resetLibraryData(): void {
  closeDb()
  const db = dbPath()
  rmSync(db, { force: true })
  for (const f of [db + '-wal', db + '-shm', db + '-journal']) {
    try { rmSync(f, { force: true }) } catch { /* sidecar — DB is already gone */ }
  }
  try { rmSync(libraryRoot(), { recursive: true, force: true }) } catch { /* leftover media — harmless orphans */ }
}

export function getSong(songId: string): SongRow | undefined {
  return getDb().prepare('SELECT * FROM songs WHERE id = ?').get(songId) as SongRow | undefined
}

export function songStems(songId: string): StemRow[] {
  return getDb().prepare('SELECT * FROM stems WHERE song_id = ? ORDER BY created_at ASC').all(songId) as StemRow[]
}
