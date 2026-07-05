/* Theme presets (Covo pattern): full-palette swaps applied as CSS variables.
   Blush matches the covo.css defaults, so it is the implicit fallback. */

export interface Theme {
  label: string
  accentL: number
  accentC: number
  accentH: number
  swatch: string
  canvas: string
  canvas2: string
  chrome: string
  elevated: string
}

export const THEMES: Record<string, Theme> = {
  Blush: { label: 'Blush', accentL: 0.78, accentC: 0.165, accentH: 350, swatch: 'oklch(0.78 0.165 350)',
    canvas: 'oklch(0.185 0.013 350)', canvas2: 'oklch(0.16 0.013 350)', chrome: 'oklch(0.17 0.014 350)', elevated: 'oklch(0.23 0.016 350)' },
  Crimson: { label: 'Crimson', accentL: 0.66, accentC: 0.16, accentH: 25, swatch: 'oklch(0.66 0.16 25)',
    canvas: 'oklch(0.18 0.016 25)', canvas2: 'oklch(0.155 0.016 25)', chrome: 'oklch(0.165 0.018 25)', elevated: 'oklch(0.225 0.02 25)' },
  Nightfall: { label: 'Nightfall', accentL: 0.70, accentC: 0.13, accentH: 255, swatch: 'oklch(0.70 0.13 255)',
    canvas: 'oklch(0.18 0.008 255)', canvas2: 'oklch(0.155 0.008 255)', chrome: 'oklch(0.165 0.009 255)', elevated: 'oklch(0.225 0.01 255)' },
  Graphite: { label: 'Graphite', accentL: 0.72, accentC: 0.04, accentH: 285, swatch: 'oklch(0.72 0.04 285)',
    canvas: 'oklch(0.185 0.002 285)', canvas2: 'oklch(0.16 0.002 285)', chrome: 'oklch(0.17 0.002 285)', elevated: 'oklch(0.23 0.003 285)' },
  Tide: { label: 'Tide', accentL: 0.74, accentC: 0.11, accentH: 196, swatch: 'oklch(0.74 0.11 196)',
    canvas: 'oklch(0.18 0.013 215)', canvas2: 'oklch(0.155 0.013 215)', chrome: 'oklch(0.165 0.014 215)', elevated: 'oklch(0.225 0.015 215)' },
  Aubergine: { label: 'Aubergine', accentL: 0.68, accentC: 0.15, accentH: 300, swatch: 'oklch(0.68 0.15 300)',
    canvas: 'oklch(0.185 0.015 320)', canvas2: 'oklch(0.16 0.015 320)', chrome: 'oklch(0.17 0.016 320)', elevated: 'oklch(0.23 0.017 320)' },
  Ember: { label: 'Ember', accentL: 0.74, accentC: 0.13, accentH: 55, swatch: 'oklch(0.74 0.13 55)',
    canvas: 'oklch(0.185 0.013 45)', canvas2: 'oklch(0.16 0.013 45)', chrome: 'oklch(0.17 0.014 45)', elevated: 'oklch(0.23 0.015 45)' }
}

export function applyTheme(id: string): void {
  const th = THEMES[id] ?? THEMES.Blush
  const r = document.documentElement.style
  r.setProperty('--accent-l', String(th.accentL))
  r.setProperty('--accent-c', String(th.accentC))
  r.setProperty('--accent-h', String(th.accentH))
  r.setProperty('--bg-canvas', th.canvas)
  r.setProperty('--bg-canvas-2', th.canvas2)
  r.setProperty('--bg-chrome', th.chrome)
  r.setProperty('--bg-elevated', th.elevated)
}
