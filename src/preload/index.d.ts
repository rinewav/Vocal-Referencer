import type { VrApi } from './index'

declare global {
  interface Window {
    vr?: VrApi
  }
}

export {}
