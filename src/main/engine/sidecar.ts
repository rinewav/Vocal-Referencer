/* Separation jobs: drive the bundled audio-separator CLI.
   Presets map to models + output-stem naming. Jobs run one at a time;
   progress streams to the renderer over 'separate:progress'. */
import { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { audioSeparatorBin, modelsDir } from './paths'
import { DEFAULT_MODEL_FILE, KARAOKE_MODEL_FILE } from './manifest'
import { libraryRoot } from '../db'
import { getSong, songStems, registerStem } from '../library'
import type { StemKind } from '../db'

export type Preset = 'vocal' | 'karaoke'

interface PresetDef {
  model: string
  /* audio-separator's output tag → our stem kind */
  map: Record<string, StemKind>
  /* which source file to feed: 'original' or an existing stem kind */
  input: 'original' | StemKind
  /* the stem this preset exists to produce — missing output (e.g. the
     separator skips near-silent stems) must fail loudly, not report done */
  required: StemKind
}

/* Vocal extraction: BS-Roformer ep317 (installed during first-run).
   Lead/backing split: Mel-Roformer karaoke on the vocals stem (model
   fetched on demand the first time the preset is used). */
const PRESETS: Record<Preset, PresetDef> = {
  vocal: {
    model: 'model_bs_roformer_ep_317_sdr_12.9755.ckpt',
    map: { Vocals: 'vocals', Instrumental: 'instrumental' },
    input: 'original',
    required: 'vocals'
  },
  karaoke: {
    model: 'mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt',
    map: { Vocals: 'lead', Instrumental: 'backing' },
    input: 'vocals',
    required: 'lead'
  }
}

export interface SeparateProgress {
  jobId: string
  songId: string
  preset: Preset
  stage: 'model-download' | 'separating' | 'done' | 'error'
  pct: number
  error?: string
}

function broadcast(p: SeparateProgress) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('separate:progress', p)
}

function run(args: string[], onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(audioSeparatorBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const feed = (d: Buffer) => {
      for (const line of d.toString().split(/[\r\n]/)) if (line.trim()) onLine(line)
    }
    proc.stdout.on('data', feed)
    proc.stderr.on('data', feed)
    proc.on('error', reject)
    proc.on('close', (code) => resolve(code ?? 1))
  })
}

const pctOf = (line: string): number | null => {
  const m = line.match(/(\d{1,3})%\|/)
  return m ? Number(m[1]) : null
}

let queue: Promise<unknown> = Promise.resolve()

export function enqueueSeparation(songId: string, preset: Preset): string {
  const jobId = randomUUID()
  queue = queue.then(() => runJob(jobId, songId, preset)).catch(() => {})
  return jobId
}

async function runJob(jobId: string, songId: string, preset: Preset): Promise<void> {
  const def = PRESETS[preset]
  const emit = (stage: SeparateProgress['stage'], pct: number, error?: string) =>
    broadcast({ jobId, songId, preset, stage, pct, error })
  try {
    const song = getSong(songId)
    if (!song) throw new Error('song not found')

    let input = song.src_path
    if (def.input !== 'original') {
      const source = songStems(songId).find((s) => s.kind === def.input)
      if (!source) throw new Error(`missing ${def.input} stem — run vocal extraction first`)
      input = source.path
    }

    // ensure the preset's model exists (BS-Roformer ships at first-run;
    // others are pulled on demand, same delegation as the installer)
    if (!existsSync(join(modelsDir(), def.model))) {
      emit('model-download', 0)
      const code = await run(
        ['--download_model_only', '-m', def.model, '--model_file_dir', modelsDir()],
        (line) => {
          const pct = pctOf(line)
          if (pct !== null) emit('model-download', pct)
        }
      )
      if (code !== 0) throw new Error(`model download exited with ${code}`)
    }

    const outDir = join(libraryRoot(), songId, `sep-${jobId.slice(0, 8)}`)
    mkdirSync(outDir, { recursive: true })
    emit('separating', 0)
    const code = await run(
      [input, '-m', def.model, '--model_file_dir', modelsDir(), '--output_dir', outDir, '--output_format', 'FLAC'],
      (line) => {
        const pct = pctOf(line)
        if (pct !== null) emit('separating', pct)
      }
    )
    if (code !== 0) throw new Error(`separation exited with ${code}`)

    // collect outputs: filenames carry "(Vocals)" / "(Instrumental)" tags
    const produced = readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.flac'))
    const found: Partial<Record<StemKind, boolean>> = {}
    for (const [tag, kind] of Object.entries(def.map)) {
      const file = produced.find((f) => f.includes(`(${tag})`))
      if (!file) continue
      const dest = join(libraryRoot(), songId, `${kind}.flac`)
      rmSync(dest, { force: true })
      renameSync(join(outDir, file), dest)
      // replace any previous stem row of this kind
      const prev = songStems(songId).find((s) => s.kind === kind)
      if (!prev) registerStem(songId, kind, null, dest)
      found[kind] = true
    }
    rmSync(outDir, { recursive: true, force: true })
    // the separator silently skips near-silent stems — a "vocal extraction"
    // that produced no vocals is a failure the user must see
    if (!found[def.required]) throw new Error(`silent-${def.required}`)
    emit('done', 100)
  } catch (err) {
    emit('error', 0, err instanceof Error ? err.message : String(err))
  }
}
