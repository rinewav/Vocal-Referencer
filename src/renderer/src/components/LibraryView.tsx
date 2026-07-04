/* Library: song cards with tags, separation controls + progress,
   stem chips draggable out to a DAW, own-vocal attach, jump to compare. */
import React, { useEffect, useState } from 'react'
import { Song, StemRef, SeparateProgress } from '../lib/audio'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'

const hasApi = typeof window !== 'undefined' && !!window.vr

function StemChip({ stem }: { stem: StemRef }) {
  useLang()
  return (
    <span
      className="chip"
      draggable
      title={stem.path}
      style={{ cursor: 'grab' }}
      onDragStart={(e) => {
        e.preventDefault()
        window.vr!.dragStart([stem.path])
      }}
    >
      <Icon name="wave" className="ic-sm" style={{ width: 12, height: 12 }} />
      {tr('stem.' + stem.kind)}
      {stem.label ? ` · ${stem.label}` : ''}
    </span>
  )
}

function TagRow({ song, onChanged }: { song: Song; onChanged: () => void }) {
  useLang()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const tags: string[] = JSON.parse(song.tags || '[]')
  const save = async (next: string[]) => {
    await window.vr!.library.setTags(song.id, next)
    onChanged()
  }
  return (
    <div className="row gap6" style={{ flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <button key={t} className="chip" title="×" onClick={() => save(tags.filter((x) => x !== t))}>
          #{t}
        </button>
      ))}
      {editing ? (
        <input
          className="cv-input"
          autoFocus
          style={{ height: 26, fontSize: 12, width: 110 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              save([...tags, value.trim()])
              setValue('')
              setEditing(false)
            } else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button className="chip" onClick={() => setEditing(true)}>
          <Icon name="plus" className="ic-sm" style={{ width: 11, height: 11 }} />
          {tr('lib.tagAdd')}
        </button>
      )}
    </div>
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

  const pickAndAdd = async () => {
    const paths = await window.vr!.pickAudio(true)
    if (paths) addFiles(paths)
  }

  const addOwn = async (songId: string) => {
    const paths = await window.vr!.pickAudio(false)
    if (paths && paths[0]) {
      await window.vr!.library.addOwn(songId, paths[0])
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
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.vr!.pathForFile(f))
          .filter(Boolean)
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

      {songs.map((song, i) => {
        const prog = progress[song.id]
        const busy = prog && (prog.stage === 'separating' || prog.stage === 'model-download')
        const hasVocals = song.stems.some((s) => s.kind === 'vocals')
        const hasLead = song.stems.some((s) => s.kind === 'lead')
        const hasOwn = song.stems.some((s) => s.kind === 'own')
        return (
          <div
            key={song.id}
            className="card col gap10"
            style={{ padding: 14, animation: 'view-in .3s ease both', animationDelay: `${60 + Math.min(i, 8) * 55}ms` }}
          >
            <div className="row gap10">
              <div className="col" style={{ gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{song.title}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                  {new Date(song.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="row gap8" style={{ marginLeft: 'auto' }}>
                {!busy && !hasVocals && (
                  <button className="btn" onClick={() => window.vr!.separate.start(song.id, 'vocal')}>
                    <Icon name="bolt" className="ic-sm" />
                    {tr('lib.separate')}
                  </button>
                )}
                {!busy && hasVocals && !hasLead && (
                  <button className="btn ghost" onClick={() => window.vr!.separate.start(song.id, 'karaoke')}>
                    <Icon name="bolt" className="ic-sm" />
                    {tr('lib.separateKaraoke')}
                  </button>
                )}
                <button className="btn ghost" onClick={() => addOwn(song.id)}>
                  <Icon name="mic" className="ic-sm" />
                  {tr('lib.addOwn')}
                </button>
                <button
                  className="btn primary"
                  disabled={!(hasVocals && hasOwn)}
                  style={{ opacity: hasVocals && hasOwn ? 1 : 0.4 }}
                  onClick={() => onCompare(song)}
                >
                  <Icon name="compare" className="ic-sm" />
                  {tr('lib.compare')}
                </button>
              </div>
            </div>

            {busy && (
              <div className="col gap6">
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-mid)' }}>
                  <span>{tr('lib.stage.' + prog.stage)}</span>
                  <span className="mono">{prog.pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${prog.pct}%`, background: 'var(--accent)', transition: 'width .3s' }} />
                </div>
              </div>
            )}
            {prog?.stage === 'error' && (
              <span style={{ fontSize: 12, color: 'var(--lab-red)' }}>
                {tr('lib.stage.error')}: {prog.error}
              </span>
            )}

            {song.stems.length > 0 && (
              <div className="row gap6" style={{ flexWrap: 'wrap' }}>
                {song.stems.map((s) => (
                  <StemChip key={s.id} stem={s} />
                ))}
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)', alignSelf: 'center' }}>{tr('lib.stemDragHint')}</span>
              </div>
            )}

            <TagRow song={song} onChanged={reload} />
          </div>
        )
      })}
    </div>
  )
}
