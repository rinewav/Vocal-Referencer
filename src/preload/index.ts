import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  engine: {
    health: () => ipcRenderer.invoke('engine:health'),
    install: () => ipcRenderer.invoke('engine:install'),
    manifest: () => ipcRenderer.invoke('engine:manifest'),
    onInstall: (cb: (progress: unknown) => void) => {
      const listener = (_e: unknown, progress: unknown) => cb(progress)
      ipcRenderer.on('engine:install-progress', listener)
      return () => {
        ipcRenderer.removeListener('engine:install-progress', listener)
      }
    }
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    add: (filePath: string) => ipcRenderer.invoke('library:add', filePath),
    addOwn: (songId: string, filePath: string) => ipcRenderer.invoke('library:add-own', songId, filePath),
    rename: (songId: string, title: string) => ipcRenderer.invoke('library:rename', songId, title),
    remove: (songId: string) => ipcRenderer.invoke('library:delete', songId)
  },
  separate: {
    start: (songId: string, preset: string) => ipcRenderer.invoke('separate:start', songId, preset),
    onProgress: (cb: (progress: unknown) => void) => {
      const listener = (_e: unknown, progress: unknown) => cb(progress)
      ipcRenderer.on('separate:progress', listener)
      return () => {
        ipcRenderer.removeListener('separate:progress', listener)
      }
    }
  },
  exportProQ: (bands: { freqHz: number; gainDb: number; q: number }[], defaultName: string) =>
    ipcRenderer.invoke('export:proq', bands, defaultName) as Promise<string | null>,
  pickAudio: (multi: boolean) => ipcRenderer.invoke('dialog:pick-audio', multi) as Promise<string[] | null>,
  dragStart: (paths: string[]) => ipcRenderer.send('drag:start', paths),
  pathForFile: (file: File) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('vr', api)

export type VrApi = typeof api
