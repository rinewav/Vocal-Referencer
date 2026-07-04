/* Analysis charts, log-f axis 20 Hz–20 kHz:
   - SpectrumCompareChart: ref vs own overlaid, auto-scaled to the data
   - EqCurveChart: suggested EQ curve alone (green)
   - DynamicsChart: envelope over time, ref / own / own+suggested comp
   Data colors: --lab-blue (ref), --lab-pink (own), --lab-green (EQ / comped). */
import React, { useEffect, useRef } from 'react'
import { Spectrum, smoothSpectrum, CompRecommendation, simulateComp } from '../lib/dsp'
import { tr, useLang } from '../i18n'

const F_LO = 20
const F_HI = 20000
const REF_COLOR = 'oklch(0.70 0.14 255)' // --lab-blue
const OWN_COLOR = 'oklch(0.73 0.16 350)' // --lab-pink
const GREEN = 'oklch(0.76 0.13 150)' // --lab-green

function xForFreq(f: number, width: number): number {
  return (Math.log10(f / F_LO) / Math.log10(F_HI / F_LO)) * width
}

function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; W: number; H: number } {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)
  return { ctx, W, H }
}

function drawFreqGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
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
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="row gap12" style={{ fontSize: 11.5, flexWrap: 'wrap' }}>
      {items.map(([color, label]) => (
        <span key={label} className="row gap6" style={{ color: 'var(--text-mid)' }}>
          <span className="dot" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}

/* median-normalized smoothed curve, restricted to the display band */
function displayCurve(spec: Spectrum): { f: Float32Array; db: Float32Array } {
  const sm = smoothSpectrum(spec, 6)
  const fs: number[] = []
  const dbs: number[] = []
  for (let k = 1; k < sm.length; k++) {
    const f = (k * spec.sampleRate) / spec.fftSize
    if (f < F_LO || f > F_HI) continue
    fs.push(f)
    dbs.push(sm[k])
  }
  const sorted = [...dbs].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  return { f: Float32Array.from(fs), db: Float32Array.from(dbs.map((d) => d - med)) }
}

export function SpectrumCompareChart({ refSpec, ownSpec }: { refSpec: Spectrum; ownSpec: Spectrum }) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { ctx, W, H } = setupCanvas(canvas)
    drawFreqGrid(ctx, W, H)

    const curves = [displayCurve(refSpec), displayCurve(ownSpec)]
    // shared auto-scale over both curves so nothing clips off the panel
    let lo = Infinity
    let hi = -Infinity
    for (const c of curves)
      for (const d of c.db) {
        if (d < lo) lo = d
        if (d > hi) hi = d
      }
    const pad = 4
    lo -= pad
    hi += pad
    const yFor = (d: number) => H - ((d - lo) / (hi - lo)) * H

    curves.forEach((curve, i) => {
      ctx.strokeStyle = i === 0 ? REF_COLOR : OWN_COLOR
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let k = 0; k < curve.f.length; k++) {
        const x = xForFreq(curve.f[k], W)
        const y = yFor(curve.db[k])
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })
  }, [refSpec, ownSpec])

  return (
    <div className="col gap8 grow">
      <Legend items={[[REF_COLOR, tr('cmp.legendRef')], [OWN_COLOR, tr('cmp.legendOwn')]]} />
      <canvas ref={canvasRef} style={{ width: '100%', height: 220, display: 'block' }} />
    </div>
  )
}

export function EqCurveChart({ spec, eqCurve }: { spec: Spectrum; eqCurve: Float32Array }) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { ctx, W, H } = setupCanvas(canvas)
    drawFreqGrid(ctx, W, H)

    // zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()

    ctx.strokeStyle = GREEN
    ctx.lineWidth = 2
    ctx.beginPath()
    let started = false
    for (let k = 1; k < eqCurve.length; k++) {
      const f = (k * spec.sampleRate) / spec.fftSize
      if (f < F_LO || f > F_HI) continue
      const x = xForFreq(f, W)
      const y = H / 2 - (eqCurve[k] / 12) * (H / 2 - 8)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '9.5px "IBM Plex Mono", monospace'
    ctx.fillText('+12', 2, 10)
    ctx.fillText('0', 2, H / 2 - 3)
    ctx.fillText('-12', 2, H - 12)
  }, [spec, eqCurve])

  return (
    <div className="col gap8 grow">
      <Legend items={[[GREEN, tr('cmp.eqCurve')]]} />
      <canvas ref={canvasRef} style={{ width: '100%', height: 220, display: 'block' }} />
    </div>
  )
}

export interface DynamicsData {
  frameSec: number
  refDb: Float32Array
  ownDb: Float32Array
  /* seconds the own envelope is delayed on the shared timeline */
  offsetSec: number
}

export function DynamicsChart({ data, rec }: { data: DynamicsData; rec: CompRecommendation }) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { ctx, W, H } = setupCanvas(canvas)

    const { frameSec, refDb, ownDb, offsetSec } = data
    const comped =
      rec.ratio !== null && rec.thresholdDb !== null
        ? simulateComp(ownDb, frameSec, rec.thresholdDb, rec.ratio, rec.attackMs, rec.releaseMs)
        : null

    const timelineSec = Math.max(refDb.length * frameSec, ownDb.length * frameSec + Math.max(0, offsetSec))
    const DB_LO = -60
    const DB_HI = 0
    const yFor = (d: number) => H - ((Math.max(DB_LO, Math.min(DB_HI, d)) - DB_LO) / (DB_HI - DB_LO)) * H

    // grid: time每30s + dB lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '9.5px "IBM Plex Mono", monospace'
    for (let s = 30; s < timelineSec; s += 30) {
      const x = (s / timelineSec) * W
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
      ctx.fillText(`${s}s`, x + 3, H - 3)
    }
    for (const d of [-12, -24, -36, -48]) {
      const y = yFor(d)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
      ctx.fillText(`${d}`, 2, y - 2)
    }

    const drawEnv = (env: Float32Array, delaySec: number, color: string, width = 1.4) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      let started = false
      for (let i = 0; i < env.length; i++) {
        if (env[i] <= -79) {
          started = false
          continue
        }
        const x = (((i * frameSec + delaySec) / timelineSec) * W)
        const y = yFor(env[i])
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    drawEnv(refDb, 0, REF_COLOR)
    drawEnv(ownDb, offsetSec, OWN_COLOR)
    if (comped) drawEnv(comped, offsetSec, GREEN, 1.8)

    // threshold marker
    if (rec.thresholdDb !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(0, yFor(rec.thresholdDb))
      ctx.lineTo(W, yFor(rec.thresholdDb))
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [data, rec])

  const legend: [string, string][] = [
    [REF_COLOR, tr('cmp.legendRef')],
    [OWN_COLOR, tr('cmp.legendOwn')]
  ]
  if (rec.ratio !== null) legend.push([GREEN, tr('cmp.legendComp')])

  return (
    <div className="col gap8">
      <Legend items={legend} />
      <canvas ref={canvasRef} style={{ width: '100%', height: 160, display: 'block' }} />
    </div>
  )
}

export function CompCard({ rec, dynamics }: { rec: CompRecommendation; dynamics: DynamicsData | null }) {
  useLang()
  const fmt = (v: number) => v.toFixed(1)
  return (
    <div className="card col gap10" style={{ padding: 14 }}>
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
      {dynamics && <DynamicsChart data={dynamics} rec={rec} />}
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        {tr('cmp.comp.basis')}: ref {rec.refDrDb.toFixed(1)} dB / own {rec.ownDrDb.toFixed(1)} dB · crest ref{' '}
        {rec.refCrestDb.toFixed(1)} / own {rec.ownCrestDb.toFixed(1)} dB
      </span>
    </div>
  )
}
