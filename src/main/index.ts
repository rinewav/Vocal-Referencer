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
  resetLibraryData
} from './library'
import { exportProQ, ExportBand } from './proq'
import { buildZlEqPreset, saveBuffer, EqBand } from './presets'
import { libraryRoot } from './db'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#14161c', // Nightfall canvas approximation until CSS paints
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

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
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => setSetting(key, value))

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
