import { contextBridge, ipcRenderer } from 'electron'

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
      return () => ipcRenderer.removeListener('engine:install-progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('vr', api)

export type VrApi = typeof api
