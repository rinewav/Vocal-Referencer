import React, { useCallback, useEffect, useState } from 'react'
import { FirstRun } from './components/FirstRun'
import { LibraryView } from './components/LibraryView'
import { CompareView } from './components/CompareView'
import { Icon } from './components/Icon'
import { Song } from './lib/audio'
import { tr, useLang } from './i18n'

const hasApi = typeof window !== 'undefined' && !!window.vr

type View = 'library' | 'compare'

export function App() {
  useLang()
  const [firstRun, setFirstRun] = useState<boolean | null>(null) // null = loading
  const [view, setView] = useState<View>('library')
  const [songs, setSongs] = useState<Song[]>([])
  const [compareSong, setCompareSong] = useState<Song | null>(null)

  const reload = useCallback(async () => {
    if (!hasApi) return
    const list = (await window.vr!.library.list()) as Song[]
    setSongs(list)
    // keep the compare target fresh (stems may have been added)
    setCompareSong((cur) => (cur ? (list.find((s) => s.id === cur.id) ?? cur) : cur))
  }, [])

  useEffect(() => {
    if (!hasApi) {
      setFirstRun(true) // pure-vite dev → always show for UI work
      return
    }
    window.vr!.settings.get('firstRunDone').then((done) => setFirstRun(done !== true))
    reload()
  }, [reload])

  if (firstRun === null) return null
  if (firstRun) return <FirstRun onDone={() => setFirstRun(false)} />

  return (
    <div className="col" style={{ height: '100%' }}>
      {/* titlebar — draggable strip, mac traffic lights need left padding */}
      <div className="cv-titlebar drag-strip" style={{ position: 'relative', paddingLeft: 76 }}>
        <div className="row gap10" style={{ paddingLeft: 12 }}>
          <span className="brand">Vocal Referencer</span>
        </div>
        <div className="row grow" style={{ justifyContent: 'center' }}>
          <div className="cv-seg no-drag">
            <button className={'cv-seg-btn' + (view === 'library' ? ' on' : '')} onClick={() => setView('library')}>
              <Icon name="note" className="ic-sm" />
              {tr('nav.library')}
            </button>
            <button
              className={'cv-seg-btn' + (view === 'compare' ? ' on' : '')}
              onClick={() => setView('compare')}
            >
              <Icon name="compare" className="ic-sm" />
              {tr('nav.compare')}
            </button>
          </div>
        </div>
        <div style={{ width: 120 }} />
      </div>

      {view === 'library' ? (
        <LibraryView
          songs={songs}
          reload={reload}
          onCompare={(song) => {
            setCompareSong(song)
            setView('compare')
          }}
        />
      ) : compareSong ? (
        <CompareView key={compareSong.id} song={compareSong} />
      ) : (
        <div className="ph grow" style={{ margin: 16, borderRadius: 'var(--r-lg)' }}>
          <span className="ph-cap">{tr('cmp.pickSong')}</span>
        </div>
      )}
    </div>
  )
}
