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
