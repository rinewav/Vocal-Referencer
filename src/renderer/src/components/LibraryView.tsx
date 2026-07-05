/* Library: project tiles in a thumbnail grid. A project = optional reference
   source + optional own vocal, either can land first (button or drag&drop).
   Clicking anywhere on a tile opens it in the compare view. Thumbnails come
   from cover art / video frames / a manual image, falling back to a mini
   waveform. Reference registration auto-runs stem separation per prefs. */
import React, { useEffect, useRef, useState } from 'react'
import { Song, StemRef, SeparateProgress, loadAudioBuffer, computePeaks, audioUrl } from '../lib/audio'
import { finishRefRegistration, registerReference, maybeChainKaraoke } from '../lib/refimport'
import { dragOut } from '../lib/dragout'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'

const hasApi = typeof window !== 'undefined' && !!window.vr

/* mini waveform thumbnail, decoded lazily per tile */
function WaveThumb({ path }: { path: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const buf = await loadAudioBuffer(path)
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
        const { min, max } = computePeaks(buf, W)
        const mid = H / 2
        ctx.fillStyle = 'oklch(0.70 0.13 255 / 0.75)' // accent-ish blue on the tile
        for (let x = 0; x < W; x++) {
          const yLo = mid + min[x] * (mid - 3)
          const yHi = mid + max[x] * (mid - 3)
          ctx.fillRect(x, yHi, 1, Math.max(1, yLo - yHi))
        }
      } catch {
        if (!canceled) setFailed(true)
      }
    })()
    return () => {
      canceled = true
    }
  }, [path])

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
function ThumbImage({ thumb, fallbackPath }: { thumb: string; fallbackPath: string | null }) {
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

  if (failed && fallbackPath) return <WaveThumb path={fallbackPath} />
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
        style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
function TileButton({ icon, title, danger, onClick }: { icon: string; title: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className="cv-toolbtn"
      title={title}
      style={{ width: 26, height: 26, ...(danger ? { color: 'var(--lab-red)' } : {}) }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Icon name={icon} style={{ width: 14, height: 14 }} />
    </button>
  )
}

function StemChip({ stem }: { stem: StemRef }) {
  useLang()
  return (
    <span
      className="chip"
      draggable
      title={stem.path}
      style={{ cursor: 'grab', height: 24, fontSize: 11.5 }}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragOut([stem.path])
      }}
    >
      <Icon name="wave" className="ic-sm" style={{ width: 11, height: 11 }} />
      {tr('stem.' + stem.kind)}
      {stem.label ? ` · ${stem.label}` : ''}
    </span>
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
  const [tileDropId, setTileDropId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteArmId, setDeleteArmId] = useState<string | null>(null)

  useEffect(() => {
    if (!hasApi) return
    return window.vr!.separate.onProgress((p: unknown) => {
      const prog = p as SeparateProgress
      setProgress((prev) => ({ ...prev, [prog.songId]: prog }))
      if (prog.stage === 'done') {
        reload()
        void maybeChainKaraoke(prog.songId, prog.preset)
      }
    })
  }, [reload])

  useEffect(() => {
    if (!deleteArmId) return
    const t = setTimeout(() => setDeleteArmId(null), 2500)
    return () => clearTimeout(t)
  }, [deleteArmId])

  const addFiles = async (paths: string[]) => {
    for (const p of paths) {
      const song = (await window.vr!.library.add(p)) as Song
      reload()
      await finishRefRegistration(song.id, song.src_path).catch(() => {})
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
    await registerReference(songId, p).catch(() => {})
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
      <div className="row gap10" style={{ animation: 'view-in .3s ease both' }}>
        <button className="btn primary" data-tut="new-project" onClick={newProject}>
          <Icon name="plus" className="ic-sm" />
          {tr('lib.newProject')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{tr('lib.dropHint')}</span>
      </div>

      {songs.length === 0 && (
        <div className="ph grow" data-tut="tiles" style={{ borderRadius: 'var(--r-lg)', minHeight: 220, animation: 'view-in .3s ease both', animationDelay: '60ms' }}>
          <div className="col gap12" style={{ alignItems: 'center' }}>
            <Icon name="note" style={{ width: 28, height: 28, color: 'var(--text-lo)' }} />
            <span className="ph-cap">{tr('app.emptyLibrary')}</span>
          </div>
        </div>
      )}

      <div
        data-tut={songs.length > 0 ? 'tiles' : undefined}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}
      >
        {songs.map((song, i) => {
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
                outline: tileDropId === song.id ? '2px solid var(--accent-line)' : 'none'
              }}
              onClick={() => onOpen(song)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault()
                  e.stopPropagation()
                  setTileDropId(song.id)
                }
              }}
              onDragLeave={() => setTileDropId((cur) => (cur === song.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setTileDropId(null)
                const paths = dropPaths(e)
                // 空プロジェクトへの最初のドロップ = リファレンス、以後 = 自分のボーカル
                if (paths[0]) hasRef ? addOwn(song.id, paths[0]) : setRef(song.id, paths[0])
              }}
            >
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
                  <ThumbImage thumb={song.thumb} fallbackPath={hasRef ? song.src_path : null} />
                ) : hasRef ? (
                  <WaveThumb path={song.src_path} />
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
                  <TileButton
                    icon="x"
                    title={deleteArmId === song.id ? tr('lib.deleteConfirm') : tr('lib.delete')}
                    danger={deleteArmId === song.id}
                    onClick={async () => {
                      if (deleteArmId === song.id) {
                        await window.vr!.library.remove(song.id)
                        setDeleteArmId(null)
                        reload()
                      } else setDeleteArmId(song.id)
                    }}
                  />
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
                    {tr('lib.stage.error')}: {prog.error}
                  </span>
                )}

                {song.stems.length > 0 && (
                  <div className="row gap4" style={{ flexWrap: 'wrap' }}>
                    {song.stems.map((s) => (
                      <StemChip key={s.id} stem={s} />
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
    </div>
  )
}
