/* Spectrum comparison + suggested EQ curve (canvas, log-f axis 20 Hz–20 kHz)
   and the equivalent-compressor card. Colors follow the DS: data uses
   --lab-* functional colors, accent marks the actionable EQ curve. */
import React, { useEffect, useRef } from 'react'
import { Spectrum, smoothSpectrum } from '../lib/dsp'
import type { CompRecommendation } from '../lib/dsp'
import { tr, useLang } from '../i18n'

const F_LO = 20
const F_HI = 20000

function xForFreq(f: number, width: number): number {
  return (Math.log10(f / F_LO) / Math.log10(F_HI / F_LO)) * width
}

export function SpectrumChart({ refSpec, ownSpec, eqCurve }: { refSpec: Spectrum; ownSpec: Spectrum; eqCurve: Float32Array }) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth
    const H = canvas.clientHeight
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const specH = H * 0.62
    const eqH = H - specH - 14

    // grid: decades + reference lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '9.5px "IBM Plex Mono", monospace'
    ctx.lineWidth = 1
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = xForFreq(f, W)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, H - 3)
    }

    const drawSpec = (spec: Spectrum, color: string) => {
      const sm = smoothSpectrum(spec, 6)
      // normalize display to its own median so both curves share the panel
      const sorted = Float32Array.from(sm.slice(1)).sort()
      const med = sorted[Math.floor(sorted.length / 2)]
      ctx.strokeStyle = color
      ctx.lineWidth = 1.6
      ctx.beginPath()
      let started = false
      for (let k = 1; k < sm.length; k++) {
        const f = (k * spec.sampleRate) / spec.fftSize
        if (f < F_LO || f > F_HI) continue
        const x = xForFreq(f, W)
        const dbRel = sm[k] - med // ±~30 dB window
        const y = specH / 2 - (dbRel / 30) * (specH / 2)
        if (!started) {
          ctx.moveTo(x, Math.max(0, Math.min(specH, y)))
          started = true
        } else ctx.lineTo(x, Math.max(0, Math.min(specH, y)))
      }
      ctx.stroke()
    }
    drawSpec(refSpec, 'oklch(0.70 0.14 255)') // --lab-blue
    drawSpec(ownSpec, 'oklch(0.73 0.16 350)') // --lab-pink

    // EQ curve strip (accent, ±12 dB), zero line
    const eqTop = specH + 14
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.beginPath()
    ctx.moveTo(0, eqTop + eqH / 2)
    ctx.lineTo(W, eqTop + eqH / 2)
    ctx.stroke()
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || 'oklch(0.70 0.13 255)'
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    let started = false
    for (let k = 1; k < eqCurve.length; k++) {
      const f = (k * refSpec.sampleRate) / refSpec.fftSize
      if (f < F_LO || f > F_HI) continue
      const x = xForFreq(f, W)
      const y = eqTop + eqH / 2 - (eqCurve[k] / 12) * (eqH / 2)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillText('+12', 2, eqTop + 9)
    ctx.fillText('-12', 2, eqTop + eqH - 2)
  }, [refSpec, ownSpec, eqCurve])

  return (
    <div className="col gap8">
      <div className="row gap12" style={{ fontSize: 11.5 }}>
        <span className="row gap6" style={{ color: 'var(--text-mid)' }}>
          <span className="dot" style={{ background: 'var(--lab-blue)' }} />
          {tr('cmp.legendRef')}
        </span>
        <span className="row gap6" style={{ color: 'var(--text-mid)' }}>
          <span className="dot" style={{ background: 'var(--lab-pink)' }} />
          {tr('cmp.legendOwn')}
        </span>
        <span className="row gap6" style={{ color: 'var(--text-mid)', marginLeft: 'auto' }}>
          <span className="dot" style={{ background: 'var(--accent)' }} />
          {tr('cmp.eqCurve')}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height: 240, display: 'block' }} />
    </div>
  )
}

export function CompCard({ rec }: { rec: CompRecommendation }) {
  useLang()
  const fmt = (v: number) => v.toFixed(1)
  return (
    <div className="card col gap8" style={{ padding: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('cmp.comp')}</span>
      {rec.ratio === null ? (
        <span style={{ fontSize: 12.5, color: 'var(--lab-green)' }}>{tr('cmp.comp.none')}</span>
      ) : (
        <div className="row gap16" style={{ flexWrap: 'wrap' }}>
          {(
            [
              [tr('cmp.comp.ratio'), `${fmt(rec.ratio)} : 1`],
              [tr('cmp.comp.threshold'), `${fmt(rec.thresholdDb!)} dB`],
              [tr('cmp.comp.attack'), `${rec.attackMs} ms`],
              [tr('cmp.comp.release'), `${rec.releaseMs} ms`]
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="col" style={{ gap: 2, minWidth: 90 }}>
              <span style={{ fontSize: 11, color: 'var(--text-lo)' }}>{label}</span>
              <span className="mono" style={{ fontSize: 16, color: 'var(--text-hi)' }}>{value}</span>
            </div>
          ))}
        </div>
      )}
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        {tr('cmp.comp.basis')}: ref {rec.refDrDb.toFixed(1)} dB / own {rec.ownDrDb.toFixed(1)} dB · crest ref{' '}
        {rec.refCrestDb.toFixed(1)} / own {rec.ownCrestDb.toFixed(1)} dB
      </span>
    </div>
  )
}
