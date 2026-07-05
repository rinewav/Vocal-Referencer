/* Audio loading + shared types for the compare view. */

export interface StemRef {
  id: string
  song_id: string
  kind: 'vocals' | 'instrumental' | 'lead' | 'backing' | 'own'
  label: string | null
  path: string
  created_at: number
}

export interface Song {
  id: string
  title: string
  artist: string | null
  src_path: string
  duration: number | null
  tags: string
  created_at: number
  stems: StemRef[]
}

export interface SeparateProgress {
  jobId: string
  songId: string
  preset: 'vocal' | 'karaoke'
  stage: 'model-download' | 'separating' | 'done' | 'error'
  pct: number
  error?: string
}

let ctx: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

export function audioUrl(path: string): string {
  return 'vr-audio://file/' + encodeURIComponent(path)
}

export async function loadAudioBuffer(path: string): Promise<AudioBuffer> {
  const res = await fetch(audioUrl(path))
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`)
  const bytes = await res.arrayBuffer()
  return audioContext().decodeAudioData(bytes)
}

/* Offline render of the own vocal through the suggested chain (FIR EQ and/or
   compressor) — mirrors the live simulate graph so the measured loudness of
   the rendered audio equals what the user actually hears. */
export async function renderProcessed(
  own: AudioBuffer,
  fir: Float32Array | null,
  comp: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number } | null
): Promise<AudioBuffer> {
  const tail = fir ? fir.length : 0
  const off = new OfflineAudioContext(own.numberOfChannels, own.length + tail, own.sampleRate)
  const src = off.createBufferSource()
  src.buffer = own
  let head: AudioNode = src
  if (fir) {
    const irBuf = off.createBuffer(1, fir.length, off.sampleRate)
    irBuf.copyToChannel(fir as Float32Array<ArrayBuffer>, 0)
    const conv = off.createConvolver()
    conv.normalize = false
    conv.buffer = irBuf
    head.connect(conv)
    head = conv
  }
  if (comp) {
    const c = off.createDynamicsCompressor()
    c.threshold.value = Math.max(-100, comp.thresholdDb)
    c.ratio.value = Math.min(20, comp.ratio)
    c.knee.value = 6
    c.attack.value = comp.attackMs / 1000
    c.release.value = comp.releaseMs / 1000
    head.connect(c)
    head = c
  }
  head.connect(off.destination)
  src.start()
  return off.startRendering()
}

/* min/max peak pairs per pixel column for waveform drawing */
export function computePeaks(buffer: AudioBuffer, width: number): { min: Float32Array; max: Float32Array } {
  const ch = buffer.getChannelData(0)
  const min = new Float32Array(width)
  const max = new Float32Array(width)
  const spp = ch.length / width
  for (let x = 0; x < width; x++) {
    let lo = 1
    let hi = -1
    const start = Math.floor(x * spp)
    const end = Math.min(ch.length, Math.ceil((x + 1) * spp))
    for (let i = start; i < end; i += 1) {
      const v = ch[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[x] = lo
    max[x] = hi
  }
  return { min, max }
}
