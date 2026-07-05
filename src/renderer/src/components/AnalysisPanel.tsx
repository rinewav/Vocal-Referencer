/* Analysis charts, log-f axis 20 Hz–20 kHz:
   - SpectrumCompareChart: ref vs own overlaid, auto-scaled to the data
   - EqCurveChart: suggested EQ curve alone (green)
   - DynamicsChart: envelope over time, ref / own / own+suggested comp
   Data colors: --lab-blue (ref), --lab-pink (own), --lab-green (EQ / comped). */
import React, { useEffect, useRef, useState } from 'react'
import { Spectrum, smoothSpectrum, CompRecommendation, simulateComp, EqBandFit, bandsResponseDb } from '../lib/dsp'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'
import { usePrefs } from '../prefs'

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

/* median-normalized smoothed curve, restricted to the display band.
   tiltDbPerOct = analyzer display slope (Pro-Q style), pivoting at 1 kHz. */
function displayCurve(spec: Spectrum, tiltDbPerOct = 0): { f: Float32Array; db: Float32Array } {
  const sm = smoothSpectrum(spec, 6)
  const fs: number[] = []
  const dbs: number[] = []
  for (let k = 1; k < sm.length; k++) {
    const f = (k * spec.sampleRate) / spec.fftSize
    if (f < F_LO || f > F_HI) continue
    fs.push(f)
    dbs.push(sm[k] + tiltDbPerOct * Math.log2(f / 1000))
  }
  const sorted = [...dbs].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  return { f: Float32Array.from(fs), db: Float32Array.from(dbs.map((d) => d - med)) }
}

export function SpectrumCompareChart({ refSpec, ownSpec }: { refSpec: Spectrum; ownSpec: Spectrum }) {
  useLang()
  const { tiltDbPerOct } = usePrefs()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { ctx, W, H } = setupCanvas(canvas)
    drawFreqGrid(ctx, W, H)

    const curves = [displayCurve(refSpec, tiltDbPerOct), displayCurve(ownSpec, tiltDbPerOct)]
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
  }, [refSpec, ownSpec, tiltDbPerOct])

  return (
    <div className="col gap8 grow">
      <Legend items={[[REF_COLOR, tr('cmp.legendRef')], [OWN_COLOR, tr('cmp.legendOwn')]]} />
      <canvas ref={canvasRef} style={{ width: '100%', height: 220, display: 'block' }} />
    </div>
  )
}

export function formatFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`
}

export function EqCurveChart({
  spec,
  eqCurve,
  bands,
  exportName,
  outputGainDb = 0,
  amount,
  onAmountChange,
  remeasuring = false
}: {
  spec: Spectrum
  eqCurve: Float32Array
  bands: EqBandFit[]
  exportName: string
  /* loudness-match gain baked into exported presets (0 = off) */
  outputGainDb?: number
  /* match-EQ apply amount, 0..1 */
  amount: number
  onAmountChange: (v: number) => void
  remeasuring?: boolean
}) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [bandsOpen, setBandsOpen] = useState(false)

  /* close the export menu on any outside click */
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])
  /* screen-space positions of the band markers, rebuilt on each draw */
  const markersRef = useRef<{ x: number; y: number; idx: number }[]>([])
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { ctx, W, H } = setupCanvas(canvas)
    drawFreqGrid(ctx, W, H)

    // fitted-band response, precomputed so the scale can include it
    const N = 240
    const freqs = new Float32Array(N)
    for (let i = 0; i < N; i++) freqs[i] = F_LO * Math.pow(F_HI / F_LO, i / (N - 1))
    const resp = bands.length > 0 ? bandsResponseDb(bands, freqs) : null

    // auto scale: symmetric range covering both curves, min ±6 dB
    let peak = 6
    for (let k = 1; k < eqCurve.length; k++) {
      const f = (k * spec.sampleRate) / spec.fftSize
      if (f < F_LO || f > F_HI) continue
      if (Math.abs(eqCurve[k]) > peak) peak = Math.abs(eqCurve[k])
    }
    if (resp) for (let i = 0; i < N; i++) if (Math.abs(resp[i]) > peak) peak = Math.abs(resp[i])
    const range = Math.ceil(peak + 1)
    const yFor = (db: number) => H / 2 - (db / range) * (H / 2 - 8)

    // zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()

    // ideal match curve (green)
    ctx.strokeStyle = GREEN
    ctx.lineWidth = 2
    ctx.beginPath()
    let started = false
    for (let k = 1; k < eqCurve.length; k++) {
      const f = (k * spec.sampleRate) / spec.fftSize
      if (f < F_LO || f > F_HI) continue
      const x = xForFreq(f, W)
      const y = yFor(eqCurve[k])
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // fitted-band response (what actually lands in the .ffp) — dashed white
    if (resp) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1.3
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const x = xForFreq(freqs[i], W)
        const y = yFor(resp[i])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      // numbered band markers (Pro-Q style points)
      markersRef.current = bands.map((b, i) => ({ x: xForFreq(b.freqHz, W), y: yFor(b.gainDb), idx: i }))
      for (const m of markersRef.current) {
        const active = hover === m.idx
        ctx.beginPath()
        ctx.arc(m.x, m.y, active ? 9 : 7.5, 0, Math.PI * 2)
        ctx.fillStyle = active ? 'oklch(0.85 0.13 150)' : GREEN
        ctx.fill()
        ctx.fillStyle = 'oklch(0.2 0.02 150)'
        ctx.font = '600 9.5px "IBM Plex Mono", monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(m.idx + 1), m.x, m.y + 0.5)
        ctx.textAlign = 'start'
        ctx.textBaseline = 'alphabetic'
      }
    } else {
      markersRef.current = []
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '9.5px "IBM Plex Mono", monospace'
    ctx.fillText(`+${range}`, 2, 10)
    ctx.fillText('0', 2, H / 2 - 3)
    ctx.fillText(`-${range}`, 2, H - 12)
  }, [spec, eqCurve, bands, hover])

  const flash = (key: string) => {
    setSaved(key)
    setTimeout(() => setSaved(null), 2500)
  }
  const doExport = async (kind: 'proq' | 'zleq') => {
    setMenuOpen(false)
    const exp = kind === 'proq' ? window.vr!.exportProQ : window.vr!.exportZlEq
    const name = kind === 'proq' ? `${exportName}.ffp` : `${exportName}.vstpreset`
    const path = await exp(bands, name, outputGainDb)
    if (path) flash(kind)
  }

  const hovered = hover !== null ? bands[hover] : null

  return (
    <div className="col gap8 grow">
      <div className="row gap12" style={{ flexWrap: 'wrap' }}>
        <Legend items={[[GREEN, tr('cmp.eqCurve')], ['rgba(255,255,255,0.55)', tr('cmp.legendFit')]]} />
        <label className="row gap6" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-mid)' }}>
          {tr('cmp.eqAmount')}
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(amount * 100)}
            onChange={(e) => onAmountChange(+e.target.value / 100)}
            style={{ width: 90, accentColor: 'var(--accent)' }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 34, textAlign: 'right' }}>
            {remeasuring ? '…' : `${Math.round(amount * 100)}%`}
          </span>
        </label>
        <div style={{ position: 'relative' }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            className="btn ghost"
            style={{ height: 26, fontSize: 12 }}
            onClick={() => setMenuOpen((v) => !v)}
            disabled={bands.length === 0}
            title={outputGainDb !== 0 ? tr('cmp.bakedGainNote') : undefined}
          >
            <Icon name="download" className="ic-sm" />
            {saved ? tr('cmp.exported') : tr('cmp.export')}
          </button>
          {menuOpen && (
            <div
              className="glass col"
              style={{
                position: 'absolute',
                right: 0,
                top: 30,
                zIndex: 20,
                minWidth: 150,
                padding: 4,
                borderRadius: 10,
                boxShadow: 'var(--shadow-pop)',
                animation: 'pop-in .14s ease'
              }}
            >
              {(
                [
                  ['proq', tr('cmp.exportProq')],
                  ['zleq', tr('cmp.exportZlEq')]
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  className="row gap8"
                  style={{ padding: '8px 10px', borderRadius: 7, fontSize: 12.5, textAlign: 'left' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.07)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => doExport(kind)}
                >
                  <Icon name="download" className="ic-sm" style={{ color: 'var(--text-lo)' }} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 220, display: 'block', cursor: hover !== null ? 'pointer' : 'default' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = e.clientX - rect.left
            const my = e.clientY - rect.top
            let best: number | null = null
            let bestD = 14 // px hit radius
            for (const m of markersRef.current) {
              const d = Math.hypot(m.x - mx, m.y - my)
              if (d < bestD) {
                bestD = d
                best = m.idx
              }
            }
            setHover(best)
          }}
          onMouseLeave={() => setHover(null)}
        />
        {hovered && hover !== null && (
          <div
            className="glass mono"
            style={{
              position: 'absolute',
              left: Math.min(Math.max(markersRef.current[hover]?.x ?? 0, 60), (canvasRef.current?.clientWidth ?? 200) - 60),
              top: Math.max((markersRef.current[hover]?.y ?? 0) - 14, 8),
              transform: 'translate(-50%, -100%)',
              padding: '7px 10px',
              borderRadius: 9,
              fontSize: 11.5,
              lineHeight: 1.6,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              boxShadow: 'var(--shadow-card)',
              zIndex: 5
            }}
          >
            <span style={{ color: 'var(--lab-green)', fontWeight: 600 }}>{hover + 1}</span>
            {' · '}
            {formatFreq(hovered.freqHz)}
            {'  '}
            <span style={{ color: 'var(--text-hi)' }}>{(hovered.gainDb >= 0 ? '+' : '') + hovered.gainDb.toFixed(1)} dB</span>
            {'  Q '}
            {hovered.q.toFixed(2)}
          </div>
        )}
      </div>
      {bands.length > 0 && (
        <div className="col gap6">
          <button
            className="row gap6"
            style={{ fontSize: 11.5, color: 'var(--text-lo)', alignSelf: 'flex-start', padding: '2px 0' }}
            onClick={() => setBandsOpen((v) => !v)}
          >
            <span style={{ display: 'inline-block', transform: bandsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
            {tr('cmp.bands')}
            <span className="mono" style={{ color: 'var(--text-faint)' }}>({bands.length})</span>
          </button>
          {bandsOpen && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {bands.map((b, i) => (
                <span
                  key={i}
                  className="chip mono"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    height: 24,
                    fontSize: 11,
                    cursor: 'default',
                    borderColor: hover === i ? 'var(--accent-line)' : undefined,
                    color: hover === i ? 'var(--text-hi)' : undefined
                  }}
                >
                  <span style={{ color: 'var(--lab-green)', fontWeight: 600 }}>{i + 1}</span>
                  &nbsp;{formatFreq(b.freqHz)}&nbsp;
                  <span style={{ color: b.gainDb >= 0 ? 'var(--lab-green)' : 'var(--lab-pink)' }}>
                    {(b.gainDb >= 0 ? '+' : '') + b.gainDb.toFixed(1)}
                  </span>
                  &nbsp;Q{b.q.toFixed(1)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
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

export interface DynamicsShow {
  ref: boolean
  own: boolean
  comped: boolean
}

export function DynamicsChart({ data, rec, show }: { data: DynamicsData; rec: CompRecommendation; show: DynamicsShow }) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { ctx, W, H } = setupCanvas(canvas)

    const { frameSec, refDb, ownDb, offsetSec } = data
    const comped =
      show.comped && rec.ratio !== null && rec.thresholdDb !== null
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
    if (show.ref) drawEnv(refDb, 0, REF_COLOR)
    if (show.own) drawEnv(ownDb, offsetSec, OWN_COLOR)
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
  }, [data, rec, show])

  return <canvas ref={canvasRef} style={{ width: '100%', height: 160, display: 'block' }} />
}

export function LoudnessCard({
  lufsRef,
  lufsOwn,
  lufsEq,
  lufsProc,
  autoGainDb,
  hasComp
}: {
  lufsRef: number
  lufsOwn: number
  lufsEq: number
  lufsProc: number
  autoGainDb: number
  hasComp: boolean
}) {
  useLang()
  const signed = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1)
  const stat = (label: string, value: string, color = 'var(--text-hi)') => (
    <div key={label} className="col" style={{ gap: 2, minWidth: 110 }}>
      <span style={{ fontSize: 11, color: 'var(--text-lo)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 16, color }}>{value}</span>
    </div>
  )
  return (
    <div className="card col gap10" style={{ padding: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('cmp.loudness')}</span>
      <div className="row gap16" style={{ flexWrap: 'wrap' }}>
        {stat(tr('cmp.lufs.ref'), `${lufsRef.toFixed(1)} LUFS`, REF_COLOR)}
        {stat(tr('cmp.lufs.own'), `${lufsOwn.toFixed(1)} LUFS`, OWN_COLOR)}
        {stat(tr('cmp.lufs.proc'), `${lufsProc.toFixed(1)} LUFS`, GREEN)}
      </div>
      <div className="row gap16" style={{ flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        {stat(tr('cmp.gain.eq'), `${signed(lufsEq - lufsOwn)} dB`)}
        {hasComp && stat(tr('cmp.gain.comp'), `${signed(lufsProc - lufsEq)} dB`)}
        {stat(tr('cmp.gain.auto'), `${signed(autoGainDb)} dB`, 'var(--accent-hi)')}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>{tr('cmp.gain.hint')}</span>
    </div>
  )
}

export function CompCard({ rec, dynamics }: { rec: CompRecommendation; dynamics: DynamicsData | null }) {
  useLang()
  const fmt = (v: number) => v.toFixed(1)
  /* graph curve visibility — the suggested-comp overlay is opt-in */
  const [show, setShow] = useState<DynamicsShow>({ ref: true, own: true, comped: false })
  const toggles: [keyof DynamicsShow, string, string][] = [
    ['ref', REF_COLOR, tr('cmp.legendRef')],
    ['own', OWN_COLOR, tr('cmp.legendOwn')]
  ]
  if (rec.ratio !== null) toggles.push(['comped', GREEN, tr('cmp.legendComp')])
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
      {dynamics && (
        <div className="col gap8">
          <div className="row gap6" style={{ flexWrap: 'wrap' }}>
            {toggles.map(([key, color, label]) => (
              <button
                key={key}
                className={'chip' + (show[key] ? ' on' : '')}
                style={{ height: 24, fontSize: 11.5 }}
                onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
              >
                <span className="dot" style={{ background: color, opacity: show[key] ? 1 : 0.35 }} />
                {label}
              </button>
            ))}
          </div>
          <DynamicsChart data={dynamics} rec={rec} show={show} />
        </div>
      )}
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        {tr('cmp.comp.basis')}: ref {rec.refDrDb.toFixed(1)} dB / own {rec.ownDrDb.toFixed(1)} dB · crest ref{' '}
        {rec.refCrestDb.toFixed(1)} / own {rec.ownCrestDb.toFixed(1)} dB
      </span>
    </div>
  )
}
