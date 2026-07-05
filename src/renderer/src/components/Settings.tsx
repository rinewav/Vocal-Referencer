/* Settings modal (Covo pattern): dimmed overlay → glass card, left section
   nav + right content. All prefs live in the renderer PrefsStore except the
   app version, fetched once over IPC. */
import React, { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { tr, useLang, Lang } from '../i18n'
import { THEMES } from '../theme'
import { usePrefs, PrefsStore, AutoSeparate } from '../prefs'

const hasApi = typeof window !== 'undefined' && !!window.vr

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
  { id: 'export', icon: 'download', k: 'set.nav.export' },
  { id: 'about', icon: 'info', k: 'set.nav.about' }
] as const

export function Settings({ onClose, onReplayTutorial }: { onClose: () => void; onReplayTutorial?: () => void }) {
  const lang = useLang()
  const prefs = usePrefs()
  const [sec, setSec] = useState<string>('appearance')
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (hasApi) window.vr!.appVersion().then(setVersion).catch(() => {})
  }, [])

  /* Esc closes (unless an inner element handled it) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
