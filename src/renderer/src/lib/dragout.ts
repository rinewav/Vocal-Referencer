/* Native drag-out to a DAW / Finder. The main process needs a real non-zero
   drag icon on macOS, so we render a small waveform card on a canvas and ship
   it along with the paths. */

let cachedIcon: string | null = null

function dragIconDataUrl(): string {
  if (cachedIcon) return cachedIcon
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 96
  const g = c.getContext('2d')!
  g.beginPath()
  g.roundRect(4, 4, 88, 88, 18)
  g.fillStyle = 'rgba(28, 32, 44, 0.95)'
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.25)'
  g.lineWidth = 2
  g.stroke()
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  g.fillStyle = accent || 'rgb(90, 140, 240)'
  const bars = [18, 34, 52, 30, 60, 40, 24]
  bars.forEach((h, i) => g.fillRect(17 + i * 9.5, 48 - h / 2, 6, h))
  cachedIcon = c.toDataURL('image/png')
  return cachedIcon
}

export function dragOut(paths: string[]): void {
  window.vr!.dragStart(paths, dragIconDataUrl())
}
