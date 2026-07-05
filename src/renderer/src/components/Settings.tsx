/* Settings modal (Covo pattern): dimmed overlay → glass card, left section
   nav + right content. All prefs live in the renderer PrefsStore except the
   app version, fetched once over IPC. */
import React, { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { tr, useLang, Lang } from '../i18n'
import { THEMES } from '../theme'
import { usePrefs, PrefsStore, AutoSeparate } from '../prefs'

const hasApi = typeof window !== 'undefined' && !!window.vr

// Vocal Referencer's own Discord app id — mirrors DEFAULT_CLIENT_ID in main/discord.ts
const DEFAULT_DISCORD_CLIENT_ID = '1523213928660729876'

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 18, padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
      <div className="col" style={{ gap: 3, maxWidth: 420 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-hi)' }}>{title}</span>
        {desc && <span style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }}>{desc}</span>}
      </div>
      <div className="row" style={{ flex: 'none' }}>{children}</div>
    </div>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: '4px 0 6px', fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>{children}</h3>
}

/* segmented chip group used by every multi-choice pref */
function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="row" style={{ gap: 3, padding: 3, borderRadius: 10, background: 'rgba(0,0,0,.25)' }}>
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          onClick={() => onChange(v)}
          style={{
            height: 30, padding: '0 13px', borderRadius: 7, fontSize: 12.5,
            background: value === v ? 'rgba(255,255,255,.11)' : 'transparent',
            color: value === v ? 'var(--text-hi)' : 'var(--text-mid)',
            fontWeight: value === v ? 600 : 500
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const NAV = [
  { id: 'appearance', icon: 'palette', k: 'set.nav.appearance' },
  { id: 'general', icon: 'settings', k: 'set.nav.general' },
  { id: 'analysis', icon: 'sliders', k: 'set.nav.analysis' },
  { id: 'engine', icon: 'bolt', k: 'set.nav.engine' },
  { id: 'export', icon: 'download', k: 'set.nav.export' },
  { id: 'about', icon: 'info', k: 'set.nav.about' }
] as const

export function Settings({ onClose, onReplayTutorial }: { onClose: () => void; onReplayTutorial?: () => void }) {
  const lang = useLang()
  const prefs = usePrefs()
  const [sec, setSec] = useState<string>('appearance')
  const [version, setVersion] = useState('')
  const [resetArmed, setResetArmed] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [discordOn, setDiscordOn] = useState(true) // on by default
  const [discordClientId, setDiscordClientId] = useState(DEFAULT_DISCORD_CLIENT_ID)

  useEffect(() => {
    if (!hasApi) return
    window.vr!.appVersion().then(setVersion).catch(() => {})
    window.vr!.settings.get('discordRpc').then((v) => setDiscordOn(v !== false)).catch(() => {})
    window.vr!.settings
      .get('discordClientId')
      .then((v) => setDiscordClientId(typeof v === 'string' && v ? v : DEFAULT_DISCORD_CLIENT_ID))
      .catch(() => {})
  }, [])

  /* Discord presence: the main process persists the flag + (dis)connects. */
  const toggleDiscord = () => {
    const next = !discordOn
    setDiscordOn(next)
    if (hasApi) void window.vr!.discord.enable(next)
  }
  const saveClientId = (v: string) => {
    setDiscordClientId(v)
    if (!hasApi) return
    void window.vr!.settings.set('discordClientId', v)
    if (discordOn) void window.vr!.discord.enable(true) // reconnect with the new id
  }

  /* Esc closes (unless an inner element handled it) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /* factory reset is a two-step confirm (arm → run); disarm after a few
     seconds if the second click doesn't come */
  useEffect(() => {
    if (!resetArmed) return
    const t = setTimeout(() => setResetArmed(false), 3500)
    return () => clearTimeout(t)
  }, [resetArmed])

  const [resetError, setResetError] = useState(false)

  /* engine section: health check on open, re-install path for users who hit
     "set up later" on first run (the FirstRun gate never shows again) */
  const [engineOk, setEngineOk] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [engineProg, setEngineProg] = useState(0)
  const [engineErr, setEngineErr] = useState(false)

  useEffect(() => {
    if (sec !== 'engine') return
    if (!hasApi) {
      setEngineOk(false)
      return
    }
    setEngineOk(null)
    window
      .vr!.engine.health()
      .then((h) => setEngineOk(!!h && typeof h === 'object' && (h as { ok?: boolean }).ok === true))
      .catch(() => setEngineOk(false))
  }, [sec])

  const runInstall = async () => {
    if (!hasApi || installing) return
    setInstalling(true)
    setEngineErr(false)
    setEngineProg(0)
    // aggregate %, weighted equally per part (same scheme as FirstRun)
    const parts: Record<string, { done: boolean; received: number; total: number }> = {}
    const off = window.vr!.engine.onInstall((p: unknown) => {
      const q = p as { name?: string; received?: number; total?: number; done?: boolean }
      if (!q || typeof q.name !== 'string') return
      parts[q.name] = { done: !!q.done, received: q.received ?? 0, total: q.total ?? 0 }
      const rows = Object.values(parts)
      const frac =
        rows.reduce((s, r) => s + (r.done ? 1 : r.total > 0 ? Math.min(1, r.received / r.total) : 0), 0) / rows.length
      setEngineProg((prev) => Math.max(prev, Math.min(100, Math.round(frac * 100))))
    })
    try {
      const report = await window.vr!.engine.install()
      const ok = !!report && typeof report === 'object' && (report as { ok?: boolean }).ok === true
      if (ok) {
        setEngineProg(100)
        setEngineOk(true)
      } else setEngineErr(true)
    } catch {
      setEngineErr(true)
    } finally {
      off()
      setInstalling(false)
    }
  }

  const doReset = async () => {
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    setResetting(true)
    setResetError(false)
    // renderer-owned state lives in localStorage (prefs, language, tutorial
    // flag) — clear it before the main process wipes its own store & relaunches
    try {
      localStorage.clear()
    } catch {
      /* storage unavailable — the relaunch still restores defaults */
    }
    try {
      if (hasApi) {
        await window.vr!.resetApp() // relaunches the app; resolves only on failure
      } else {
        location.reload() // pure-vite dev fallback
      }
      // if resetApp() returns, the main process didn't relaunch (e.g. the DB
      // file was locked) — surface it so the button isn't stuck "Resetting…"
      setResetting(false)
      setResetError(true)
    } catch {
      setResetting(false)
      setResetError(true)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 210, background: 'rgba(6,7,9,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fade-in .16s' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass"
        style={{ width: 780, height: 540, maxWidth: '94%', maxHeight: '92%', borderRadius: 20, display: 'flex', overflow: 'hidden', boxShadow: 'var(--shadow-pop)', animation: 'pop-in .2s ease' }}
      >
        {/* nav */}
        <aside style={{ width: 200, flex: 'none', padding: '18px 12px', background: 'rgba(0,0,0,.18)', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, padding: '4px 10px 12px' }}>{tr('set.title')}</span>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setSec(n.id)}
              className="row gap10"
              style={{
                padding: '9px 11px', borderRadius: 8, textAlign: 'left',
                background: sec === n.id ? 'rgba(255,255,255,.08)' : 'transparent',
                color: sec === n.id ? 'var(--text-hi)' : 'var(--text-mid)'
              }}
              onMouseEnter={(e) => { if (sec !== n.id) e.currentTarget.style.background = 'rgba(255,255,255,.04)' }}
              onMouseLeave={(e) => { if (sec !== n.id) e.currentTarget.style.background = 'transparent' }}
            >
              <Icon name={n.icon} className="ic-sm" style={{ color: sec === n.id ? 'var(--accent-hi)' : 'var(--text-lo)' }} />
              <span style={{ fontSize: 13 }}>{tr(n.k)}</span>
            </button>
          ))}
        </aside>

        {/* content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="row" style={{ justifyContent: 'flex-end', padding: '12px 14px 0' }}>
            <button
              onClick={onClose}
              className="row"
              style={{ width: 30, height: 30, borderRadius: 8, justifyContent: 'center', color: 'var(--text-mid)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon name="x" className="ic-sm" />
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 26px 26px' }}>
            {sec === 'appearance' && (
              <div>
                <H>{tr('set.nav.appearance')}</H>
                <div style={{ padding: '13px 0' }}>
                  <div className="col" style={{ gap: 3, marginBottom: 12 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-hi)' }}>{tr('set.theme')}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }}>{tr('set.themeSub')}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                    {Object.keys(THEMES).map((id) => {
                      const th = THEMES[id]
                      const on = prefs.theme === id
                      return (
                        <button
                          key={id}
                          onClick={() => PrefsStore.set({ theme: id })}
                          className="col"
                          style={{
                            gap: 8, padding: 10, borderRadius: 12, alignItems: 'stretch',
                            background: on ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.025)',
                            border: '1px solid ' + (on ? 'var(--accent-line)' : 'var(--glass-border)'),
                            transition: 'background .12s, border-color .12s'
                          }}
                        >
                          <div style={{ height: 42, borderRadius: 8, overflow: 'hidden', position: 'relative', background: th.canvas, border: '1px solid rgba(255,255,255,.08)' }}>
                            <div style={{ position: 'absolute', top: 6, left: 6, right: 6, height: 6, borderRadius: 3, background: th.chrome }} />
                            <div style={{ position: 'absolute', bottom: 7, left: 7, width: 14, height: 14, borderRadius: '50%', background: th.swatch }} />
                          </div>
                          <span style={{ fontSize: 12, textAlign: 'center', color: on ? 'var(--text-hi)' : 'var(--text-mid)', fontWeight: on ? 600 : 500 }}>{th.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {sec === 'general' && (
              <div>
                <H>{tr('set.nav.general')}</H>
                <Row title={tr('set.language')} desc={tr('set.languageSub')}>
                  <Choice value={lang} options={[['en', 'English'], ['ja', '日本語']]} onChange={(v) => Lang.set(v)} />
                </Row>
                <Row title={tr('set.autoSep')} desc={tr('set.autoSepSub')}>
                  <Choice<AutoSeparate>
                    value={prefs.autoSeparate}
                    options={[['off', tr('set.autoSep.off')], ['vocal', tr('set.autoSep.vocal')], ['full', tr('set.autoSep.full')]]}
                    onChange={(v) => PrefsStore.set({ autoSeparate: v })}
                  />
                </Row>
                <Row title={tr('set.discord')} desc={tr('set.discordSub')}>
                  <button className={'cv-toggle' + (discordOn ? ' on' : '')} onClick={toggleDiscord}>
                    <span className="knob" />
                  </button>
                </Row>
                {discordOn && (
                  <Row title={tr('set.discordClientId')} desc={tr('set.discordClientIdSub')}>
                    <input
                      value={discordClientId}
                      onChange={(e) => saveClientId(e.target.value.trim())}
                      placeholder="1234567890…"
                      spellCheck={false}
                      style={{ width: 210, height: 32, padding: '0 10px', borderRadius: 8, background: 'rgba(0,0,0,.25)', border: '1px solid var(--glass-border)', color: 'var(--text-hi)', fontSize: 12.5 }}
                    />
                  </Row>
                )}
              </div>
            )}

            {sec === 'analysis' && (
              <div>
                <H>{tr('set.nav.analysis')}</H>
                <Row title={tr('set.tilt')} desc={tr('set.tiltSub')}>
                  <Choice<number>
                    value={prefs.tiltDbPerOct}
                    options={[[0, '0'], [3, '3'], [4.5, '4.5'], [6, '6']]}
                    onChange={(v) => PrefsStore.set({ tiltDbPerOct: v })}
                  />
                </Row>
                <p style={{ margin: '10px 2px 0', fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.55 }}>{tr('set.tiltNote')}</p>
              </div>
            )}

            {sec === 'engine' && (
              <div>
                <H>{tr('set.nav.engine')}</H>
                <Row title={tr('set.engineStatus')} desc={tr('set.engineStatusSub')}>
                  <span className="row gap8" style={{ fontSize: 12.5 }}>
                    <span
                      className="dot"
                      style={{
                        background:
                          engineOk === null ? 'var(--text-faint)' : engineOk ? 'var(--lab-green)' : 'var(--lab-amber)'
                      }}
                    />
                    <span style={{ color: 'var(--text-mid)' }}>
                      {engineOk === null ? tr('set.engineChecking') : engineOk ? tr('set.engineOk') : tr('set.engineMissing')}
                    </span>
                  </span>
                </Row>
                {engineOk === false && (
                  <div className="col" style={{ gap: 10, padding: '13px 0' }}>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.6, maxWidth: 460 }}>
                      {tr('set.engineNote')}
                    </p>
                    {installing && (
                      <div className="col" style={{ gap: 6 }}>
                        <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: engineProg + '%', background: 'var(--accent)', transition: 'width .25s' }} />
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-lo)' }}>{engineProg}%</span>
                      </div>
                    )}
                    {engineErr && (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--lab-amber)', lineHeight: 1.5 }}>{tr('fr.incomplete')}</p>
                    )}
                    <button
                      className="btn primary"
                      style={{ alignSelf: 'flex-start', opacity: installing ? 0.6 : 1 }}
                      disabled={installing}
                      onClick={runInstall}
                    >
                      <Icon name="download" className="ic-sm" />
                      {installing ? tr('fr.statusFetching') + '…' : tr('set.engineInstall')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {sec === 'export' && (
              <div>
                <H>{tr('set.nav.export')}</H>
                <Row title={tr('set.bakeGain')} desc={tr('set.bakeGainSub')}>
                  <button className={'cv-toggle' + (prefs.bakeGain ? ' on' : '')} onClick={() => PrefsStore.set({ bakeGain: !prefs.bakeGain })}>
                    <span className="knob" />
                  </button>
                </Row>
                <p style={{ margin: '10px 2px 0', fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.55 }}>{tr('set.exportNote')}</p>
              </div>
            )}

            {sec === 'about' && (
              <div>
                <H>{tr('set.nav.about')}</H>
                <p style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.7, maxWidth: 480 }}>{tr('set.aboutBody')}</p>
                <div className="row gap8" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  <span className="chip">{version ? `v${version}` : '…'}</span>
                </div>
                {onReplayTutorial && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.07)' }}>
                    <div className="col" style={{ gap: 3, marginBottom: 10 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-hi)' }}>{tr('set.replayTutorial')}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }}>{tr('set.replayTutorialSub')}</span>
                    </div>
                    <button onClick={onReplayTutorial} className="btn" style={{ height: 32 }}>
                      <Icon name="play" className="ic-sm" />
                      {tr('set.replayTutorialBtn')}
                    </button>
                  </div>
                )}
                <div className="row gap8" style={{ marginTop: 14, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>{tr('set.developer')}</span>
                  <button
                    onClick={() => window.open('https://x.com/rinemusic')}
                    className="row gap6"
                    style={{ height: 30, padding: '0 12px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--glass-border)', color: 'var(--text-hi)', fontSize: 12.5, fontWeight: 500 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.04)')}
                  >
                    りね (rine)
                    <span className="mono" style={{ color: 'var(--accent-hi)' }}>@rinemusic</span>
                  </button>
                </div>

                {/* danger zone — factory reset (two-step confirm) */}
                <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.07)' }}>
                  <div className="col" style={{ gap: 3, marginBottom: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--lab-red)' }}>{tr('set.reset')}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5, maxWidth: 480 }}>{tr('set.resetSub')}</span>
                  </div>
                  <button
                    onClick={doReset}
                    disabled={resetting}
                    className="btn"
                    style={{
                      height: 32,
                      border: '1px solid var(--lab-red)',
                      background: resetArmed ? 'var(--lab-red)' : 'transparent',
                      color: resetArmed ? 'oklch(0.16 0.02 25)' : 'var(--lab-red)',
                      fontWeight: resetArmed ? 600 : 500,
                      cursor: resetting ? 'default' : 'pointer',
                      opacity: resetting ? 0.6 : 1
                    }}
                  >
                    <Icon name="refresh" className="ic-sm" />
                    {resetting ? tr('set.resetting') : resetArmed ? tr('set.resetConfirm') : tr('set.resetBtn')}
                  </button>
                  {resetError && (
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--lab-red)', lineHeight: 1.5, maxWidth: 480 }}>
                      {tr('set.resetError')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
