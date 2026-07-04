/* Vocal Referencer — first-run consent + engine download.
   Structure mirrors Covo's FirstRun (language → consent gate → fetch progress),
   restyled Nightfall. Engine fetched with explicit consent; all local. */
import React, { useState, useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { Lang, useLang, tr } from '../i18n'

export interface FirstRunProps {
  onDone: () => void
}

interface InstallProgress {
  name: string
  received: number
  total: number // 0 → indeterminate (pip)
  done: boolean
  error?: string
}

interface ManifestRow {
  name: string
  kind: string
  roleKey: string
  sizeLabel: string
}

const hasApi = typeof window !== 'undefined' && !!window.vr

function isInstallProgress(p: unknown): p is InstallProgress {
  return !!p && typeof p === 'object' && typeof (p as InstallProgress).name === 'string'
}

function Logo({ size = 48 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '26%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent-line)',
        color: 'var(--accent-hi)',
        animation: 'float-y 4.5s ease-in-out infinite'
      }}
    >
      <Icon name="wave" style={{ width: size * 0.54, height: size * 0.54, strokeWidth: 1.6 }} />
    </div>
  )
}

export function FirstRun({ onDone }: FirstRunProps) {
  useLang()
  const [lang, setLang] = useState(true) // language chooser first
  const [step, setStep] = useState(0) // 0 consent · 1 fetching
  const [agree, setAgree] = useState(false)
  const [manifest, setManifest] = useState<ManifestRow[]>([])
  const [parts, setParts] = useState<Record<string, InstallProgress>>({})
  const [prog, setProg] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  // once-only latch (ref, not state — see Covo: retriggering the effect would
  // cancel in-flight install promises)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!hasApi) {
      setManifest([
        { name: 'Python Runtime', kind: 'python-runtime', roleKey: 'python-runtime', sizeLabel: '~45 MB' },
        { name: 'Audio Engine', kind: 'pip', roleKey: 'pip', sizeLabel: '~800 MB' },
        { name: 'Vocal Model', kind: 'model', roleKey: 'model', sizeLabel: '~600 MB' },
        { name: 'Karaoke Model', kind: 'model', roleKey: 'model-karaoke', sizeLabel: '~250 MB' }
      ])
      return
    }
    window.vr!.engine.manifest().then((rows) => setManifest(rows as ManifestRow[]))
  }, [])

  // degraded (pure-vite dev, no Electron) → simulated progress demo
  useEffect(() => {
    if (step !== 1 || hasApi) return
    const t = setInterval(() => setProg((p) => Math.min(100, p + 3 + Math.random() * 6)), 180)
    return () => clearInterval(t)
  }, [step])

  // real install path
  useEffect(() => {
    if (step !== 1 || !hasApi || startedRef.current) return
    startedRef.current = true
    setErr(null)
    let canceled = false
    const off = window.vr!.engine.onInstall((p: unknown) => {
      if (!isInstallProgress(p)) return
      setParts((prev) => ({ ...prev, [p.name]: p }))
      if (p.error) setErr(tr('fr.incomplete'))
    })
    window.vr!.engine
      .health()
      .then((h) => {
        if (canceled) return
        if (h && typeof h === 'object' && (h as { ok?: boolean }).ok === true) {
          setProg(100)
          return
        }
        return window.vr!.engine
          .install()
          .then((report) => {
            if (canceled) return
            const ok = !!report && typeof report === 'object' && (report as { ok?: boolean }).ok === true
            if (ok) setProg(100)
            else setErr(tr('fr.incomplete'))
          })
          .catch(() => {
            if (!canceled) setErr(tr('fr.incomplete'))
          })
      })
      .catch(() => {
        if (!canceled) setErr(tr('fr.incomplete'))
      })
    return () => {
      canceled = true
      off()
    }
  }, [step])

  // aggregate %, weighted equally per part (count-based — stable denominator)
  useEffect(() => {
    if (!hasApi) return
    const rows = Object.values(parts)
    if (rows.length === 0) return
    const frac =
      rows.reduce((s, r) => s + (r.done ? 1 : r.total > 0 ? Math.min(1, r.received / r.total) : 0), 0) /
      rows.length
    setProg((p) => Math.max(p, Math.min(100, Math.round(frac * 100))))
  }, [parts])

  const finish = () => {
    if (hasApi) {
      try {
        window.vr!.settings.set('firstRunDone', true)
      } catch {
        // settings persistence unavailable — proceed anyway
      }
    }
    onDone()
  }

  const retry = () => {
    startedRef.current = false
    setParts({})
    setProg(0)
    setErr(null)
    setStep(0)
  }

  const fmtMB = (bytes: number) => (bytes / 1048576).toFixed(0) + ' MB'

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(900px 600px at 70% -10%, oklch(0.30 0.06 var(--accent-h) / .35), transparent 60%), oklch(0.12 0.008 255)',
        animation: 'fade-in .2s'
      }}
    >
      <div
        className="glass"
        style={{ width: 560, borderRadius: 22, padding: 30, boxShadow: 'var(--shadow-pop)', animation: 'pop-in .24s ease' }}
      >
        {lang ? (
          <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: '16px 8px 8px' }}>
            <div style={{ marginBottom: 18 }}>
              <Logo size={64} />
            </div>
            <span
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, marginBottom: 6, animation: 'view-in .3s ease both', animationDelay: '60ms' }}
            >
              Vocal Referencer
            </span>
            <span
              style={{ fontSize: 13.5, color: 'var(--text-mid)', lineHeight: 1.55, marginBottom: 26, animation: 'view-in .3s ease both', animationDelay: '120ms' }}
            >
              Choose your language
              <br />
              言語を選択
            </span>
            <div className="row gap12" style={{ width: '100%', animation: 'view-in .3s ease both', animationDelay: '180ms' }}>
              <button onClick={() => { Lang.set('en'); setLang(false) }} className="btn ghost grow" style={{ height: 52, fontSize: 15 }}>
                English
              </button>
              <button onClick={() => { Lang.set('ja'); setLang(false) }} className="btn ghost grow" style={{ height: 52, fontSize: 15 }}>
                日本語
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* brand */}
            <div className="row gap12" style={{ marginBottom: 18, animation: 'view-in .3s ease both' }}>
              <Logo />
              <div className="col" style={{ gap: 2 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21 }}>{tr('fr.welcome')}</span>
                <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>{tr('fr.tagline')}</span>
              </div>
            </div>

            {step === 0 && (
              <div style={{ animation: 'slide-right .26s ease both' }}>
                <p style={{ fontSize: 13.5, color: 'var(--text-mid)', lineHeight: 1.65, margin: '0 0 18px' }}>{tr('fr.consent')}</p>

                <div className="cv-group" style={{ marginBottom: 16 }}>
                  <div className="cv-group-head" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase' }}>
                    {tr('fr.installs')}
                  </div>
                  {manifest.map((row, i) => (
                    <div key={row.name} className="cv-group-row" style={{ animation: 'view-in .32s ease both', animationDelay: 80 + i * 55 + 'ms' }}>
                      <Icon name="bolt" className="ic-sm" style={{ color: 'var(--text-lo)' }} />
                      <span style={{ fontSize: 12.5, width: 132 }}>{row.name}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-mid)', flex: 1 }}>{tr('fr.role.' + row.roleKey)}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{row.sizeLabel}</span>
                    </div>
                  ))}
                </div>

                <label className="row gap10" style={{ alignItems: 'flex-start', cursor: 'pointer', marginBottom: 18 }}>
                  <button
                    onClick={() => setAgree((a) => !a)}
                    style={{
                      width: 20, height: 20, borderRadius: 6, flex: 'none', marginTop: 1,
                      border: '1.5px solid ' + (agree ? 'var(--accent)' : 'var(--text-lo)'),
                      background: agree ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'oklch(0.16 0.02 255)'
                    }}
                  >
                    {agree && <Icon name="check" style={{ width: 13, height: 13 }} />}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.55 }}>
                    {tr('fr.agreePre')}
                    <strong style={{ color: 'var(--text-hi)' }}>{tr('fr.agreeBold')}</strong>
                    {tr('fr.agreePost')}
                  </span>
                </label>

                <div className="row gap10">
                  <button onClick={finish} className="btn ghost grow">{tr('fr.skip')}</button>
                  <button
                    onClick={() => { if (agree) setStep(1) }}
                    disabled={!agree}
                    className="btn primary grow"
                    style={{ opacity: agree ? 1 : 0.4, cursor: agree ? 'pointer' : 'not-allowed' }}
                  >
                    <Icon name="download" className="ic-sm" />
                    {tr('fr.setup')}
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div style={{ animation: 'slide-right .26s ease both' }}>
                <p style={{ fontSize: 13.5, color: 'var(--text-mid)', lineHeight: 1.6, margin: '0 0 18px' }}>
                  {err ? err : prog >= 100 ? tr('fr.allset') : tr('fr.fetching')}
                </p>

                {/* per-part rows */}
                {hasApi && Object.keys(parts).length > 0 && (
                  <div className="cv-group" style={{ marginBottom: 14 }}>
                    {manifest.map((row) => {
                      const p = parts[row.name]
                      const state = !p ? 'wait' : p.error ? 'error' : p.done ? 'done' : 'busy'
                      return (
                        <div key={row.name} className="cv-group-row" style={{ gap: 10 }}>
                          {state === 'done' ? (
                            <Icon name="check" className="ic-sm" style={{ color: 'var(--lab-green)' }} />
                          ) : (
                            <span
                              className="dot"
                              style={{
                                background: state === 'error' ? 'var(--lab-amber)' : state === 'busy' ? 'var(--accent)' : 'var(--text-faint)'
                              }}
                            />
                          )}
                          <span style={{ fontSize: 12.5, width: 132 }}>{row.name}</span>
                          <span style={{ flex: 1 }}>
                            {state === 'busy' && p!.total === 0 && <span className="indet" style={{ display: 'block', width: '100%' }} />}
                          </span>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            {state === 'busy' && p!.total === 100
                              ? `${p!.received}%` // model download reports tqdm percentage
                              : state === 'busy' && p!.total > 0
                                ? `${fmtMB(p!.received)} / ${fmtMB(p!.total)}`
                                : state === 'done' ? 'ok' : state === 'error' ? 'error' : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* aggregate bar */}
                <div style={{ height: 8, borderRadius: 5, background: 'rgba(255,255,255,.1)', overflow: 'hidden', marginBottom: 10 }}>
                  <div
                    style={{
                      height: '100%',
                      width: prog + '%',
                      borderRadius: 5,
                      background: err ? 'var(--lab-amber)' : prog >= 100 ? 'var(--lab-green)' : 'var(--accent)',
                      transition: 'width .25s'
                    }}
                  />
                </div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 22 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-lo)' }}>
                    {err ? tr('fr.statusIncomplete') : prog >= 100 ? tr('fr.statusReady') : tr('fr.statusFetching')}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-lo)' }}>{Math.round(prog)}%</span>
                </div>

                {err ? (
                  <div className="row gap10">
                    <button onClick={finish} className="btn ghost grow">{tr('fr.skip')}</button>
                    <button onClick={retry} className="btn primary grow">{tr('fr.retry')}</button>
                  </div>
                ) : (
                  <button
                    onClick={finish}
                    disabled={prog < 100}
                    className="cv-cta"
                    style={{ opacity: prog >= 100 ? 1 : 0.4, cursor: prog >= 100 ? 'pointer' : 'not-allowed' }}
                  >
                    <Icon name="play" className="ic-sm" />
                    {tr('fr.open')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
