/* First-run engine installer.
   Drives: python runtime download+extract → pip install → model download.
   Emits InstallProgress per part over webContents so FirstRun can render
   per-part rows and an aggregate bar. Idempotent: finished parts are skipped
   on re-run, so a failed setup resumes instead of restarting. */
import { BrowserWindow } from 'electron'
import { createWriteStream, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { rename, rm } from 'fs/promises'
import { join, basename } from 'path'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import * as tar from 'tar'
import { engineManifest, PIP_PACKAGES, EnginePart, DEFAULT_MODEL_FILE } from './manifest'
import { engineRoot, runtimeDir, modelsDir, markerPath, pythonBin, audioSeparatorBin, hasRuntime, ENGINE_VERSION } from './paths'

export interface InstallProgress {
  name: string
  received: number
  total: number // 0 → indeterminate (pip step)
  done: boolean
  error?: string
}

export interface HealthReport {
  ok: boolean
  runtime: boolean
  audioEngine: boolean
  model: boolean
}

function broadcast(progress: InstallProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('engine:install-progress', progress)
  }
}

async function downloadTo(url: string, dest: string, onBytes: (received: number, total: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      onBytes(received, total)
      controller.enqueue(chunk)
    }
  })
  const tmp = dest + '.part'
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(tmp))
  await rename(tmp, dest)
}

async function installPythonRuntime(part: EnginePart): Promise<void> {
  if (hasRuntime()) {
    broadcast({ name: part.name, received: 1, total: 1, done: true })
    return
  }
  mkdirSync(runtimeDir(), { recursive: true })
  const archive = join(engineRoot(), basename(part.url!))
  broadcast({ name: part.name, received: 0, total: 0, done: false })
  await downloadTo(part.url!, archive, (received, total) =>
    broadcast({ name: part.name, received, total, done: false })
  )
  // archive root is "python/" — extract straight into runtime/
  await tar.x({ file: archive, cwd: runtimeDir() })
  await rm(archive, { force: true })
  if (!hasRuntime()) throw new Error('python runtime missing after extract')
  broadcast({ name: part.name, received: 1, total: 1, done: true })
}

function runCommand(bin: string, args: string[], onLine?: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const feed = (data: Buffer) => {
      if (!onLine) return
      // tqdm redraws with \r, so split on both
      for (const line of data.toString().split(/[\r\n]/)) if (line.trim()) onLine(line)
    }
    proc.stdout.on('data', feed)
    proc.stderr.on('data', feed)
    proc.on('error', reject)
    proc.on('close', (code) => resolve(code ?? 1))
  })
}

const runPython = (args: string[], onLine?: (line: string) => void) => runCommand(pythonBin(), args, onLine)

async function hasAudioEngine(): Promise<boolean> {
  if (!hasRuntime()) return false
  return (await runPython(['-c', 'import audio_separator'])) === 0
}

async function installPipDeps(part: EnginePart): Promise<void> {
  if (await hasAudioEngine()) {
    broadcast({ name: part.name, received: 1, total: 1, done: true })
    return
  }
  // total:0 → renderer shows the row as indeterminate; bump received so the
  // aggregate bar still creeps forward while pip logs stream in
  let lines = 0
  broadcast({ name: part.name, received: 0, total: 0, done: false })
  const code = await runPython(
    ['-m', 'pip', 'install', '--no-warn-script-location', ...PIP_PACKAGES],
    () => broadcast({ name: part.name, received: ++lines, total: 0, done: false })
  )
  if (code !== 0) throw new Error(`pip exited with ${code}`)
  if (!(await hasAudioEngine())) throw new Error('audio_separator import failed after pip install')
  broadcast({ name: part.name, received: 1, total: 1, done: true })
}

/* Model download is delegated to audio-separator: it resolves the ckpt +
   config-yaml pairing from its own registry, so we never maintain URLs.
   No existsSync pre-skip: a crashed download leaves a partial ckpt that
   would pass that check — the CLI itself verifies and is fast when done. */
async function installModel(part: EnginePart): Promise<void> {
  mkdirSync(modelsDir(), { recursive: true })
  broadcast({ name: part.name, received: 0, total: 0, done: false })
  const code = await runCommand(
    audioSeparatorBin(),
    ['--download_model_only', '-m', part.modelFilename!, '--model_file_dir', modelsDir()],
    (line) => {
      // surface tqdm percentage as byte-less progress (received=pct, total=100)
      const pct = line.match(/(\d{1,3})%\|/)
      if (pct) broadcast({ name: part.name, received: Number(pct[1]), total: 100, done: false })
    }
  )
  if (code !== 0) throw new Error(`model download exited with ${code}`)
  if (!existsSync(join(modelsDir(), part.modelFilename!))) throw new Error('model file missing after download')
  broadcast({ name: part.name, received: 1, total: 1, done: true })
}

export async function health(): Promise<HealthReport> {
  const runtime = hasRuntime()
  const audioEngine = runtime ? await hasAudioEngine() : false
  const model = existsSync(join(modelsDir(), DEFAULT_MODEL_FILE))
  const ok = runtime && audioEngine && model && existsSync(markerPath())
  return { ok, runtime, audioEngine, model }
}

export async function install(): Promise<HealthReport> {
  mkdirSync(engineRoot(), { recursive: true })
  const parts = engineManifest()
  // pre-announce every part so the renderer's count-based aggregate is stable
  for (const part of parts) broadcast({ name: part.name, received: 0, total: 0, done: false })
  try {
    await installPythonRuntime(parts[0])
    await installPipDeps(parts[1])
    await installModel(parts[2])
    writeFileSync(markerPath(), JSON.stringify({ version: ENGINE_VERSION, installedAt: Date.now() }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // attribute the failure to the first unfinished part
    const report = await health()
    const failing = !report.runtime ? parts[0] : !report.audioEngine ? parts[1] : parts[2]
    broadcast({ name: failing.name, received: 0, total: 0, done: false, error: message })
    return report
  }
  return health()
}

/* read-only view for the consent screen */
export function manifestSummary(): { name: string; kind: string; sizeLabel: string }[] {
  return engineManifest().map(({ name, kind, sizeLabel }) => ({ name, kind, sizeLabel }))
}

export function installedMarker(): { version: number; installedAt: number } | null {
  try {
    return JSON.parse(readFileSync(markerPath(), 'utf8'))
  } catch {
    return null
  }
}
