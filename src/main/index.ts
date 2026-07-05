import { app, BrowserWindow, ipcMain, shell, dialog, protocol, net, nativeImage } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

/* must run before app ready: allow fetch()/streaming on the audio scheme */
protocol.registerSchemesAsPrivileged([
  { scheme: 'vr-audio', privileges: { supportFetchAPI: true, stream: true } }
])
import { getSetting, setSetting, clearSettings } from './settings'
import { install, health, manifestSummary } from './engine/installer'
import { enqueueSeparation, Preset } from './engine/sidecar'
import {
  addSong,
  addOwnStem,
  listSongs,
  renameSong,
  deleteSong,
  createProject,
  setReference,
  convertRefToWav,
  setThumbFromFile,
  setThumbFromData,
  cacheGet,
  cacheSet,
  resetLibraryData,
  removeOwnStem
} from './library'
import { exportProQ, ExportBand } from './proq'
import { buildZlEqPreset, saveBuffer, EqBand } from './presets'
import { libraryRoot } from './db'
import { enableDiscord, setPresence, setDiscordIdle } from './discord'

// Update-check feed: the GitHub "latest release" API for the project repo. The
// app NEVER auto-downloads or runs anything — it only compares versions and
// points the user at the release page. Fail-silent when offline / no releases
// yet (so a fresh repo never shows a false alarm). Mirrors Covo's approach.
const UPDATE_FEED = 'https://api.github.com/repos/rinewav/Vocal-Referencer/releases/latest'
// Where the "download" button sends the user: the latest GitHub release page
// (they pick the macOS/Windows asset there). Also the allowlisted host+path.
const RELEASES_PAGE = 'https://github.com/rinewav/Vocal-Referencer/releases/latest'

function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return false
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#14161c', // Nightfall canvas approximation until CSS paints
    // mac: hidden-inset traffic lights / others: frameless + in-app window controls
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Discord presence → "Idle…" while the window is minimized or hidden.
  win.on('minimize', () => setDiscordIdle(true))
  win.on('hide', () => setDiscordIdle(true))
  win.on('restore', () => setDiscordIdle(false))
  win.on('show', () => setDiscordIdle(false))
  win.on('focus', () => setDiscordIdle(false))

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  /* audio files for the renderer — restricted to the library directory */
  protocol.handle('vr-audio', (req) => {
    const encoded = new URL(req.url).pathname.slice(1)
    const filePath = decodeURIComponent(encoded)
    if (!filePath.startsWith(libraryRoot())) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).href)
  })

  ipcMain.handle('app:version', () => app.getVersion())

  /* frameless-window controls (Windows/Linux — mac keeps native traffic lights) */
  ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('win:maximize-toggle', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  /* reveal a library file in Finder / Explorer — restricted to the library dir */
  ipcMain.handle('shell:reveal', (_e, p: unknown) => {
    if (typeof p === 'string' && p.startsWith(libraryRoot())) shell.showItemInFolder(p)
  })

  /* Update CHECK only (no auto-install): fetch the GitHub latest-release feed,
     compare its tag to the running version, and report whether a newer build
     exists. Fail-silent on any error (offline / no releases / rate-limited). */
  ipcMain.handle('app:check-update', async () => {
    const current = app.getVersion()
    try {
      // GitHub's API requires a User-Agent; without it the request 403s.
      const res = await net.fetch(UPDATE_FEED, {
        cache: 'no-store',
        headers: { 'User-Agent': 'VocalReferencer', Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) return { current, updateAvailable: false }
      const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
      // release tags look like "v1.2.3" → strip the leading v for comparison
      const latest = typeof data?.tag_name === 'string' ? data.tag_name.trim().replace(/^v/i, '') : ''
      if (!/^\d+\.\d+\.\d+/.test(latest)) return { current, updateAvailable: false }
      const url =
        typeof data?.html_url === 'string' &&
        /^https:\/\/github\.com\/rinewav\/Vocal-Referencer\//i.test(data.html_url)
          ? data.html_url
          : RELEASES_PAGE
      return { current, latest, url, updateAvailable: isNewerVersion(latest, current) }
    } catch {
      // offline / no releases yet — treat as up to date (no false alarms)
      return { current, updateAvailable: false }
    }
  })

  /* Open the release page in the user's browser. Restricted to the project's
     GitHub repo so a tampered feed can't redirect the button to another origin. */
  ipcMain.handle('app:open-download', (_e, url?: unknown) => {
    let target = RELEASES_PAGE
    try {
      if (typeof url === 'string') {
        const u = new URL(url)
        if (
          u.protocol === 'https:' &&
          u.hostname === 'github.com' &&
          /^\/rinewav\/Vocal-Referencer(\/|$)/i.test(u.pathname)
        ) {
          target = url
        }
      }
    } catch {
      // malformed url — fall back to the releases page
    }
    void shell.openExternal(target)
  })

  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => setSetting(key, value))

  /* Discord Rich Presence: the toggle persists the choice and (dis)connects. */
  ipcMain.handle('discord:enable', (_e, on: boolean) => {
    setSetting('discordRpc', on)
    return enableDiscord(on)
  })
  ipcMain.handle('discord:presence', (_e, state: { view?: string; lang?: string }) => setPresence(state))

  /* factory reset: wipe the library + all settings, then relaunch into the
     first-run flow. The engine install is kept so the user isn't forced to
     re-download ~1.8 GB. The renderer clears its own localStorage first. */
  ipcMain.handle('app:reset', () => {
    resetLibraryData()
    clearSettings()
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('engine:health', () => health())
  ipcMain.handle('engine:install', () => install())
  ipcMain.handle('engine:manifest', () => manifestSummary())

  ipcMain.handle('library:list', () => listSongs())
  ipcMain.handle('library:add', (_e, filePath: string) => addSong(filePath))
  ipcMain.handle('library:create', () => createProject())
  ipcMain.handle('library:set-ref', (_e, songId: string, filePath: string) => setReference(songId, filePath))
  ipcMain.handle('library:convert-ref-wav', (_e, songId: string, wav: ArrayBuffer) =>
    convertRefToWav(songId, Buffer.from(wav))
  )
  ipcMain.handle('library:set-thumb-file', (_e, songId: string, imagePath: string) => setThumbFromFile(songId, imagePath))
  ipcMain.handle('library:set-thumb-data', (_e, songId: string, dataUrl: string) => setThumbFromData(songId, dataUrl))
  ipcMain.handle('library:add-own', (_e, songId: string, filePath: string) => addOwnStem(songId, filePath))
  ipcMain.handle('library:rename', (_e, songId: string, title: string) => renameSong(songId, title))
  ipcMain.handle('library:delete', (_e, songId: string) => deleteSong(songId))
  ipcMain.handle('library:remove-own-stem', (_e, stemId: string) => removeOwnStem(stemId))
  ipcMain.handle('cache:get', (_e, key: string) => cacheGet(key))
  ipcMain.handle('cache:set', (_e, key: string, songId: string, data: string) => cacheSet(key, songId, data))

  ipcMain.handle('separate:start', (_e, songId: string, preset: Preset) => enqueueSeparation(songId, preset))

  ipcMain.handle('export:proq', (_e, bands: ExportBand[], defaultName: string, outputGainDb: number) =>
    exportProQ(bands, defaultName, outputGainDb ?? 0)
  )
  ipcMain.handle('export:zleq', (_e, bands: EqBand[], defaultName: string, outputGainDb: number) =>
    saveBuffer(defaultName, 'VST3 Preset', 'vstpreset', buildZlEqPreset(bands, outputGainDb ?? 0))
  )

  ipcMain.handle('dialog:pick-audio', async (_e, multi: boolean) => {
    const res = await dialog.showOpenDialog({
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: 'Audio / Video', extensions: ['wav', 'flac', 'mp3', 'm4a', 'aiff', 'aif', 'ogg', 'mp4', 'mov', 'webm'] }
      ]
    })
    return res.canceled ? null : res.filePaths
  })

  ipcMain.handle('dialog:pick-image', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  /* Drag stems out to a DAW / Finder. Must run synchronously inside the
     dragstart-triggered IPC, and the icon must be a valid non-zero image —
     macOS silently no-ops the drag otherwise ("draggingFrame cannot be zero",
     the bug behind createEmpty()). Same approach as Covo's drag-out. */
  const DRAG_FALLBACK_ICON =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAxElEQVR4nO3bsQ0CMRQFweuHjqiTrmiCDOkEnM4iGLA32Pz9ie3tcr1tg91/vKF7Zjj4K5CZDz8FscrxHxFWOv4twmrHvyCsePwOIYBFj38iBBBAAHwELQA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AF0EPJAAIIYFGEfoz0aapvc32c7OvsEcAsEIf3nQH4N5Chex6Na5kIr/fmLAAAAABJRU5ErkJggg=='
  ipcMain.on('drag:start', (e, paths: string[], iconDataUrl?: string) => {
    if (!Array.isArray(paths) || paths.length === 0) return
    let icon = iconDataUrl ? nativeImage.createFromDataURL(iconDataUrl) : nativeImage.createEmpty()
    if (icon.isEmpty()) icon = nativeImage.createFromDataURL(DRAG_FALLBACK_ICON)
    const sz = icon.getSize()
    if (!sz || sz.width < 1 || sz.height < 1) icon = nativeImage.createFromDataURL(DRAG_FALLBACK_ICON)
    try {
      icon = icon.resize({ width: 64 })
    } catch {
      /* keep as-is */
    }
    try {
      e.sender.startDrag({ file: paths[0], files: paths, icon })
    } catch {
      /* drag canceled by the OS — nothing to clean up */
    }
  })

  createWindow()

  // Connect Discord Rich Presence unless the user turned it off (on by default,
  // ships with a client id). Fails silently if Discord isn't running; retries
  // on its own once it's up.
  if (getSetting('discordRpc') !== false) void enableDiscord(true)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
