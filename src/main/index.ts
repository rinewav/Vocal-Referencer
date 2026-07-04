import { app, BrowserWindow, ipcMain, shell, dialog, protocol, net, nativeImage } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

/* must run before app ready: allow fetch()/streaming on the audio scheme */
protocol.registerSchemesAsPrivileged([
  { scheme: 'vr-audio', privileges: { supportFetchAPI: true, stream: true } }
])
import { getSetting, setSetting } from './settings'
import { install, health, manifestSummary } from './engine/installer'
import { enqueueSeparation, Preset } from './engine/sidecar'
import { addSong, addOwnStem, listSongs, setTags } from './library'
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

  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => setSetting(key, value))
  ipcMain.handle('engine:health', () => health())
  ipcMain.handle('engine:install', () => install())
  ipcMain.handle('engine:manifest', () => manifestSummary())

  ipcMain.handle('library:list', () => listSongs())
  ipcMain.handle('library:add', (_e, filePath: string) => addSong(filePath))
  ipcMain.handle('library:add-own', (_e, songId: string, filePath: string) => addOwnStem(songId, filePath))
  ipcMain.handle('library:set-tags', (_e, songId: string, tags: string[]) => setTags(songId, tags))

  ipcMain.handle('separate:start', (_e, songId: string, preset: Preset) => enqueueSeparation(songId, preset))

  ipcMain.handle('dialog:pick-audio', async (_e, multi: boolean) => {
    const res = await dialog.showOpenDialog({
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'flac', 'mp3', 'm4a', 'aiff', 'aif', 'ogg'] }]
    })
    return res.canceled ? null : res.filePaths
  })

  /* drag stems out to a DAW / Finder */
  ipcMain.on('drag:start', (e, paths: string[]) => {
    if (!Array.isArray(paths) || paths.length === 0) return
    e.sender.startDrag({
      file: paths[0],
      files: paths,
      icon: nativeImage.createEmpty()
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
