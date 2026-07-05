/* First-run coach-marks (Covo pattern): highlights real UI elements tagged
   with data-tut and walks the core loop — create a project → register both
   vocals → compare → export → settings. Shown once after first run, and
   re-openable from Settings → About. */
import React, { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'

interface Step {
  /* data-tut target; '' = centered card with no highlight */
  target: string
  titleKey: string
  bodyKey: string
}

const STEPS: Step[] = [
  { target: 'new-project', titleKey: 'tut.createTitle', bodyKey: 'tut.createBody' },
  { target: 'tiles', titleKey: 'tut.registerTitle', bodyKey: 'tut.registerBody' },
  { target: 'nav-compare', titleKey: 'tut.compareTitle', bodyKey: 'tut.compareBody' },
  { target: '', titleKey: 'tut.analysisTitle', bodyKey: 'tut.analysisBody' },
  { target: 'settings', titleKey: 'tut.settingsTitle', bodyKey: 'tut.settingsBody' }
]

const TIP_W = 320

export function Tutorial({ onClose }: { onClose: () => void }) {
  useLang()
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[idx]

  /* measure the highlighted element (briefly retrying while it mounts) and
     keep the ring aligned on resize */
  useEffect(() => {
    if (!step.target) {
      setRect(null)
      return
    }
    let raf = 0
    let tries = 0
    const measure = (): void => {
      const el = document.querySelector('[data-tut="' + step.target + '"]') as HTMLElement | null
      if (el) setRect(el.getBoundingClientRect())
      else if (tries++ < 40) raf = requestAnimationFrame(measure)
      else setRect(null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])

  const next = (): void => {
    if (idx < STEPS.length - 1) setIdx(idx + 1)
    else onClose()
  }
  const back = (): void => {
    if (idx > 0) setIdx(idx - 1)
  }

  /* effective spotlight target: skip the ring when the element is scrolled
     off-screen (rect fully above/below the viewport → clamping would invert to
     a negative size) or too tall to frame (e.g. the empty-library placeholder,
     which grows to fill the whole view on first run). Falling back to a
     centered card keeps the backdrop dark and the ring sane. */
  const onScreen = !!rect && rect.bottom > 0 && rect.top < window.innerHeight
  const target = rect && onScreen && rect.height <= window.innerHeight * 0.6 ? rect : null

  /* tooltip below the target when there's room, else above; centered when
     there's no framable target */
  let tipStyle: React.CSSProperties
  let ring: React.CSSProperties | null = null
  if (target) {
    const placeBelow = target.bottom + 180 < window.innerHeight
    const top = placeBelow ? target.bottom + 14 : Math.max(54, target.top - 174)
    const left = Math.max(14, Math.min(window.innerWidth - TIP_W - 14, target.left + target.width / 2 - TIP_W / 2))
    tipStyle = { position: 'fixed', top, left, width: TIP_W, zIndex: 421 }
    /* clamp the ring fully on-screen — titlebar controls sit right at the top
       edge, so an un-clamped ring (target.top - 6) gets its corners cut off */
    const M = 4
    const pad = 6
    let rl = target.left - pad
    let rt = target.top - pad
    let rw = target.width + pad * 2
    let rh = target.height + pad * 2
    if (rl < M) { rw -= M - rl; rl = M }
    if (rt < M) { rh -= M - rt; rt = M }
    if (rl + rw > window.innerWidth - M) rw = window.innerWidth - M - rl
    if (rt + rh > window.innerHeight - M) rh = window.innerHeight - M - rt
    rw = Math.max(0, rw)
    rh = Math.max(0, rh)
    ring = {
      position: 'fixed',
      left: rl,
      top: rt,
      width: rw,
      height: rh,
      borderRadius: 14,
      border: '2px solid var(--accent)',
      boxShadow: '0 0 0 9999px rgba(6,7,9,.55), 0 0 18px var(--accent)',
      zIndex: 420,
      pointerEvents: 'none'
    }
  } else {
    tipStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: TIP_W, zIndex: 421 }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 419 }}>
      {!ring && <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,7,9,.55)' }} />}
      {ring && <div style={ring} />}
      <div className="glass" style={{ ...tipStyle, padding: 16, borderRadius: 14, boxShadow: 'var(--shadow-pop)', animation: 'pop-in .18s ease' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5, color: 'var(--text-hi)' }}>
            {tr(step.titleKey)}
          </span>
          <button
            onClick={onClose}
            title={tr('tut.skip')}
            className="row"
            style={{ width: 26, height: 26, borderRadius: 7, justifyContent: 'center', color: 'var(--text-mid)' }}
          >
            <Icon name="x" className="ic-sm" />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-mid)' }}>{tr(step.bodyKey)}</p>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div className="row gap6">
            {STEPS.map((_, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === idx ? 'var(--accent)' : 'rgba(255,255,255,.22)' }} />
            ))}
          </div>
          <div className="row gap8">
            {idx > 0 && (
              <button onClick={back} className="btn" style={{ height: 30, fontSize: 12.5 }}>
                {tr('tut.back')}
              </button>
            )}
            <button onClick={next} className="btn primary" style={{ height: 30, fontSize: 12.5 }}>
              {idx === STEPS.length - 1 ? tr('tut.done') : tr('tut.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
