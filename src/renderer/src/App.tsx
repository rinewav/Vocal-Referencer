import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FirstRun } from './components/FirstRun'
import { LibraryView } from './components/LibraryView'
import { CompareView } from './components/CompareView'
import { Settings } from './components/Settings'
import { Tutorial } from './components/Tutorial'
import { Icon } from './components/Icon'
import { Song, SeparateProgress } from './lib/audio'
import { maybeChainKaraoke } from './lib/refimport'
import { tr, useLang } from './i18n'
import './prefs' // boot-time theme apply

const hasApi = typeof window !== 'undefined' && !!window.vr
const platform = hasApi ? window.vr!.platform : 'darwin'

type View = 'library' | 'compare'

export function App() {
  const lang = useLang()
  const [firstRun, setFirstRun] = useState<boolean | null>(null) // null = loading
  const [view, setView] = useState<View>('library')
  const [songs, setSongs] = useState<Song[]>([])
  const [compareSong, setCompareSong] = useState<Song | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorial, setTutorial] = useState(false)
  // notify-only update banner (null = hidden); set when a newer GitHub release
  // is found on launch. Never auto-installs — just links to the release page.
  const [update, setUpdate] = useState<{ latest?: string; url?: string } | null>(null)

  const startTutorial = useCallback(() => {
    setSettingsOpen(false)
    setView('library')
    setTutorial(true)
  }, [])

  const closeTutorial = useCallback(() => {
    setTutorial(false)
    if (hasApi) void window.vr!.settings.set('tutorialDone', true)
    else localStorage.setItem('vr.tutorialDone', '1')
  }, [])

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

  /* separation lifecycle lives here (always mounted, unlike the views):
     refresh the library when a job lands, chain the karaoke split, and put up
     an OS notification when the app isn't focused — separation takes minutes
     and users switch to their DAW in the meantime */
  const songsRef = useRef<Song[]>([])
  songsRef.current = songs
  useEffect(() => {
    if (!hasApi) return
    return window.vr!.separate.onProgress((p: unknown) => {
      const prog = p as SeparateProgress
      if (prog.stage !== 'done' && prog.stage !== 'error') return
      if (prog.stage === 'done') {
        reload()
        void maybeChainKaraoke(prog.songId, prog.preset)
      }
      if (!document.hasFocus()) {
        const title = songsRef.current.find((s) => s.id === prog.songId)?.title ?? 'Vocal Referencer'
        try {
          new Notification(title, { body: tr(prog.stage === 'done' ? 'notif.sepDone' : 'notif.sepError'), silent: true })
        } catch {
          /* notifications unavailable — non-essential */
        }
      }
    })
  }, [reload])

  /* onboarding: once per install, right after the first-run gate clears */
  useEffect(() => {
    if (firstRun !== false) return
    if (hasApi) {
      window.vr!.settings.get('tutorialDone').then((done) => {
        if (done !== true) setTutorial(true)
      })
    } else if (localStorage.getItem('vr.tutorialDone') !== '1') {
      setTutorial(true)
    }
  }, [firstRun])

  /* keep Discord Rich Presence in sync with the current view + UI language
     (no-op in the main process when presence is off or Discord isn't running) */
  useEffect(() => {
    if (hasApi) void window.vr!.discord.setPresence({ view, lang })
  }, [view, lang])

  /* notify-only update check on launch: ask main to compare the GitHub latest
     release to the running build. Fail-silent — no banner unless a newer
     version is found (offline / no releases / errors are swallowed). */
  useEffect(() => {
    if (!hasApi) return
    let alive = true
    window
      .vr!.checkUpdate()
      .then((u) => {
        if (alive && u && u.updateAvailable) setUpdate({ latest: u.latest, url: u.url })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (firstRun === null) return null
  if (firstRun) return <FirstRun onDone={() => setFirstRun(false)} />

  return (
    <div className="col" style={{ height: '100%', position: 'relative' }}>
      {/* titlebar — draggable strip; mac needs traffic-light padding, other
          platforms run frameless and get in-app window controls instead */}
      <div
        className="cv-titlebar drag-strip"
        style={{ position: 'relative', paddingLeft: platform === 'darwin' ? 76 : 0 }}
      >
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
              data-tut="nav-compare"
              onClick={() => setView('compare')}
            >
              <Icon name="compare" className="ic-sm" />
              {tr('nav.compare')}
            </button>
          </div>
        </div>
        <div
          className="row no-drag"
          style={{ minWidth: 120, height: '100%', justifyContent: 'flex-end', paddingRight: platform === 'darwin' ? 12 : 0 }}
        >
          <button
            className="cv-toolbtn"
            data-tut="settings"
            title={tr('set.title')}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" className="ic-sm" />
          </button>
          {platform !== 'darwin' && hasApi && (
            <>
              <span className="cv-winbtn-sep" style={{ marginLeft: 8 }} />
              <button className="cv-winbtn" onClick={() => window.vr!.win.minimize()}>
                <Icon name="minus" className="ic-sm" />
              </button>
              <button className="cv-winbtn" onClick={() => window.vr!.win.maximizeToggle()}>
                <Icon name="square" style={{ width: 12, height: 12 }} />
              </button>
              <button className="cv-winbtn danger" onClick={() => window.vr!.win.close()}>
                <Icon name="x" className="ic-sm" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* notify-only update bar — opens the release page, never auto-installs */}
      {update && (
        <div
          className="row gap10 no-drag"
          style={{
            justifyContent: 'center',
            padding: '8px 14px',
            background: 'var(--accent-dim)',
            borderBottom: '1px solid var(--accent-line)',
            animation: 'view-in .16s ease both'
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--text-hi)' }}>
            {tr('up.available')}
            {update.latest ? ' · v' + update.latest : ''}
          </span>
          <button
            onClick={() => {
              void window.vr!.openDownload(update.url)
            }}
            className="cv-btn primary"
            style={{ height: 26, fontSize: 12 }}
          >
            {tr('up.download')}
          </button>
          <button
            onClick={() => setUpdate(null)}
            className="cv-toolbtn"
            title={tr('up.dismiss')}
            style={{ width: 24, height: 24 }}
          >
            <Icon name="x" className="ic-sm" />
          </button>
        </div>
      )}

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onReplayTutorial={startTutorial} />}
      {tutorial && <Tutorial onClose={closeTutorial} />}

      {view === 'library' ? (
        <LibraryView
          songs={songs}
          reload={reload}
          onOpen={(song) => {
            setCompareSong(song)
            setView('compare')
          }}
        />
      ) : compareSong ? (
        <CompareView
          key={compareSong.id}
          song={compareSong}
          reload={reload}
          modalOpen={settingsOpen || tutorial}
        />
      ) : (
        <div className="ph grow" style={{ margin: 16, borderRadius: 'var(--r-lg)', animation: 'view-in .3s ease both' }}>
          <div className="col gap12" style={{ alignItems: 'center' }}>
            <span className="ph-cap">{tr('cmp.pickSong')}</span>
            <button className="btn" onClick={() => setView('library')}>
              <Icon name="note" className="ic-sm" />
              {tr('cmp.backToLibrary')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
