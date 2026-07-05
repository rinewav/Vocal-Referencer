/* Compare view: synced A/B playback of the reference stem vs the user's
   vocal, waveform alignment (auto cross-correlation + drag), loudness-matched
   switching, spectrum/EQ/compressor analysis, and a processing preview that
   plays the own vocal through the suggested EQ (FIR convolver) + compressor. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Song, StemRef, loadAudioBuffer, audioContext, renderProcessed } from '../lib/audio'
import {
  averageSpectrum,
  eqMatchCurve,
  eqCurveToFir,
  integratedLufs,
  detectOffset,
  toMono,
  compRecommendation,
  envelopeSeriesDb,
  fitParametricBands,
  EqBandFit,
  Spectrum,
  CompRecommendation
} from '../lib/dsp'
import { Waveform } from './Waveform'
import { SpectrumCompareChart, EqCurveChart, CompCard, LoudnessCard, DynamicsData } from './AnalysisPanel'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'
import { usePrefs, PrefsStore } from '../prefs'
import { registerReference } from '../lib/refimport'

interface Analysis {
  lufsRef: number
  lufsOwn: number
  /* measured LUFS of the own vocal rendered through EQ only / EQ+comp */
  lufsEq: number
  lufsProc: number
  /* gain that makes the processed own vocal land on the reference loudness */
  autoGainDb: number
  refSpec: Spectrum
  ownSpec: Spectrum
  eqCurve: Float32Array
  eqBands: EqBandFit[]
  comp: CompRecommendation
  dynamics: DynamicsData
}

type Stage = 'align' | 'lufs' | 'spectrum' | 'comp' | 'render'

const nextTick = () => new Promise((r) => setTimeout(r, 0))
const FIR_TAPS = 4096
const CACHE_V = 1

/* ---------- analysis cache (SQLite via main, keyed by stem pair) ---------- */

const f32 = (a: number[]) => Float32Array.from(a)

function serializeAnalysis(a: Analysis, offsetSec: number): string {
  return JSON.stringify({
    v: CACHE_V,
    offsetSec,
    lufsRef: a.lufsRef,
    lufsOwn: a.lufsOwn,
    lufsEq: a.lufsEq,
    lufsProc: a.lufsProc,
    autoGainDb: a.autoGainDb,
    refSpec: { db: Array.from(a.refSpec.db), sampleRate: a.refSpec.sampleRate, fftSize: a.refSpec.fftSize },
    ownSpec: { db: Array.from(a.ownSpec.db), sampleRate: a.ownSpec.sampleRate, fftSize: a.ownSpec.fftSize },
    eqCurve: Array.from(a.eqCurve),
    eqBands: a.eqBands,
    comp: a.comp,
    dynamics: {
      frameSec: a.dynamics.frameSec,
      refDb: Array.from(a.dynamics.refDb),
      ownDb: Array.from(a.dynamics.ownDb)
    }
  })
}

function deserializeAnalysis(json: string): { analysis: Analysis; offsetSec: number } | null {
  try {
    const d = JSON.parse(json)
    if (d.v !== CACHE_V) return null
    const analysis: Analysis = {
      lufsRef: d.lufsRef,
      lufsOwn: d.lufsOwn,
      lufsEq: d.lufsEq,
      lufsProc: d.lufsProc,
      autoGainDb: d.autoGainDb,
      refSpec: { db: f32(d.refSpec.db), sampleRate: d.refSpec.sampleRate, fftSize: d.refSpec.fftSize },
      ownSpec: { db: f32(d.ownSpec.db), sampleRate: d.ownSpec.sampleRate, fftSize: d.ownSpec.fftSize },
      eqCurve: f32(d.eqCurve),
      eqBands: d.eqBands,
      comp: d.comp,
      dynamics: { frameSec: d.dynamics.frameSec, refDb: f32(d.dynamics.refDb), ownDb: f32(d.dynamics.ownDb), offsetSec: d.offsetSec }
    }
    return { analysis, offsetSec: d.offsetSec }
  } catch {
    return null
  }
}

export function CompareView({ song, reload }: { song: Song; reload: () => void }) {
  useLang()
  const refCandidates = song.stems.filter((s) => s.kind === 'lead' || s.kind === 'vocals')
  const ownCandidates = song.stems.filter((s) => s.kind === 'own')
  const [refStem, setRefStem] = useState<StemRef | undefined>(refCandidates[0])
  const [ownStem, setOwnStem] = useState<StemRef | undefined>(ownCandidates[0])

  /* stems can arrive later (registration from this view, separation finishing) */
  useEffect(() => {
    if (!refStem && refCandidates.length > 0) setRefStem(refCandidates[0])
    if (!ownStem && ownCandidates.length > 0) setOwnStem(ownCandidates[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song])

  const [refBuf, setRefBuf] = useState<AudioBuffer | null>(null)
  const [ownBuf, setOwnBuf] = useState<AudioBuffer | null>(null)
  const [offsetSec, setOffsetSec] = useState(0)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState<Stage>('align')
  const [error, setError] = useState<string | null>(null)
  const { monitorDb, bakeGain } = usePrefs()

  const [playing, setPlaying] = useState(false)
  const [listenOwn, setListenOwn] = useState(false)
  const [loudnessMatch, setLoudnessMatch] = useState(true)
  const [simulate, setSimulate] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [loop, setLoop] = useState<{ a: number; b: number } | null>(null)
  const loopRef = useRef<{ a: number; b: number } | null>(null)
  useEffect(() => {
    loopRef.current = loop && loop.b - loop.a > 0.2 ? loop : null
  }, [loop])

  const firRef = useRef<Float32Array | null>(null)
  const graphRef = useRef<{
    refSrc: AudioBufferSourceNode
    ownSrc: AudioBufferSourceNode | null
    refGain: GainNode
    ownGain: GainNode
    masterGain: GainNode
    startCtxTime: number
    startPos: number
    simulated: boolean
  } | null>(null)
  const rafRef = useRef(0)

  /* monitor volume: live-apply to the playing graph, never touches analysis */
  useEffect(() => {
    const g = graphRef.current
    if (g) g.masterGain.gain.setTargetAtTime(Math.pow(10, monitorDb / 20), audioContext().currentTime, 0.01)
  }, [monitorDb])

  /* ---------- load + analyze ---------- */
  useEffect(() => {
    if (!refStem || !ownStem) return
    let canceled = false
    ;(async () => {
      setLoading(true)
      setStage('align')
      setError(null)
      setAnalysis(null)
      firRef.current = null
      try {
        const cacheKey = `${refStem.id}|${ownStem.id}`
        const [ref, own] = await Promise.all([loadAudioBuffer(refStem.path), loadAudioBuffer(ownStem.path)])
        if (canceled) return
        setRefBuf(ref)
        setOwnBuf(own)

        /* cached pair → restore instantly (only the FIR needs rebuilding) */
        const cachedJson = window.vr ? await window.vr.cache.get(cacheKey) : null
        if (cachedJson && !canceled) {
          const cached = deserializeAnalysis(cachedJson)
          if (cached) {
            setOffsetSec(cached.offsetSec)
            firRef.current = eqCurveToFir(cached.analysis.eqCurve, FIR_TAPS)
            setAnalysis(cached.analysis)
            setLoading(false)
            return
          }
        }

        const refMono = toMono(ref)
        const ownMono = toMono(own)
        await nextTick()
        const offset = detectOffset(refMono, ownMono, ref.sampleRate)
        if (canceled) return
        setOffsetSec(offset)
        setStage('lufs')
        await nextTick()
        const lufsRef = integratedLufs(ref)
        await nextTick()
        const lufsOwn = integratedLufs(own)
        setStage('spectrum')
        await nextTick()
        const refSpec = averageSpectrum(refMono, ref.sampleRate)
        await nextTick()
        const ownSpec = averageSpectrum(ownMono, own.sampleRate)
        const eqCurve = eqMatchCurve(refSpec, ownSpec)
        const eqBands = fitParametricBands(eqCurve, refSpec)
        setStage('comp')
        await nextTick()
        const comp = compRecommendation(refMono, ownMono, ref.sampleRate)
        const refEnv = envelopeSeriesDb(refMono, ref.sampleRate)
        const ownEnv = envelopeSeriesDb(ownMono, own.sampleRate)
        const dynamics: DynamicsData = {
          frameSec: refEnv.frameSec,
          refDb: refEnv.db,
          ownDb: ownEnv.db,
          offsetSec: offset
        }
        /* measured loudness through the suggested chain (same nodes as the
           live simulate graph) → exact auto gain, EQ/comp contributions */
        setStage('render')
        await nextTick()
        const fir = eqCurveToFir(eqCurve, FIR_TAPS)
        firRef.current = fir
        const compParams =
          comp.ratio !== null && comp.thresholdDb !== null
            ? { thresholdDb: comp.thresholdDb, ratio: comp.ratio, attackMs: comp.attackMs, releaseMs: comp.releaseMs }
            : null
        const eqOnly = await renderProcessed(own, fir, null)
        if (canceled) return
        const lufsEq = integratedLufs(eqOnly)
        const processed = compParams ? await renderProcessed(own, fir, compParams) : eqOnly
        if (canceled) return
        const lufsProc = compParams ? integratedLufs(processed) : lufsEq
        const autoGainDb = lufsRef - lufsProc
        if (canceled) return
        const result: Analysis = { lufsRef, lufsOwn, lufsEq, lufsProc, autoGainDb, refSpec, ownSpec, eqCurve, eqBands, comp, dynamics }
        setAnalysis(result)
        if (window.vr) void window.vr.cache.set(cacheKey, song.id, serializeAnalysis(result, offset))
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => {
      canceled = true
    }
  }, [refStem?.id, ownStem?.id])

  /* keep the dynamics chart's offset in sync with manual nudges */
  useEffect(() => {
    setAnalysis((a) => (a && a.dynamics.offsetSec !== offsetSec ? { ...a, dynamics: { ...a.dynamics, offsetSec } } : a))
  }, [offsetSec])

  /* ---------- playback ---------- */
  const stop = useCallback(() => {
    const g = graphRef.current
    if (g) {
      try {
        g.refSrc.stop()
        g.ownSrc?.stop()
      } catch {
        /* already stopped */
      }
      graphRef.current = null
    }
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
  }, [])

  const ownGainValue = useCallback(
    (listen: boolean, simulated: boolean) => {
      if (!listen) return 0.0001
      let db = 0
      // loudness match: raw own → static LUFS diff; processed own → measured
      // post-chain correction (covers EQ energy shift + comp makeup)
      if (loudnessMatch && analysis) db += simulated ? analysis.autoGainDb : analysis.lufsRef - analysis.lufsOwn
      return Math.pow(10, db / 20)
    },
    [loudnessMatch, analysis]
  )

  const play = useCallback(
    (fromSec: number) => {
      if (!refBuf || !ownBuf) return
      stop()
      const ctx = audioContext()
      ctx.resume()
      const masterGain = ctx.createGain()
      masterGain.gain.value = Math.pow(10, monitorDb / 20)
      masterGain.connect(ctx.destination)
      const refSrc = ctx.createBufferSource()
      refSrc.buffer = refBuf
      const refGain = ctx.createGain()
      refSrc.connect(refGain).connect(masterGain)

      const ownSrc = ctx.createBufferSource()
      ownSrc.buffer = ownBuf
      const ownGain = ctx.createGain()
      const simulated = simulate && !!analysis
      let ownLatency = 0
      let head: AudioNode = ownSrc
      if (simulated) {
        // suggested EQ as a linear-phase FIR convolver
        if (!firRef.current) firRef.current = eqCurveToFir(analysis!.eqCurve, FIR_TAPS)
        const fir = firRef.current
        const irBuf = ctx.createBuffer(1, fir.length, ctx.sampleRate)
        irBuf.copyToChannel(fir as Float32Array<ArrayBuffer>, 0)
        const conv = ctx.createConvolver()
        conv.normalize = false
        conv.buffer = irBuf
        head.connect(conv)
        head = conv
        ownLatency += FIR_TAPS / 2 / ctx.sampleRate
        // suggested compressor
        const rec = analysis!.comp
        if (rec.ratio !== null && rec.thresholdDb !== null) {
          const comp = ctx.createDynamicsCompressor()
          comp.threshold.value = Math.max(-100, rec.thresholdDb)
          comp.ratio.value = Math.min(20, rec.ratio)
          comp.knee.value = 6
          comp.attack.value = rec.attackMs / 1000
          comp.release.value = rec.releaseMs / 1000
          head.connect(comp)
          head = comp
        }
      }
      head.connect(ownGain).connect(masterGain)
      refGain.gain.value = listenOwn ? 0.0001 : 1
      ownGain.gain.value = ownGainValue(listenOwn, simulated)

      const t0 = ctx.currentTime + 0.05
      refSrc.start(t0, fromSec)
      // own timeline position = timeline − offset; FIR delay starts it earlier
      const ownPos = fromSec - offsetSec + ownLatency
      if (ownPos >= 0 && ownPos < ownBuf.duration) ownSrc.start(t0, ownPos)
      else if (ownPos < 0) ownSrc.start(t0 - ownPos, 0)
      graphRef.current = { refSrc, ownSrc, refGain, ownGain, masterGain, startCtxTime: t0, startPos: fromSec, simulated }
      refSrc.onended = () => {
        if (graphRef.current?.refSrc === refSrc) stop()
      }
      setPlaying(true)
      const tick = () => {
        const g = graphRef.current
        if (!g) return
        const pos = g.startPos + Math.max(0, ctx.currentTime - g.startCtxTime)
        const lp = loopRef.current
        if (lp && pos >= lp.b) {
          play(lp.a)
          return
        }
        setPlayhead(pos)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [refBuf, ownBuf, offsetSec, listenOwn, simulate, analysis, ownGainValue, stop, monitorDb]
  )

  /* A/B switch on the live graph (10 ms ramp — no click) */
  const setListen = useCallback(
    (own: boolean) => {
      setListenOwn(own)
      const g = graphRef.current
      if (g) {
        const t = audioContext().currentTime
        g.refGain.gain.setTargetAtTime(own ? 0.0001 : 1, t, 0.01)
        g.ownGain.gain.setTargetAtTime(ownGainValue(own, g.simulated), t, 0.01)
      }
    },
    [ownGainValue]
  )

  /* toggling simulate mid-play rebuilds the graph at the current position */
  const toggleSimulate = useCallback(() => {
    setSimulate((v) => !v)
  }, [])
  useEffect(() => {
    if (playing && graphRef.current && graphRef.current.simulated !== (simulate && !!analysis)) {
      play(playhead ?? 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulate])

  useEffect(() => stop, [stop, refStem?.id, ownStem?.id])

  /* keyboard: Space = play/stop, Tab = A/B */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (playing) stop()
        else play(playhead ?? loop?.a ?? 0)
      } else if (e.code === 'Tab') {
        e.preventDefault()
        setListen(!listenOwn)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, playhead, listenOwn, play, stop, setListen, loop])

  if (!refStem || !ownStem) {
    const hasRefSource = !!song.src_path
    const pickAndRegisterRef = async () => {
      const picked = await window.vr!.pickAudio(false)
      if (picked?.[0]) {
        await registerReference(song.id, picked[0]).catch(() => {})
        reload()
      }
    }
    const pickAndAddOwn = async () => {
      const picked = await window.vr!.pickAudio(false)
      if (picked?.[0]) {
        await window.vr!.library.addOwn(song.id, picked[0])
        reload()
      }
    }
    const row = (color: string, label: string, done: boolean, doneLabel: string, action?: { label: string; onClick: () => void }) => (
      <div className="row gap10" style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)', width: '100%' }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 13, color: 'var(--text-mid)', minWidth: 130 }}>{label}</span>
        <span style={{ fontSize: 12.5, color: done ? 'var(--lab-green)' : 'var(--text-faint)' }}>
          {done ? doneLabel : tr('lib.notSet')}
        </span>
        {action && (
          <button className="btn" style={{ height: 28, fontSize: 12, marginLeft: 'auto' }} onClick={action.onClick}>
            <Icon name="plus" className="ic-sm" />
            {action.label}
          </button>
        )}
      </div>
    )
    return (
      <div className="row grow" style={{ justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <div className="card col gap10" style={{ padding: 22, width: 520, maxWidth: '92%', animation: 'view-in .3s ease both' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>{song.title}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-mid)', lineHeight: 1.6 }}>{tr('cmp.setupHint')}</span>
          {row(
            'var(--lab-blue)',
            tr('lib.ref'),
            hasRefSource,
            song.src_path.split('/').pop() ?? '',
            hasRefSource ? undefined : { label: tr('lib.setRef'), onClick: pickAndRegisterRef }
          )}
          {hasRefSource &&
            row(
              'var(--lab-teal)',
              tr('cmp.sepStatus'),
              refCandidates.length > 0,
              tr('cmp.sepDone'),
              refCandidates.length > 0
                ? undefined
                : { label: tr('lib.separate'), onClick: () => void window.vr!.separate.start(song.id, 'vocal') }
            )}
          {row(
            'var(--lab-pink)',
            tr('lib.own'),
            ownCandidates.length > 0,
            ownCandidates[ownCandidates.length - 1]?.label ?? '',
            { label: tr('lib.addOwn'), onClick: pickAndAddOwn }
          )}
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>{tr('cmp.sepNote')}</span>
        </div>
      </div>
    )
  }

  const timelineSec = Math.max(refBuf?.duration ?? 1, (ownBuf?.duration ?? 1) + Math.max(0, offsetSec))
  const stemLabel = (s: StemRef) => tr('stem.' + s.kind) + (s.label ? ` · ${s.label}` : '')

  return (
    <div className="col gap12 grow" style={{ padding: '14px 16px', overflowY: 'auto', minHeight: 0 }}>
      {/* header: song + stem pickers */}
      <div className="row gap10" style={{ flexWrap: 'wrap', animation: 'view-in .3s ease both' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>{song.title}</span>
        <div className="row gap6" style={{ marginLeft: 'auto' }}>
          {refCandidates.map((s) => (
            <button key={s.id} className={'chip' + (refStem.id === s.id ? ' on' : '')} onClick={() => setRefStem(s)}>
              {stemLabel(s)}
            </button>
          ))}
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>vs</span>
          {ownCandidates.map((s) => (
            <button key={s.id} className={'chip' + (ownStem.id === s.id ? ' on' : '')} onClick={() => setOwnStem(s)}>
              {stemLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {/* waveforms */}
      {refBuf && ownBuf ? (
        <div className="card col gap8" style={{ padding: 12, animation: 'view-in .3s ease both', animationDelay: '60ms' }}>
          <div className="row gap8" style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>
            <span className="dot" style={{ background: 'var(--lab-blue)' }} />
            {tr('cmp.refTrack')}
          </div>
          <Waveform
            buffer={refBuf}
            color="oklch(0.70 0.14 255 / 0.85)"
            timelineSec={timelineSec}
            playheadSec={playhead}
            onSeek={(s) => (playing ? play(s) : setPlayhead(s))}
            loopRange={loop}
            onSelectRange={(a, b) => setLoop({ a, b })}
          />
          <Waveform
            buffer={ownBuf}
            color="oklch(0.73 0.16 350 / 0.85)"
            offsetSec={offsetSec}
            timelineSec={timelineSec}
            playheadSec={playhead}
            onSeek={(s) => (playing ? play(s) : setPlayhead(s))}
            onDragOffset={(d) => setOffsetSec((o) => o + d)}
            loopRange={loop}
          />
          <div className="row gap8" style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>
            <span className="dot" style={{ background: 'var(--lab-pink)' }} />
            {tr('cmp.ownTrack')}
            <span style={{ marginLeft: 'auto' }} className="row gap6">
              <span style={{ color: 'var(--text-lo)' }}>{tr('cmp.offset')}</span>
              <button className="chip" onClick={() => setOffsetSec((o) => o - 0.01)}>-10ms</button>
              <span className="mono" style={{ minWidth: 76, textAlign: 'center' }}>{(offsetSec * 1000).toFixed(1)} ms</span>
              <button className="chip" onClick={() => setOffsetSec((o) => o + 0.01)}>+10ms</button>
              <button
                className="btn ghost"
                style={{ height: 26, fontSize: 12 }}
                onClick={async () => {
                  if (!refBuf || !ownBuf) return
                  setLoading(true)
                  await nextTick()
                  setOffsetSec(detectOffset(toMono(refBuf), toMono(ownBuf), refBuf.sampleRate))
                  setLoading(false)
                }}
              >
                {tr('cmp.autoAlign')}
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {/* transport */}
      <div className="row gap10" style={{ flexWrap: 'wrap', animation: 'view-in .3s ease both', animationDelay: '120ms' }}>
        <button className="btn primary" style={{ width: 110 }} onClick={() => (playing ? stop() : play(playhead ?? 0))}>
          <Icon name={playing ? 'stop' : 'play'} className="ic-sm" />
          {playing ? tr('cmp.stop') : tr('cmp.play')}
        </button>
        <button className={'chip' + (!listenOwn ? ' on' : '')} style={{ height: 34, padding: '0 16px' }} onClick={() => setListen(false)}>
          A · {tr('cmp.legendRef')}
        </button>
        <button className={'chip' + (listenOwn ? ' on' : '')} style={{ height: 34, padding: '0 16px' }} onClick={() => setListen(true)}>
          B · {tr('cmp.legendOwn')}
        </button>
        <label className="row gap8" style={{ fontSize: 12.5, color: 'var(--text-mid)', cursor: 'pointer' }}>
          {tr('cmp.simulate')}
          <button className={'cv-toggle' + (simulate ? ' on' : '')} onClick={toggleSimulate} disabled={!analysis}>
            <span className="knob" />
          </button>
        </label>
        {loop && (
          <span className="chip on mono" style={{ height: 28, fontSize: 11.5 }}>
            {tr('cmp.loop')} {loop.a.toFixed(1)}–{loop.b.toFixed(1)}s
            <button
              title={tr('cmp.loopClear')}
              style={{ display: 'inline-flex', marginLeft: 6, color: 'inherit' }}
              onClick={() => setLoop(null)}
            >
              <Icon name="x" style={{ width: 11, height: 11 }} />
            </button>
          </span>
        )}
        <label className="row gap8" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-mid)', cursor: 'pointer' }}>
          {tr('cmp.loudnessMatch')}
          {analysis && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {(simulate
                ? (analysis.autoGainDb >= 0 ? '+' : '') + analysis.autoGainDb.toFixed(1)
                : (analysis.lufsRef - analysis.lufsOwn >= 0 ? '+' : '') + (analysis.lufsRef - analysis.lufsOwn).toFixed(1))} dB
            </span>
          )}
          <button className={'cv-toggle' + (loudnessMatch ? ' on' : '')} onClick={() => setLoudnessMatch((v) => !v)}>
            <span className="knob" />
          </button>
        </label>
        <label className="row gap6" title={tr('cmp.monitor')} style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>
          <Icon name="volume" className="ic-sm" />
          <input
            type="range"
            min={-24}
            max={6}
            step={1}
            value={monitorDb}
            onChange={(e) => PrefsStore.set({ monitorDb: +e.target.value })}
            style={{ width: 90, accentColor: 'var(--accent)' }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 42, textAlign: 'right' }}>
            {(monitorDb >= 0 ? '+' : '') + monitorDb} dB
          </span>
        </label>
      </div>

      {/* analysis */}
      {loading && (
        <div className="col gap8">
          <span style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>
            {tr('cmp.loading')} <span style={{ color: 'var(--text-faint)' }}>· {tr('cmp.stage.' + stage)}</span>
          </span>
          <div className="indet" style={{ width: '100%' }} />
        </div>
      )}
      {error && <span style={{ fontSize: 12.5, color: 'var(--lab-red)' }}>{error}</span>}
      {analysis && (
        <>
          <div className="row gap12" style={{ alignItems: 'stretch', flexWrap: 'wrap', animation: 'view-in .3s ease both' }}>
            <div className="card grow" style={{ padding: 14, minWidth: 380 }}>
              <SpectrumCompareChart refSpec={analysis.refSpec} ownSpec={analysis.ownSpec} />
            </div>
            <div className="card grow" style={{ padding: 14, minWidth: 380 }}>
              <EqCurveChart
                spec={analysis.refSpec}
                eqCurve={analysis.eqCurve}
                bands={analysis.eqBands}
                exportName={`${song.title} EQ match`}
                outputGainDb={bakeGain ? analysis.autoGainDb : 0}
              />
            </div>
          </div>
          <div style={{ animation: 'view-in .3s ease both', animationDelay: '60ms' }}>
            <LoudnessCard
              lufsRef={analysis.lufsRef}
              lufsOwn={analysis.lufsOwn}
              lufsEq={analysis.lufsEq}
              lufsProc={analysis.lufsProc}
              autoGainDb={analysis.autoGainDb}
              hasComp={analysis.comp.ratio !== null}
            />
          </div>
          <div style={{ animation: 'view-in .3s ease both', animationDelay: '80ms' }}>
            <CompCard rec={analysis.comp} dynamics={analysis.dynamics} exportName={`${song.title} comp match`} />
          </div>
        </>
      )}
    </div>
  )
}
