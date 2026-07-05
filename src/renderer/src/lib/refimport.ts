/* Shared reference-registration pipeline (library tiles + compare view):
   copy into the project (main), then for videos grab a thumbnail frame and
   swap the source for a decoded WAV, then kick off auto separation. */
import { audioUrl, loadAudioBuffer, audioBufferToWav, Song } from './audio'
import { PrefsStore } from '../prefs'

export const isVideoPath = (p: string): boolean => /\.(mp4|mov|webm)$/i.test(p)

/* draw a frame from ~40% into the video, capped to 640 px wide */
async function captureVideoFrame(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = url
    const fail = () => reject(new Error('video load failed'))
    video.onerror = fail
    video.onloadedmetadata = () => {
      video.currentTime = Math.max(0.1, video.duration * 0.4)
    }
    video.onseeked = () => {
      try {
        const scale = Math.min(1, 640 / video.videoWidth)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      } finally {
        video.src = ''
      }
    }
  })
}

/* true when the decoded audio is effectively silence (decode "succeeded" but
   produced nothing usable — seen with some video codecs) */
function isNearSilent(buf: AudioBuffer): boolean {
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    // sparse scan is plenty to find real program material
    for (let i = 0; i < d.length; i += 97) {
      if (Math.abs(d[i]) > 0.003) return false
    }
  }
  return true
}

export class SilentAudioError extends Error {
  constructor() {
    super('decoded audio is silent')
    this.name = 'SilentAudioError'
  }
}

/* post-registration steps once the file already sits inside the project */
export async function finishRefRegistration(songId: string, srcPath: string): Promise<void> {
  if (isVideoPath(srcPath)) {
    try {
      const frame = await captureVideoFrame(audioUrl(srcPath))
      await window.vr!.library.setThumbData(songId, frame)
    } catch {
      /* no frame → waveform fallback stays */
    }
    const buf = await loadAudioBuffer(srcPath)
    // guard: never bake a silent WAV (and never delete the source video) when
    // the audio track failed to decode — surface it instead
    if (isNearSilent(buf)) throw new SilentAudioError()
    await window.vr!.library.convertRefWav(songId, audioBufferToWav(buf))
  }
  if (PrefsStore.get().autoSeparate !== 'off') {
    await window.vr!.separate.start(songId, 'vocal')
  }
}

/* set/replace the reference on an existing project and run the pipeline */
export async function registerReference(songId: string, filePath: string): Promise<void> {
  await window.vr!.library.setRef(songId, filePath)
  const list = (await window.vr!.library.list()) as Song[]
  const fresh = list.find((s) => s.id === songId)
  if (fresh?.src_path) await finishRefRegistration(songId, fresh.src_path)
}

/* chain lead/backing split after an automatic vocal separation */
export async function maybeChainKaraoke(songId: string, finishedPreset: string): Promise<void> {
  if (finishedPreset !== 'vocal' || PrefsStore.get().autoSeparate !== 'full') return
  const list = (await window.vr!.library.list()) as Song[]
  const song = list.find((s) => s.id === songId)
  if (!song) return
  const hasVocals = song.stems.some((s) => s.kind === 'vocals')
  const hasLead = song.stems.some((s) => s.kind === 'lead')
  if (hasVocals && !hasLead) await window.vr!.separate.start(songId, 'karaoke')
}
