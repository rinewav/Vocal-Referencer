/* DSP analysis for the compare view: average spectrum, EQ-match curve
   (Matchering-style spectrum ratio), integrated loudness (ITU-R BS.1770),
   envelope cross-correlation alignment, compressor statistics. */
import FFT from 'fft.js'

/* ---------- spectrum ---------- */

export interface Spectrum {
  /* dB power per bin, length fftSize/2 */
  db: Float32Array
  sampleRate: number
  fftSize: number
}

export function averageSpectrum(ch: Float32Array, sampleRate: number, fftSize = 4096): Spectrum {
  const fft = new FFT(fftSize)
  const hop = fftSize / 2
  const window = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)))
  const acc = new Float64Array(fftSize / 2)
  const input = new Array(fftSize)
  const out = fft.createComplexArray()
  let frames = 0
  for (let pos = 0; pos + fftSize <= ch.length; pos += hop) {
    // skip near-silent frames so intros/outros don't drag the average down
    let energy = 0
    for (let i = 0; i < fftSize; i++) {
      const v = ch[pos + i] * window[i]
      input[i] = v
      energy += v * v
    }
    if (energy / fftSize < 1e-8) continue // < -80 dBFS RMS
    fft.realTransform(out, input)
    fft.completeSpectrum(out)
    for (let k = 0; k < fftSize / 2; k++) {
      const re = out[2 * k]
      const im = out[2 * k + 1]
      acc[k] += re * re + im * im
    }
    frames++
  }
  const db = new Float32Array(fftSize / 2)
  for (let k = 0; k < fftSize / 2; k++) {
    const p = frames > 0 ? acc[k] / frames : 1e-20
    db[k] = 10 * Math.log10(p + 1e-20)
  }
  return { db, sampleRate, fftSize }
}

/* fractional-octave smoothing on a dB spectrum (per-bin log-domain average) */
export function smoothSpectrum(spec: Spectrum, fraction = 6): Float32Array {
  const { db, sampleRate, fftSize } = spec
  const n = db.length
  const out = new Float32Array(n)
  const factor = Math.pow(2, 1 / (2 * fraction))
  for (let k = 1; k < n; k++) {
    const f = (k * sampleRate) / fftSize
    const lo = f / factor
    const hi = f * factor
    let kLo = Math.max(1, Math.floor((lo * fftSize) / sampleRate))
    let kHi = Math.min(n - 1, Math.ceil((hi * fftSize) / sampleRate))
    if (kHi < kLo) [kLo, kHi] = [kHi, kLo]
    let sum = 0
    for (let i = kLo; i <= kHi; i++) sum += db[i]
    out[k] = sum / (kHi - kLo + 1)
  }
  out[0] = out[1]
  return out
}

/* Matchering-style match curve: reference/target spectrum ratio in dB,
   smoothed to 1/3 octave, clamped to a plausible EQ range. */
export function eqMatchCurve(ref: Spectrum, own: Spectrum, clampDb = 12): Float32Array {
  const refS = smoothSpectrum(ref, 3)
  const ownS = smoothSpectrum(own, 3)
  const n = Math.min(refS.length, ownS.length)
  // normalize out the overall level difference so the curve is pure tonal shape
  let refMean = 0
  let ownMean = 0
  for (let k = 1; k < n; k++) {
    refMean += refS[k]
    ownMean += ownS[k]
  }
  refMean /= n - 1
  ownMean /= n - 1
  const curve = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const d = refS[k] - refMean - (ownS[k] - ownMean)
    curve[k] = Math.max(-clampDb, Math.min(clampDb, d))
  }
  return curve
}

/* ---------- loudness (ITU-R BS.1770-4, mono/stereo integrated) ---------- */

interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number
}

/* RBJ high-shelf: +4 dB at high end, f0≈1681.97 Hz (K-weighting stage 1) */
function shelfCoeffs(fs: number): Biquad {
  const f0 = 1681.9744509555319
  const G = 3.99984385397
  const Q = 0.7071752369554193
  const K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/* RLB high-pass, f0≈38.135 Hz (K-weighting stage 2) */
function highpassCoeffs(fs: number): Biquad {
  const f0 = 38.13547087602444
  const Q = 0.5003270373238773
  const K = Math.tan((Math.PI * f0) / fs)
  const a0 = 1 + K / Q + K * K
  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

function applyBiquad(x: Float32Array, c: Biquad): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

export function integratedLufs(buffer: AudioBuffer): number {
  const fs = buffer.sampleRate
  const shelf = shelfCoeffs(fs)
  const hp = highpassCoeffs(fs)
  const channels: Float32Array[] = []
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    channels.push(applyBiquad(applyBiquad(buffer.getChannelData(c), shelf), hp))
  }
  const blockLen = Math.round(0.4 * fs)
  const hopLen = Math.round(0.1 * fs)
  const blocks: number[] = []
  for (let pos = 0; pos + blockLen <= channels[0].length; pos += hopLen) {
    let sum = 0
    for (const ch of channels) {
      for (let i = pos; i < pos + blockLen; i++) sum += ch[i] * ch[i]
    }
    const mean = sum / blockLen // channel weights are 1, summed across channels
    blocks.push(-0.691 + 10 * Math.log10(mean + 1e-20))
  }
  if (blocks.length === 0) return -70
  const abs = blocks.filter((l) => l > -70)
  if (abs.length === 0) return -70
  const meanPow = (arr: number[]) => arr.reduce((s, l) => s + Math.pow(10, l / 10), 0) / arr.length
  const relGate = -0.691 + 10 * Math.log10(meanPow(abs.map((l) => l + 0.691))) - 10
  const gated = abs.filter((l) => l > relGate)
  if (gated.length === 0) return -70
  return -0.691 + 10 * Math.log10(meanPow(gated.map((l) => l + 0.691)))
}

/* ---------- alignment ---------- */

/* RMS envelope at a given frame rate (Hz) from a mono signal */
function envelope(ch: Float32Array, sampleRate: number, frameRate: number): Float32Array {
  const frame = Math.max(1, Math.round(sampleRate / frameRate))
  const n = Math.floor(ch.length / frame)
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * frame
    for (let j = 0; j < frame; j++) sum += ch[base + j] * ch[base + j]
    env[i] = Math.sqrt(sum / frame)
  }
  // remove DC so correlation peaks on structure, not overall energy
  let mean = 0
  for (let i = 0; i < n; i++) mean += env[i]
  mean /= n
  for (let i = 0; i < n; i++) env[i] -= mean
  return env
}

function nextPow2(n: number): number {
  return 1 << Math.ceil(Math.log2(n))
}

/* FFT cross-correlation of two envelopes; returns lag (in frames) of b vs a */
function xcorrPeak(a: Float32Array, b: Float32Array): number {
  const size = nextPow2(a.length + b.length - 1)
  const fft = new FFT(size)
  const fa = fft.createComplexArray()
  const fb = fft.createComplexArray()
  const ia = new Array(size).fill(0)
  const ib = new Array(size).fill(0)
  for (let i = 0; i < a.length; i++) ia[i] = a[i]
  for (let i = 0; i < b.length; i++) ib[i] = b[i]
  fft.realTransform(fa, ia)
  fft.completeSpectrum(fa)
  fft.realTransform(fb, ib)
  fft.completeSpectrum(fb)
  // conj(A) * B → correlation of b relative to a
  const prod = fft.createComplexArray()
  for (let k = 0; k < size; k++) {
    const ar = fa[2 * k], ai = -fa[2 * k + 1]
    const br = fb[2 * k], bi = fb[2 * k + 1]
    prod[2 * k] = ar * br - ai * bi
    prod[2 * k + 1] = ar * bi + ai * br
  }
  const res = fft.createComplexArray()
  fft.inverseTransform(res, prod)
  let best = 0
  let bestVal = -Infinity
  for (let k = 0; k < size; k++) {
    const v = res[2 * k]
    if (v > bestVal) {
      bestVal = v
      best = k
    }
  }
  // lags above size/2 are negative (wrap-around)
  return best > size / 2 ? best - size : best
}

export function toMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length
  const mono = new Float32Array(n)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) mono[i] += ch[i] / buffer.numberOfChannels
  }
  return mono
}

/* Offset (seconds) to delay `own` so it lines up with `ref`.
   Coarse pass at 50 Hz envelope, refined at 1 kHz around the coarse hit. */
export function detectOffset(refMono: Float32Array, ownMono: Float32Array, sampleRate: number): number {
  const coarseRate = 50
  const lagCoarse = xcorrPeak(envelope(refMono, sampleRate, coarseRate), envelope(ownMono, sampleRate, coarseRate))
  const coarseSec = lagCoarse / coarseRate

  const fineRate = 1000
  const refFine = envelope(refMono, sampleRate, fineRate)
  const ownFine = envelope(ownMono, sampleRate, fineRate)
  const center = Math.round(coarseSec * fineRate)
  const span = Math.round(0.1 * fineRate) // ±100 ms
  let best = center
  let bestVal = -Infinity
  for (let lag = center - span; lag <= center + span; lag++) {
    let sum = 0
    for (let i = 0; i < refFine.length; i++) {
      const j = i - lag
      if (j >= 0 && j < ownFine.length) sum += refFine[i] * ownFine[j]
    }
    if (sum > bestVal) {
      bestVal = sum
      best = lag
    }
  }
  return best / fineRate
}

/* ---------- compressor statistics ---------- */

export interface CompRecommendation {
  refCrestDb: number
  ownCrestDb: number
  refDrDb: number // P95−P10 of the 10 ms envelope
  ownDrDb: number
  ratio: number | null // null → no compression needed
  thresholdDb: number | null // dBFS on the own stem
  attackMs: number
  releaseMs: number
}

function envelopeDb(ch: Float32Array, sampleRate: number, frameMs: number): Float32Array {
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const n = Math.floor(ch.length / frame)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * frame
    for (let j = 0; j < frame; j++) sum += ch[base + j] * ch[base + j]
    const db = 10 * Math.log10(sum / frame + 1e-20)
    if (db > -60) out.push(db) // gate silence
  }
  return Float32Array.from(out)
}

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return -60
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/* RMS envelope over time in dB (no silence gating — for the dynamics chart) */
export function envelopeSeriesDb(ch: Float32Array, sampleRate: number, frameMs = 50): { frameSec: number; db: Float32Array } {
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const n = Math.floor(ch.length / frame)
  const db = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * frame
    for (let j = 0; j < frame; j++) sum += ch[base + j] * ch[base + j]
    db[i] = Math.max(-80, 10 * Math.log10(sum / frame + 1e-20))
  }
  return { frameSec: frame / sampleRate, db }
}

/* Feed the envelope through the suggested compressor (static curve +
   one-pole attack/release smoothing on the gain) → predicted envelope. */
export function simulateComp(env: Float32Array, frameSec: number, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number): Float32Array {
  const out = new Float32Array(env.length)
  const aAtk = Math.exp(-frameSec / Math.max(0.0005, attackMs / 1000))
  const aRel = Math.exp(-frameSec / Math.max(0.005, releaseMs / 1000))
  let gain = 0 // dB of gain reduction (≤ 0)
  for (let i = 0; i < env.length; i++) {
    const over = env[i] - thresholdDb
    const target = over > 0 ? -over * (1 - 1 / ratio) : 0
    const a = target < gain ? aAtk : aRel
    gain = a * gain + (1 - a) * target
    out[i] = env[i] + gain
  }
  return out
}

/* ---------- parametric band fitting (for Pro-Q export) ---------- */

export interface EqBandFit {
  freqHz: number
  gainDb: number
  q: number
}

/* analog-prototype peaking bell magnitude in dB (RBJ-style, symmetric) */
function bellDb(f: number, f0: number, gainDb: number, q: number): number {
  if (gainDb === 0) return 0
  const A = Math.pow(10, gainDb / 40)
  const w = f / f0
  const num = (1 - w * w) ** 2 + (A * w / q) ** 2
  const den = (1 - w * w) ** 2 + (w / (A * q)) ** 2
  return 10 * Math.log10(num / den)
}

export function bandsResponseDb(bands: EqBandFit[], freqs: Float32Array): Float32Array {
  const out = new Float32Array(freqs.length)
  for (const b of bands) for (let i = 0; i < freqs.length; i++) out[i] += bellDb(freqs[i], b.freqHz, b.gainDb, b.q)
  return out
}

/* Fit the match curve with parametric bells for Pro-Q export.
   Two phases: greedy seeding at the residual's largest deviation, then
   coordinate-descent refinement (each band re-optimized against the
   residual of all others). Uses the full 24 Pro-Q slots by default. */
export function fitParametricBands(curve: Float32Array, spec: Spectrum, maxBands = 24, tolDb = 0.2): EqBandFit[] {
  const N = 240
  const freqs = new Float32Array(N)
  const target = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const f = 20 * Math.pow(20000 / 20, i / (N - 1))
    freqs[i] = f
    const bin = Math.max(1, Math.min(curve.length - 1, Math.round((f * spec.fftSize) / spec.sampleRate)))
    target[i] = curve[bin]
  }

  const qGrid = [0.3, 0.45, 0.7, 1.0, 1.4, 2.0, 3.0, 4.5, 7.0, 10.0, 14.0, 18.0]
  const gainScales = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25]

  const response = (bands: EqBandFit[], skip: number): Float32Array => {
    const out = new Float32Array(N)
    for (let b = 0; b < bands.length; b++) {
      if (b === skip) continue
      for (let i = 0; i < N; i++) out[i] += bellDb(freqs[i], bands[b].freqHz, bands[b].gainDb, bands[b].q)
    }
    return out
  }

  /* best bell against `residual`, seeded around grid index `peakIdx` */
  const solveBand = (residual: Float32Array, peakIdx: number): EqBandFit => {
    const peakVal = residual[peakIdx]
    let best: EqBandFit = { freqHz: freqs[peakIdx], gainDb: Math.max(-12, Math.min(12, peakVal)), q: 1.4 }
    let bestErr = Infinity
    for (let fi = Math.max(0, peakIdx - 4); fi <= Math.min(N - 1, peakIdx + 4); fi += 2) {
      const f0 = freqs[fi]
      for (const q of qGrid) {
        for (const gs of gainScales) {
          const g = Math.max(-12, Math.min(12, peakVal * gs))
          let err = 0
          for (let i = 0; i < N; i++) {
            const dist = Math.abs(Math.log2(freqs[i] / f0))
            const w = dist < 2 ? 1 : 0.2
            const r = residual[i] - bellDb(freqs[i], f0, g, q)
            err += w * r * r
          }
          if (err < bestErr) {
            bestErr = err
            best = { freqHz: f0, gainDb: g, q }
          }
        }
      }
    }
    return best
  }

  /* phase 1: greedy seeding */
  const bands: EqBandFit[] = []
  const residual = Float32Array.from(target)
  while (bands.length < maxBands) {
    let peakIdx = 0
    for (let i = 0; i < N; i++) if (Math.abs(residual[i]) > Math.abs(residual[peakIdx])) peakIdx = i
    if (Math.abs(residual[peakIdx]) < tolDb) break
    const band = solveBand(residual, peakIdx)
    bands.push(band)
    for (let i = 0; i < N; i++) residual[i] -= bellDb(freqs[i], band.freqHz, band.gainDb, band.q)
  }

  /* phase 2: coordinate-descent refinement, 3 sweeps */
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let b = 0; b < bands.length; b++) {
      const others = response(bands, b)
      const res = new Float32Array(N)
      let peakIdx = 0
      for (let i = 0; i < N; i++) {
        res[i] = target[i] - others[i]
        if (Math.abs(res[i]) > Math.abs(res[peakIdx])) peakIdx = i
      }
      // re-seed near the band's current frequency, not the global peak,
      // so refinement stays local; fall back to the peak if gain vanished
      let seedIdx = Math.round((Math.log2(bands[b].freqHz / 20) / Math.log2(20000 / 20)) * (N - 1))
      seedIdx = Math.max(0, Math.min(N - 1, seedIdx))
      if (Math.abs(res[seedIdx]) < 0.1) seedIdx = peakIdx
      bands[b] = solveBand(res, seedIdx)
    }
  }

  /* drop bands that refined away to nothing */
  const kept = bands.filter((b) => Math.abs(b.gainDb) >= 0.3)
  return kept.sort((a, b) => a.freqHz - b.freqHz)
}

/* Linear-phase FIR from the EQ match curve (frequency-sampling method).
   curve bins are laid out like the analysis spectrum (fftSize bins at
   sampleRate); taps must equal that fftSize for the 1:1 mapping used here.
   Group delay = taps/2 samples — compensate at playback start. */
export function eqCurveToFir(curve: Float32Array, taps: number): Float32Array {
  const fft = new FFT(taps)
  const spectrum = fft.createComplexArray()
  const half = taps / 2
  for (let k = 0; k <= half; k++) {
    const db = k < curve.length ? curve[Math.max(1, k)] : 0
    const mag = Math.pow(10, db / 20)
    const idx = k === half ? half : k
    spectrum[2 * idx] = mag
    spectrum[2 * idx + 1] = 0
    if (k > 0 && k < half) {
      // conjugate symmetry for a real impulse response
      spectrum[2 * (taps - k)] = mag
      spectrum[2 * (taps - k) + 1] = 0
    }
  }
  const time = fft.createComplexArray()
  fft.inverseTransform(time, spectrum)
  const fir = new Float32Array(taps)
  // rotate zero-phase response to linear phase + hann window the edges
  for (let n = 0; n < taps; n++) {
    const src = (n + half) % taps
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (taps - 1)))
    fir[n] = time[2 * src] * w
  }
  return fir
}

export function compRecommendation(refMono: Float32Array, ownMono: Float32Array, sampleRate: number): CompRecommendation {
  const refEnv = envelopeDb(refMono, sampleRate, 10).sort()
  const ownEnv = envelopeDb(ownMono, sampleRate, 10).sort()
  const refDr = percentile(refEnv, 95) - percentile(refEnv, 10)
  const ownDr = percentile(ownEnv, 95) - percentile(ownEnv, 10)

  const crest = (ch: Float32Array, env: Float32Array) => {
    let peak = 0
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
    }
    const rms = percentile(env, 50)
    return 20 * Math.log10(peak + 1e-20) - rms
  }
  const refCrest = crest(refMono, refEnv)
  const ownCrest = crest(ownMono, ownEnv)

  let ratio: number | null = null
  let thresholdDb: number | null = null
  if (ownDr > refDr + 0.5) {
    // ratio that maps own's dynamic range onto the reference's
    ratio = Math.min(8, Math.max(1.2, ownDr / Math.max(1, refDr)))
    // threshold placed so the loud part (above P50) gets compressed
    thresholdDb = percentile(ownEnv, 50)
  }
  // faster attack when the reference keeps transients tighter than own
  const attackMs = ownCrest - refCrest > 6 ? 3 : ownCrest - refCrest > 3 ? 10 : 25
  const releaseMs = 150
  return {
    refCrestDb: refCrest,
    ownCrestDb: ownCrest,
    refDrDb: refDr,
    ownDrDb: ownDr,
    ratio,
    thresholdDb,
    attackMs,
    releaseMs
  }
}
