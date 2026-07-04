/* Compare view: synced A/B playback of the reference stem vs the user's
   vocal, waveform alignment (auto cross-correlation + drag), loudness-matched
   switching, spectrum/EQ/compressor analysis. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Song, StemRef, loadAudioBuffer, audioContext } from '../lib/audio'
import { averageSpectrum, eqMatchCurve, integratedLufs, detectOffset, toMono, compRecommendation, Spectrum, CompRecommendation } from '../lib/dsp'
import { Waveform } from './Waveform'
import { SpectrumChart, CompCard } from './AnalysisPanel'
import { Icon } from './Icon'
import { tr, useLang } from '../i18n'

interface Analysis {
  lufsRef: number
  lufsOwn: number
  refSpec: Spectrum
  ownSpec: Spectrum
  eqCurve: Float32Array
  comp: CompRecommendation
}

const nextTick = () => new Promise((r) => setTimeout(r, 0))

export function CompareView({ song }: { song: Song }) {
  useLang()
  const refCandidates = song.stems.filter((s) => s.kind === 'lead' || s.kind === 'vocals')
  const ownCandidates = song.stems.filter((s) => s.kind === 'own')
  const [refStem, setRefStem] = useState<StemRef | undefined>(refCandidates[0])
  const [ownStem, setOwnStem] = useState<StemRef | undefined>(ownCandidates[0])

  const [refBuf, setRefBuf] = useState<AudioBuffer | null>(null)
  const [ownBuf, setOwnBuf] = useState<AudioBuffer | null>(null)
  const [offsetSec, setOffsetSec] = useState(0)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [playing, setPlaying] = useState(false)
  const [listenOwn, setListenOwn] = useState(false)
  const [loudnessMatch, setLoudnessMatch] = useState(true)
  const [playhead, setPlayhead] = useState<number | null>(null)

  const graphRef = useRef<{
    refSrc: AudioBufferSourceNode
    ownSrc: AudioBufferSourceNode | null
    refGain: GainNode
    ownGain: GainNode
    startCtxTime: number
    startPos: number
  } | null>(null)
  const rafRef = useRef(0)

  /* ---------- load + analyze ---------- */
  useEffect(() => {
    if (!refStem || !ownStem) return
    let canceled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      setAnalysis(null)
      try {
        const [ref, own] = await Promise.all([loadAudioBuffer(refStem.path), loadAudioBuffer(ownStem.path)])
        if (canceled) return
        setRefBuf(ref)
        setOwnBuf(own)
        const refMono = toMono(ref)
        const ownMono = toMono(own)
        await nextTick()
        const offset = detectOffset(refMono, ownMono, ref.sampleRate)
        if (canceled) return
        setOffsetSec(offset)
        await nextTick()
        const lufsRef = integratedLufs(ref)
        await nextTick()
        const lufsOwn = integratedLufs(own)
        await nextTick()
        const refSpec = averageSpectrum(refMono, ref.sampleRate)
        await nextTick()
        const ownSpec = averageSpectrum(ownMono, own.sampleRate)
        const eqCurve = eqMatchCurve(refSpec, ownSpec)
        const comp = compRecommendation(refMono, ownMono, ref.sampleRate)
        if (canceled) return
        setAnalysis({ lufsRef, lufsOwn, refSpec, ownSpec, eqCurve, comp })
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
    (listen: boolean) => {
      if (!listen) return 0.0001
      if (!loudnessMatch || !analysis) return 1
      return Math.pow(10, (analysis.lufsRef - analysis.lufsOwn) / 20)
    },
    [loudnessMatch, analysis]
  )

  const play = useCallback(
    (fromSec: number) => {
      if (!refBuf || !ownBuf) return
      stop()
      const ctx = audioContext()
      ctx.resume()
      const refSrc = ctx.createBufferSource()
      refSrc.buffer = refBuf
      const refGain = ctx.createGain()
      refSrc.connect(refGain).connect(ctx.destination)
      const ownSrc = ctx.createBufferSource()
      ownSrc.buffer = ownBuf
      const ownGain = ctx.createGain()
      ownSrc.connect(ownGain).connect(ctx.destination)
      refGain.gain.value = listenOwn ? 0.0001 : 1
      ownGain.gain.value = ownGainValue(listenOwn)

      const t0 = ctx.currentTime + 0.05
      refSrc.start(t0, fromSec)
      // own timeline position = timeline − offset
      const ownPos = fromSec - offsetSec
      if (ownPos >= 0 && ownPos < ownBuf.duration) ownSrc.start(t0, ownPos)
      else if (ownPos < 0) ownSrc.start(t0 - ownPos, 0)
      graphRef.current = { refSrc, ownSrc, refGain, ownGain, startCtxTime: t0, startPos: fromSec }
      refSrc.onended = () => {
        if (graphRef.current?.refSrc === refSrc) stop()
      }
      setPlaying(true)
      const tick = () => {
        const g = graphRef.current
        if (!g) return
        setPlayhead(g.startPos + Math.max(0, ctx.currentTime - g.startCtxTime))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [refBuf, ownBuf, offsetSec, listenOwn, ownGainValue, stop]
  )

  /* A/B switch on the live graph (10 ms ramp — no click) */
  const setListen = useCallback(
    (own: boolean) => {
      setListenOwn(own)
      const g = graphRef.current
      if (g) {
        const t = audioContext().currentTime
        g.refGain.gain.setTargetAtTime(own ? 0.0001 : 1, t, 0.01)
        g.ownGain.gain.setTargetAtTime(ownGainValue(own), t, 0.01)
      }
    },
    [ownGainValue]
  )

  useEffect(() => stop, [stop, refStem?.id, ownStem?.id])

  /* keyboard: Space = play/stop, Tab = A/B */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (playing) stop()
        else play(playhead ?? 0)
      } else if (e.code === 'Tab') {
        e.preventDefault()
        setListen(!listenOwn)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, playhead, listenOwn, play, stop, setListen])

  if (!refStem || !ownStem) {
    return (
      <div className="ph grow" style={{ margin: 16, borderRadius: 'var(--r-lg)' }}>
        <span className="ph-cap">{tr('cmp.pickSong')}</span>
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
          <Waveform buffer={refBuf} color="oklch(0.70 0.14 255 / 0.85)" timelineSec={timelineSec} playheadSec={playhead} onSeek={(s) => (playing ? play(s) : setPlayhead(s))} />
          <Waveform
            buffer={ownBuf}
            color="oklch(0.73 0.16 350 / 0.85)"
            offsetSec={offsetSec}
            timelineSec={timelineSec}
            playheadSec={playhead}
            onSeek={(s) => (playing ? play(s) : setPlayhead(s))}
            onDragOffset={(d) => setOffsetSec((o) => o + d)}
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
        <label className="row gap8" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-mid)', cursor: 'pointer' }}>
          {tr('cmp.loudnessMatch')}
          {analysis && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {(analysis.lufsRef - analysis.lufsOwn >= 0 ? '+' : '') + (analysis.lufsRef - analysis.lufsOwn).toFixed(1)} dB
            </span>
          )}
          <button className={'cv-toggle' + (loudnessMatch ? ' on' : '')} onClick={() => setLoudnessMatch((v) => !v)}>
            <span className="knob" />
          </button>
        </label>
      </div>

      {/* analysis */}
      {loading && (
        <div className="col gap8">
          <span style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>{tr('cmp.loading')}</span>
          <div className="indet" style={{ width: '100%' }} />
        </div>
      )}
      {error && <span style={{ fontSize: 12.5, color: 'var(--lab-red)' }}>{error}</span>}
      {analysis && (
        <>
          <div className="card" style={{ padding: 14, animation: 'view-in .3s ease both' }}>
            <SpectrumChart refSpec={analysis.refSpec} ownSpec={analysis.ownSpec} eqCurve={analysis.eqCurve} />
          </div>
          <div style={{ animation: 'view-in .3s ease both', animationDelay: '80ms' }}>
            <CompCard rec={analysis.comp} />
          </div>
        </>
      )}
    </div>
  )
}
