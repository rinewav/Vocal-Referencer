/* Library: reference tiles in a thumbnail grid. Each tile = one reference
   song. The thumbnail (mini waveform) drags out to a DAW; dropping audio
   onto a tile attaches it as the user's own vocal. Title is click-to-rename,
   delete is a two-step confirm. */
import React, { useEffect, useRef, useState } from 'react'
import { Song, StemRef, SeparateProgress, loadAudioBuffer, computePeaks } from '../lib/audio'
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

function TitleEditor({ song, onRenamed }: { song: Song; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(song.title)

  if (!editing) {
    return (
      <span
        style={{ fontSize: 13.5, fontWeight: 600, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={song.title}
        onClick={() => {
          setValue(song.title)
          setEditing(true)
        }}
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

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  useLang()
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 2500)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      className="chip"
      style={arming ? { background: 'oklch(0.70 0.15 25 / 0.2)', borderColor: 'oklch(0.70 0.15 25 / 0.5)', color: 'var(--lab-red)' } : undefined}
      onClick={() => (arming ? onDelete() : setArming(true))}
    >
      {arming ? tr('lib.deleteConfirm') : tr('lib.delete')}
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
      onDragStart={(e) => {
        e.preventDefault()
        window.vr!.dragStart([stem.path])
      }}
    >
      <Icon name="wave" className="ic-sm" style={{ width: 11, height: 11 }} />
      {tr('stem.' + stem.kind)}
      {stem.label ? ` · ${stem.label}` : ''}
    </span>
  )
}

export function LibraryView({
  songs,
  reload,
  onCompare
}: {
  songs: Song[]
  reload: () => void
  onCompare: (song: Song) => void
}) {
  useLang()
  const [progress, setProgress] = useState<Record<string, SeparateProgress>>({})
  const [tileDropId, setTileDropId] = useState<string | null>(null)

  useEffect(() => {
    if (!hasApi) return
    return window.vr!.separate.onProgress((p: unknown) => {
      const prog = p as SeparateProgress
      setProgress((prev) => ({ ...prev, [prog.songId]: prog }))
      if (prog.stage === 'done') reload()
    })
  }, [reload])

  const addFiles = async (paths: string[]) => {
    for (const p of paths) await window.vr!.library.add(p)
    reload()
  }

  const dropPaths = (e: React.DragEvent): string[] =>
    Array.from(e.dataTransfer.files)
      .map((f) => window.vr!.pathForFile(f))
      .filter(Boolean)

  const pickAndAdd = async () => {
    const paths = await window.vr!.pickAudio(true)
    if (paths) addFiles(paths)
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
        <button className="btn primary" onClick={pickAndAdd}>
          <Icon name="plus" className="ic-sm" />
          {tr('lib.add')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{tr('lib.dropHint')}</span>
      </div>

      {songs.length === 0 && (
        <div className="ph grow" style={{ borderRadius: 'var(--r-lg)', minHeight: 220, animation: 'view-in .3s ease both', animationDelay: '60ms' }}>
          <div className="col gap12" style={{ alignItems: 'center' }}>
            <Icon name="note" style={{ width: 28, height: 28, color: 'var(--text-lo)' }} />
            <span className="ph-cap">{tr('app.emptyLibrary')}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {songs.map((song, i) => {
          const prog = progress[song.id]
          const busy = prog && (prog.stage === 'separating' || prog.stage === 'model-download')
          const hasVocals = song.stems.some((s) => s.kind === 'vocals')
          const hasLead = song.stems.some((s) => s.kind === 'lead')
          const hasOwn = song.stems.some((s) => s.kind === 'own')
          return (
            <div
              key={song.id}
              className="cv-tile col"
              style={{
                animation: 'view-in .3s ease both',
                animationDelay: `${60 + Math.min(i, 8) * 55}ms`,
                outline: tileDropId === song.id ? '2px solid var(--accent-line)' : 'none'
              }}
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
                if (paths[0]) addOwn(song.id, paths[0])
              }}
            >
              {/* thumbnail: mini waveform, drags the original out to a DAW */}
              <div
                draggable
                title={song.src_path}
                style={{
                  height: 96,
                  cursor: 'grab',
                  background:
                    'radial-gradient(420px 200px at 80% -30%, oklch(0.30 0.06 var(--accent-h) / 0.35), transparent 70%), var(--bg-canvas-2)'
                }}
                onDragStart={(e) => {
                  e.preventDefault()
                  window.vr!.dragStart([song.src_path])
                }}
              >
                <WaveThumb path={song.src_path} />
              </div>

              <div className="col gap8" style={{ padding: '10px 12px 12px' }}>
                <div className="row gap8" style={{ minWidth: 0 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <TitleEditor song={song} onRenamed={reload} />
                  </div>
                  <DeleteButton
                    onDelete={async () => {
                      await window.vr!.library.remove(song.id)
                      reload()
                    }}
                  />
                </div>

                {busy && (
                  <div className="col gap4">
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-mid)' }}>
                      <span>{tr('lib.stage.' + prog.stage)}</span>
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
                  {!busy && !hasVocals && (
                    <button className="btn" style={{ height: 28, fontSize: 12 }} onClick={() => window.vr!.separate.start(song.id, 'vocal')}>
                      <Icon name="bolt" className="ic-sm" />
                      {tr('lib.separate')}
                    </button>
                  )}
                  {!busy && hasVocals && !hasLead && (
                    <button className="btn ghost" style={{ height: 28, fontSize: 12 }} onClick={() => window.vr!.separate.start(song.id, 'karaoke')}>
                      <Icon name="bolt" className="ic-sm" />
                      {tr('lib.separateKaraoke')}
                    </button>
                  )}
                  <button className="btn ghost" style={{ height: 28, fontSize: 12 }} onClick={() => addOwn(song.id)}>
                    <Icon name="mic" className="ic-sm" />
                    {tr('lib.addOwn')}
                  </button>
                  <button
                    className="btn primary"
                    style={{ height: 28, fontSize: 12, marginLeft: 'auto', opacity: hasVocals && hasOwn ? 1 : 0.4 }}
                    disabled={!(hasVocals && hasOwn)}
                    onClick={() => onCompare(song)}
                  >
                    <Icon name="compare" className="ic-sm" />
                    {tr('lib.compare')}
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
