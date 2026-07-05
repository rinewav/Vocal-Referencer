import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  /* renderer-side platform switch (titlebar layout, window controls) */
  platform: process.platform as string,
  /* frameless-window controls — no-ops on mac (native traffic lights) */
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximizeToggle: () => ipcRenderer.send('win:maximize-toggle'),
    close: () => ipcRenderer.send('win:close')
  },
  /* reveal a library file in Finder / Explorer */
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path) as Promise<void>,
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  /* factory reset — wipes the library + settings and relaunches the app */
  resetApp: () => ipcRenderer.invoke('app:reset') as Promise<void>,
  /* Discord Rich Presence */
  discord: {
    enable: (on: boolean) => ipcRenderer.invoke('discord:enable', on) as Promise<{ ok: boolean; error?: string }>,
    setPresence: (state: { view?: string; lang?: string }) => ipcRenderer.invoke('discord:presence', state) as Promise<void>
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
    create: () => ipcRenderer.invoke('library:create'),
    setRef: (songId: string, filePath: string) => ipcRenderer.invoke('library:set-ref', songId, filePath),
    convertRefWav: (songId: string, wav: ArrayBuffer) => ipcRenderer.invoke('library:convert-ref-wav', songId, wav),
    setThumbFile: (songId: string, imagePath: string) => ipcRenderer.invoke('library:set-thumb-file', songId, imagePath),
    setThumbData: (songId: string, dataUrl: string) => ipcRenderer.invoke('library:set-thumb-data', songId, dataUrl),
    addOwn: (songId: string, filePath: string) => ipcRenderer.invoke('library:add-own', songId, filePath),
    rename: (songId: string, title: string) => ipcRenderer.invoke('library:rename', songId, title),
    remove: (songId: string) => ipcRenderer.invoke('library:delete', songId),
    removeOwnStem: (stemId: string) => ipcRenderer.invoke('library:remove-own-stem', stemId)
  },
  cache: {
    get: (key: string) => ipcRenderer.invoke('cache:get', key) as Promise<string | null>,
    set: (key: string, songId: string, data: string) => ipcRenderer.invoke('cache:set', key, songId, data)
  },
  pickImage: () => ipcRenderer.invoke('dialog:pick-image') as Promise<string | null>,
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
  exportProQ: (bands: { freqHz: number; gainDb: number; q: number }[], defaultName: string, outputGainDb?: number) =>
    ipcRenderer.invoke('export:proq', bands, defaultName, outputGainDb ?? 0) as Promise<string | null>,
  exportZlEq: (bands: { freqHz: number; gainDb: number; q: number }[], defaultName: string, outputGainDb?: number) =>
    ipcRenderer.invoke('export:zleq', bands, defaultName, outputGainDb ?? 0) as Promise<string | null>,
  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  /* notify-only update check against the GitHub latest release (never installs) */
  checkUpdate: () =>
    ipcRenderer.invoke('app:check-update') as Promise<{
      current: string
      latest?: string
      url?: string
      updateAvailable: boolean
    }>,
  openDownload: (url?: string) => ipcRenderer.invoke('app:open-download', url) as Promise<void>,
  pickAudio: (multi: boolean) => ipcRenderer.invoke('dialog:pick-audio', multi) as Promise<string[] | null>,
  dragStart: (paths: string[], iconDataUrl?: string) => ipcRenderer.send('drag:start', paths, iconDataUrl),
  pathForFile: (file: File) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('vr', api)

export type VrApi = typeof api
