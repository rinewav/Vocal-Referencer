/* Library: project tiles in a thumbnail grid. A project = optional reference
   source + optional own vocal, either can land first (button or drag&drop).
   Clicking anywhere on a tile opens it in the compare view. Thumbnails come
   from cover art / video frames / a manual image, falling back to a mini
   waveform. Reference registration auto-runs stem separation per prefs. */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Song, StemRef, SeparateProgress, loadAudioBuffer, computePeaks, audioUrl } from '../lib/audio'
import { finishRefRegistration, registerReference, SilentAudioError } from '../lib/refimport'
import { dragOut } from '../lib/dragout'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'

const hasApi = typeof window !== 'undefined' && !!window.vr

/* mini waveform thumbnail. Peaks are computed once at a fixed resolution and
   cached in the analysis-cache DB (keyed by file path, owned by the song so
   project deletion cleans them up) — decoding every song on every library
   visit was the slow part, not the drawing. */
const PEAKS_W = 280
const peaksKey = (path: string) => `peaks|1|${path}`

function WaveThumb({ path, songId }: { path: string; songId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        let min: number[] | null = null
        let max: number[] | null = null
        const cached = hasApi ? await window.vr!.cache.get(peaksKey(path)) : null
        if (cached) {
          try {
            const d = JSON.parse(cached)
            if (Array.isArray(d.min) && Array.isArray(d.max) && d.min.length === PEAKS_W) {
              min = d.min
              max = d.max
            }
          } catch {
            /* corrupt cache row — recompute below */
          }
        }
        if (!min || !max) {
          const buf = await loadAudioBuffer(path)
          if (canceled) return
          const peaks = computePeaks(buf, PEAKS_W)
          const r = (v: number) => Math.round(v * 100) / 100
          min = Array.from(peaks.min, r)
          max = Array.from(peaks.max, r)
          if (hasApi) void window.vr!.cache.set(peaksKey(path), songId, JSON.stringify({ min, max }))
        }
        if (canceled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const W = canvas.clientWidth
        const H = canvas.clientHeight
        canvas.width = W * dpr
        canvas.height = H * dpr
        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)
        const mid = H / 2
        ctx.fillStyle = 'oklch(0.70 0.13 255 / 0.75)' // accent-ish blue on the tile
        for (let x = 0; x < W; x++) {
          const i = Math.min(PEAKS_W - 1, Math.floor((x / W) * PEAKS_W))
          const yLo = mid + min[i] * (mid - 3)
          const yHi = mid + max[i] * (mid - 3)
          ctx.fillRect(x, yHi, 1, Math.max(1, yLo - yHi))
        }
      } catch {
        if (!canceled) setFailed(true)
      }
    })()
    return () => {
      canceled = true
    }
  }, [path, songId])

  if (failed) {
    return (
      <div className="row" style={{ height: '100%', justifyContent: 'center' }}>
        <Icon name="note" style={{ width: 26, height: 26, color: 'var(--text-lo)' }} />
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

/* thumbnail image loaded over the vr-audio protocol via fetch → blob URL —
   <img src="vr-audio://…"> is blocked as a subresource (non-standard scheme),
   which showed up as a broken-image icon. Falls back to the waveform. */
function ThumbImage({ thumb, fallbackPath, songId }: { thumb: string; fallbackPath: string | null; songId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let canceled = false
    let obj: string | null = null
    setUrl(null)
    setFailed(false)
    ;(async () => {
      try {
        const res = await fetch(audioUrl(thumb))
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        if (canceled) return
        obj = URL.createObjectURL(blob)
        setUrl(obj)
      } catch {
        if (!canceled) setFailed(true)
      }
    })()
    return () => {
      canceled = true
      if (obj) URL.revokeObjectURL(obj)
    }
  }, [thumb])

  if (failed && fallbackPath) return <WaveThumb path={fallbackPath} songId={songId} />
  if (failed || !url) {
    return (
      <div className="row" style={{ height: '100%', justifyContent: 'center' }}>
        {failed && <Icon name="note" style={{ width: 26, height: 26, color: 'var(--text-lo)' }} />}
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  )
}

function TitleEditor({
  song,
  editing,
  setEditing,
  onRenamed
}: {
  song: Song
  editing: boolean
  setEditing: (b: boolean) => void
  onRenamed: () => void
}) {
  const [value, setValue] = useState(song.title)

  if (!editing) {
    return (
      <span
        style={{ display: 'block', minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={song.title}
      >
        {song.title}
      </span>
    )
  }
  const commit = async () => {
    setEditing(false)
    if (value.trim() && value.trim() !== song.title) {
      await window.vr!.library.rename(song.id, value.trim())
      onRenamed()
    }
  }
  return (
    <input
      className="cv-input"
      autoFocus
      style={{ height: 26, fontSize: 13, width: '100%' }}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // IME 変換確定の Enter (isComposing / keyCode 229) では commit しない
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

/* icon-only tile action with hover title */
function TileButton({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      className="cv-toolbtn"
      title={title}
      style={{ width: 26, height: 26 }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Icon name={icon} style={{ width: 14, height: 14 }} />
    </button>
  )
}

/* one draggable row inside the "drag into your DAW" stem box. Single, uniform
   look (wave icon + name + drag-out hint) — no chip pill, no per-kind color, so
   the box reads as a calm list rather than a scatter of buttons. Own takes get
   a two-step delete (arm → confirm) so extra bounces can be pruned. */
function StemRow({ stem, onDelete, deleteArmed }: { stem: StemRef; onDelete?: () => void; deleteArmed?: boolean }) {
  useLang()
  return (
    <div
      className="cv-group-row"
      draggable
      title={tr('lib.dragOut')}
      style={{ cursor: 'grab', gap: 10, padding: '8px 12px' }}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragOut([stem.path])
      }}
    >
      <Icon name="wave" className="ic-sm" style={{ color: 'var(--text-lo)', flex: 'none' }} />
      <span style={{ fontSize: 12.5, color: 'var(--text-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tr('stem.' + stem.kind)}
        {stem.label ? ` · ${stem.label}` : ''}
      </span>
      <Icon name="download" className="ic-sm" style={{ marginLeft: 'auto', color: 'var(--text-faint)', flex: 'none' }} />
      {onDelete && (
        <button
          className="cv-toolbtn"
          title={deleteArmed ? tr('lib.removeTakeConfirm') : tr('lib.removeTake')}
          style={{ width: 22, height: 22, flex: 'none', color: deleteArmed ? 'var(--lab-red)' : 'var(--text-faint)' }}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Icon name="x" style={{ width: 12, height: 12 }} />
        </button>
      )}
    </div>
  )
}

/* ref / own status line inside a tile */
function SourceRow({
  color,
  label,
  value,
  actionTitle,
  onAction
}: {
  color: string
  label: string
  value: string | null
  actionTitle: string
  onAction: () => void
}) {
  return (
    <div className="row gap6" style={{ fontSize: 11.5, minWidth: 0 }}>
      <span className="dot" style={{ background: color, width: 7, height: 7 }} />
      <span style={{ color: 'var(--text-lo)', flex: 'none' }}>{label}</span>
      <span
        style={{
          color: value ? 'var(--text-mid)' : 'var(--text-faint)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {value ?? tr('lib.notSet')}
      </span>
      <span style={{ marginLeft: 'auto' }}>
        <TileButton icon={value ? 'refresh' : 'plus'} title={actionTitle} onClick={onAction} />
      </span>
    </div>
  )
}

export function LibraryView({
  songs,
  reload,
  onOpen
}: {
  songs: Song[]
  reload: () => void
  onOpen: (song: Song) => void
}) {
  useLang()
  const [progress, setProgress] = useState<Record<string, SeparateProgress>>({})
  /* drag-over target + which half of the tile (top = reference, bottom = own) */
  const [tileDrop, setTileDrop] = useState<{ id: string; zone: 'ref' | 'own' } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /* two-step delete arm for own-take rows */
  const [stemArmId, setStemArmId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortByName, setSortByName] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; songId: string } | null>(null)
  /* soft delete: the tile disappears immediately, the actual removal runs
     after a grace period so the toast's undo can cancel it */
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([])
  const [deleteToast, setDeleteToast] = useState<{ songId: string; title: string } | null>(null)
  const deleteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /* per-project import errors (e.g. video with an undecodable audio track) */
  const [importErrors, setImportErrors] = useState<Record<string, string>>({})

  const reportImportError = (songId: string, err: unknown) => {
    const msg = err instanceof SilentAudioError ? tr('lib.err.silentVideo') : err instanceof Error ? err.message : String(err)
    setImportErrors((prev) => ({ ...prev, [songId]: msg }))
  }
  const clearImportError = (songId: string) =>
    setImportErrors((prev) => {
      const next = { ...prev }
      delete next[songId]
      return next
    })

  /* progress bars only — reload / karaoke chaining / notifications run at the
     App level so they also fire while the compare view is open */
  useEffect(() => {
    if (!hasApi) return
    return window.vr!.separate.onProgress((p: unknown) => {
      const prog = p as SeparateProgress
      setProgress((prev) => ({ ...prev, [prog.songId]: prog }))
    })
  }, [])

  useEffect(() => {
    if (!stemArmId) return
    const t = setTimeout(() => setStemArmId(null), 2500)
    return () => clearTimeout(t)
  }, [stemArmId])

  /* close the tile context menu on any outside interaction */
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const scheduleDelete = (song: Song) => {
    if (deleteTimers.current[song.id]) return
    setPendingDeletes((p) => [...p, song.id])
    setDeleteToast({ songId: song.id, title: song.title })
    deleteTimers.current[song.id] = setTimeout(() => {
      delete deleteTimers.current[song.id]
      void window.vr!.library.remove(song.id).then(reload)
      setPendingDeletes((p) => p.filter((id) => id !== song.id))
      setDeleteToast((t) => (t?.songId === song.id ? null : t))
    }, 5000)
  }

  const undoDelete = (songId: string) => {
    const t = deleteTimers.current[songId]
    if (t) {
      clearTimeout(t)
      delete deleteTimers.current[songId]
    }
    setPendingDeletes((p) => p.filter((id) => id !== songId))
    setDeleteToast((cur) => (cur?.songId === songId ? null : cur))
  }

  /* leaving the view ends the grace period — flush pending deletes for real */
  useEffect(
    () => () => {
      const ids = Object.keys(deleteTimers.current)
      for (const id of ids) {
        clearTimeout(deleteTimers.current[id])
        void window.vr?.library.remove(id)
      }
      deleteTimers.current = {}
      if (ids.length) reload()
    },
    // reload is a stable useCallback in App — this runs once on unmount
    [reload]
  )

  const addFiles = async (paths: string[]) => {
    for (const p of paths) {
      const song = (await window.vr!.library.add(p)) as Song
      reload()
      try {
        await finishRefRegistration(song.id, song.src_path)
      } catch (err) {
        reportImportError(song.id, err)
      }
    }
    reload()
  }

  const dropPaths = (e: React.DragEvent): string[] =>
    Array.from(e.dataTransfer.files)
      .map((f) => window.vr!.pathForFile(f))
      .filter(Boolean)

  const newProject = async () => {
    await window.vr!.library.create()
    reload()
  }

  const setRef = async (songId: string, path?: string) => {
    let p = path
    if (!p) {
      const picked = await window.vr!.pickAudio(false)
      p = picked?.[0]
    }
    if (!p) return
    clearImportError(songId)
    try {
      await registerReference(songId, p)
    } catch (err) {
      reportImportError(songId, err)
    }
    reload()
  }

  const addOwn = async (songId: string, path?: string) => {
    let p = path
    if (!p) {
      const picked = await window.vr!.pickAudio(false)
      p = picked?.[0]
    }
    if (p) {
      await window.vr!.library.addOwn(songId, p)
      reload()
    }
  }

  const pickThumb = async (songId: string) => {
    const img = await window.vr!.pickImage()
    if (img) {
      await window.vr!.library.setThumbFile(songId, img)
      reload()
    }
  }

  const pickAndAdd = async () => {
    const picked = await window.vr!.pickAudio(true)
    if (picked?.length) await addFiles(picked)
  }

  /* grid contents: pending deletes hidden, then search filter, then sort */
  const shownSongs = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = songs.filter((s) => !pendingDeletes.includes(s.id))
    if (q) list = list.filter((s) => s.title.toLowerCase().includes(q))
    if (sortByName) list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ja'))
    return list
  }, [songs, pendingDeletes, query, sortByName])

  return (
    <div
      className="col gap12 grow"
      style={{ padding: '14px 16px', overflowY: 'auto', minHeight: 0 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const paths = dropPaths(e)
        if (paths.length) addFiles(paths)
      }}
    >
      <div className="row gap10" style={{ flexWrap: 'wrap', animation: 'view-in .3s ease both' }}>
        <button className="btn primary" data-tut="new-project" onClick={newProject}>
          <Icon name="plus" className="ic-sm" />
          {tr('lib.newProject')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{tr('lib.dropHint')}</span>
        {songs.length > 0 && (
          <span className="row gap6" style={{ marginLeft: 'auto' }}>
            <input
              className="cv-input"
              placeholder={tr('lib.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ height: 30, width: 190, fontSize: 12.5 }}
            />
            <button className={'chip' + (!sortByName ? ' on' : '')} onClick={() => setSortByName(false)}>
              {tr('lib.sortNew')}
            </button>
            <button className={'chip' + (sortByName ? ' on' : '')} onClick={() => setSortByName(true)}>
              {tr('lib.sortName')}
            </button>
          </span>
        )}
      </div>

      {songs.length === 0 && (
        <div
          className="ph grow"
          data-tut="tiles"
          onClick={pickAndAdd}
          style={{ borderRadius: 'var(--r-lg)', minHeight: 220, animation: 'view-in .3s ease both', animationDelay: '60ms', cursor: 'pointer' }}
        >
          <div className="col gap12" style={{ alignItems: 'center' }}>
            <Icon name="note" style={{ width: 28, height: 28, color: 'var(--text-lo)' }} />
            <span className="ph-cap">{tr('app.emptyLibrary')}</span>
            <span className="ph-cap" style={{ color: 'var(--text-lo)' }}>{tr('lib.emptyAction')}</span>
          </div>
        </div>
      )}

      <div
        data-tut={songs.length > 0 ? 'tiles' : undefined}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}
      >
        {shownSongs.map((song, i) => {
          const prog = progress[song.id]
          const busy = prog && (prog.stage === 'separating' || prog.stage === 'model-download')
          const hasVocals = song.stems.some((s) => s.kind === 'vocals')
          const hasLead = song.stems.some((s) => s.kind === 'lead')
          const ownStems = song.stems.filter((s) => s.kind === 'own')
          const hasRef = !!song.src_path
          return (
            <div
              key={song.id}
              className="cv-tile col"
              style={{
                animation: 'view-in .3s ease both',
                animationDelay: `${60 + Math.min(i, 8) * 55}ms`,
                cursor: 'pointer',
                position: 'relative'
              }}
              onClick={() => onOpen(song)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ x: e.clientX, y: e.clientY, songId: song.id })
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault()
                  e.stopPropagation()
                  // 上半分 = リファレンス、下半分 = 自分のボーカル
                  const r = e.currentTarget.getBoundingClientRect()
                  const zone = e.clientY < r.top + r.height / 2 ? 'ref' : 'own'
                  setTileDrop((cur) => (cur?.id === song.id && cur.zone === zone ? cur : { id: song.id, zone }))
                }
              }}
              onDragLeave={() => setTileDrop((cur) => (cur?.id === song.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const zone = tileDrop?.id === song.id ? tileDrop.zone : hasRef ? 'own' : 'ref'
                setTileDrop(null)
                const paths = dropPaths(e)
                if (paths[0]) {
                  if (zone === 'ref') setRef(song.id, paths[0])
                  else addOwn(song.id, paths[0])
                }
              }}
            >
              {/* drop-zone overlay: shows where the file will land before release */}
              {tileDrop?.id === song.id && (
                <div
                  className="col"
                  style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', animation: 'fade-in .1s' }}
                >
                  {(['ref', 'own'] as const).map((z) => (
                    <div
                      key={z}
                      className="row grow"
                      style={{
                        justifyContent: 'center',
                        background: tileDrop.zone === z ? 'var(--accent-dim)' : 'rgba(6,7,9,.55)',
                        outline: tileDrop.zone === z ? '2px solid var(--accent-line)' : 'none',
                        outlineOffset: -2
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: tileDrop.zone === z ? 'var(--accent-hi)' : 'var(--text-mid)',
                          background: 'rgba(6,7,9,.6)',
                          padding: '4px 10px',
                          borderRadius: 7
                        }}
                      >
                        {z === 'ref' ? (hasRef ? tr('lib.replaceRef') : tr('lib.dropRefZone')) : tr('lib.dropOwnZone')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* thumbnail: image (cover art / video frame / manual) or waveform */}
              <div
                draggable={hasRef}
                title={song.src_path || undefined}
                style={{
                  height: 96,
                  position: 'relative',
                  cursor: hasRef ? 'grab' : 'pointer',
                  background:
                    'radial-gradient(420px 200px at 80% -30%, oklch(0.30 0.06 var(--accent-h) / 0.35), transparent 70%), var(--bg-canvas-2)'
                }}
                onDragStart={(e) => {
                  e.preventDefault()
                  if (hasRef) dragOut([song.src_path])
                }}
              >
                {/* visible drag-out handle (Covo board pattern) */}
                {hasRef && (
                  <div
                    draggable
                    title={tr('lib.dragOut')}
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      dragOut([song.src_path])
                    }}
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      zIndex: 2,
                      width: 26,
                      height: 24,
                      borderRadius: 7,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--accent)',
                      color: 'oklch(0.16 0.02 255)',
                      boxShadow: '0 1px 5px rgba(0,0,0,.5)',
                      cursor: 'grab'
                    }}
                  >
                    <Icon name="download" style={{ width: 14, height: 14 }} />
                  </div>
                )}
                {song.thumb ? (
                  <ThumbImage thumb={song.thumb} fallbackPath={hasRef ? song.src_path : null} songId={song.id} />
                ) : hasRef ? (
                  <WaveThumb path={song.src_path} songId={song.id} />
                ) : (
                  <div className="row" style={{ height: '100%', justifyContent: 'center' }}>
                    <Icon name="plus" style={{ width: 22, height: 22, color: 'var(--text-faint)' }} />
                  </div>
                )}
              </div>

              <div className="col gap8" style={{ padding: '10px 12px 12px' }}>
                <div className="row gap6" style={{ minWidth: 0 }}>
                  <div className="grow" style={{ minWidth: 0 }} onClick={(e) => editingId === song.id && e.stopPropagation()}>
                    <TitleEditor
                      song={song}
                      editing={editingId === song.id}
                      setEditing={(b) => setEditingId(b ? song.id : null)}
                      onRenamed={reload}
                    />
                  </div>
                  <TileButton icon="pencil" title={tr('lib.rename')} onClick={() => setEditingId(song.id)} />
                  <TileButton icon="image" title={tr('lib.thumb')} onClick={() => pickThumb(song.id)} />
                  <TileButton icon="x" title={tr('lib.delete')} onClick={() => scheduleDelete(song)} />
                </div>

                <SourceRow
                  color="var(--lab-blue)"
                  label={tr('lib.ref')}
                  value={hasRef ? song.src_path.split('/').pop()! : null}
                  actionTitle={hasRef ? tr('lib.replaceRef') : tr('lib.setRef')}
                  onAction={() => setRef(song.id)}
                />
                <SourceRow
                  color="var(--lab-pink)"
                  label={tr('lib.own')}
                  value={ownStems.length > 0 ? (ownStems[ownStems.length - 1].label ?? `${ownStems.length}`) : null}
                  actionTitle={tr('lib.addOwn')}
                  onAction={() => addOwn(song.id)}
                />

                {busy && (
                  <div className="col gap4">
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-mid)' }}>
                      <span>
                        {tr('lib.stage.' + prog.stage)}
                        {prog.preset === 'karaoke' ? ` · ${tr('lib.separateKaraoke')}` : ''}
                      </span>
                      <span className="mono">{prog.pct}%</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${prog.pct}%`, background: 'var(--accent)', transition: 'width .3s' }} />
                    </div>
                  </div>
                )}
                {prog?.stage === 'error' && (
                  <span style={{ fontSize: 11.5, color: 'var(--lab-red)' }}>
                    {tr('lib.stage.error')}: {(() => {
                      const k = 'lib.err.' + prog.error
                      const t = tr(k)
                      return t === k ? prog.error : t
                    })()}
                  </span>
                )}
                {importErrors[song.id] && (
                  <span style={{ fontSize: 11.5, color: 'var(--lab-red)' }}>{importErrors[song.id]}</span>
                )}

                {song.stems.length > 0 && (
                  <div className="cv-group" style={{ marginTop: 2 }}>
                    <div className="cv-group-head row gap8" style={{ alignItems: 'center' }}>
                      <Icon name="download" className="ic-sm" style={{ color: 'var(--text-lo)' }} />
                      {tr('lib.stemsBox')}
                    </div>
                    {song.stems.map((s) => (
                      <StemRow
                        key={s.id}
                        stem={s}
                        deleteArmed={stemArmId === s.id}
                        onDelete={
                          s.kind === 'own'
                            ? () => {
                                if (stemArmId === s.id) {
                                  setStemArmId(null)
                                  void window.vr!.library.removeOwnStem(s.id).then(reload)
                                } else setStemArmId(s.id)
                              }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}

                <div className="row gap6" style={{ flexWrap: 'wrap' }}>
                  {!busy && hasRef && !hasVocals && (
                    <button
                      className="btn"
                      style={{ height: 28, fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.vr!.separate.start(song.id, 'vocal')
                      }}
                    >
                      <Icon name="bolt" className="ic-sm" />
                      {tr('lib.separate')}
                    </button>
                  )}
                  {!busy && hasVocals && !hasLead && (
                    <button
                      className="btn ghost"
                      style={{ height: 28, fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.vr!.separate.start(song.id, 'karaoke')
                      }}
                    >
                      <Icon name="bolt" className="ic-sm" />
                      {tr('lib.separateKaraoke')}
                    </button>
                  )}
                  <button
                    className="btn primary"
                    style={{ height: 28, fontSize: 12, marginLeft: 'auto' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(song)
                    }}
                  >
                    <Icon name="compare" className="ic-sm" />
                    {tr('lib.open')}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {songs.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{tr('lib.stemDragHint')}</span>
      )}

      {/* tile context menu */}
      {menu &&
        (() => {
          const song = songs.find((s) => s.id === menu.songId)
          if (!song) return null
          const W = 210
          const x = Math.min(menu.x, window.innerWidth - W - 8)
          const y = Math.min(menu.y, window.innerHeight - 200)
          return (
            <div
              className="glass cv-menu"
              style={{ position: 'fixed', left: x, top: y, zIndex: 300, width: W, boxShadow: 'var(--shadow-pop)', animation: 'pop-in .12s ease' }}
              onMouseDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button className="cv-menu-item" onClick={() => { setMenu(null); onOpen(song) }}>
                <Icon name="compare" className="ic-sm" />
                {tr('lib.open')}
              </button>
              <button className="cv-menu-item" onClick={() => { setMenu(null); setEditingId(song.id) }}>
                <Icon name="pencil" className="ic-sm" />
                {tr('lib.rename')}
              </button>
              <button className="cv-menu-item" onClick={() => { setMenu(null); void pickThumb(song.id) }}>
                <Icon name="image" className="ic-sm" />
                {tr('lib.thumb')}
              </button>
              {!!song.src_path && (
                <button className="cv-menu-item" onClick={() => { setMenu(null); void window.vr!.reveal(song.src_path) }}>
                  <Icon name="folder" className="ic-sm" />
                  {tr('lib.reveal')}
                </button>
              )}
              <div className="cv-menu-sep" />
              <button
                className="cv-menu-item"
                style={{ color: 'var(--lab-red)' }}
                onClick={() => { setMenu(null); scheduleDelete(song) }}
              >
                <Icon name="x" className="ic-sm" />
                {tr('lib.delete')}
              </button>
            </div>
          )
        })()}

      {/* undo toast for the pending delete */}
      {deleteToast && (
        <div className="cv-toast-wrap">
          <div className="glass cv-toast">
            <span style={{ color: 'var(--text-mid)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {deleteToast.title} — {tr('lib.deleted')}
            </span>
            <button
              className="btn ghost"
              style={{ height: 26, fontSize: 12.5, color: 'var(--accent-hi)' }}
              onClick={() => undoDelete(deleteToast.songId)}
            >
              {tr('lib.undo')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
