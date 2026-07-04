/* Peak waveform on canvas. The own track can be shifted by offsetSec and
   dragged horizontally to fine-tune alignment. Click seeks. */
import React, { useEffect, useRef } from 'react'
import { computePeaks } from '../lib/audio'

export interface WaveformProps {
  buffer: AudioBuffer
  color: string
  /* seconds the waveform is shifted right relative to the timeline */
  offsetSec?: number
  /* timeline length in seconds (shared across tracks) */
  timelineSec: number
  playheadSec: number | null
  onSeek?: (sec: number) => void
  onDragOffset?: (deltaSec: number) => void
  height?: number
}

export function Waveform({ buffer, color, offsetSec = 0, timelineSec, playheadSec, onSeek, onDragOffset, height = 84 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<{ min: Float32Array; max: Float32Array; width: number } | null>(null)
  const dragRef = useRef<{ startX: number; moved: boolean } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    canvas.width = cssWidth * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    // peaks are computed against the buffer's own pixel span on the timeline
    const pxPerSec = cssWidth / timelineSec
    const bufPx = Math.max(1, Math.round(buffer.duration * pxPerSec))
    if (!peaksRef.current || peaksRef.current.width !== bufPx) {
      const { min, max } = computePeaks(buffer, bufPx)
      peaksRef.current = { min, max, width: bufPx }
    }
    const { min, max } = peaksRef.current
    const x0 = offsetSec * pxPerSec

    ctx.clearRect(0, 0, cssWidth, height)
    const mid = height / 2
    ctx.fillStyle = color
    for (let x = 0; x < bufPx; x++) {
      const gx = x + x0
      if (gx < 0 || gx > cssWidth) continue
      const yLo = mid + min[x] * (mid - 2)
      const yHi = mid + max[x] * (mid - 2)
      ctx.fillRect(gx, yHi, 1, Math.max(1, yLo - yHi))
    }
    // playhead
    if (playheadSec !== null) {
      const px = playheadSec * pxPerSec
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(px, 0, 1.5, height)
    }
  }, [buffer, color, offsetSec, timelineSec, playheadSec, height])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block', borderRadius: 'var(--r-sm)', background: 'var(--bg-canvas-2)', cursor: onDragOffset ? 'grab' : 'pointer' }}
      onMouseDown={(e) => {
        dragRef.current = { startX: e.clientX, moved: false }
        const el = e.currentTarget
        const pxPerSec = el.clientWidth / timelineSec
        const onMove = (ev: MouseEvent) => {
          if (!dragRef.current || !onDragOffset) return
          const dx = ev.clientX - dragRef.current.startX
          if (Math.abs(dx) > 2) dragRef.current.moved = true
          if (dragRef.current.moved) {
            onDragOffset(dx / pxPerSec)
            dragRef.current.startX = ev.clientX
          }
        }
        const onUp = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          if (dragRef.current && !dragRef.current.moved && onSeek) {
            const rect = el.getBoundingClientRect()
            onSeek(((ev.clientX - rect.left) / rect.width) * timelineSec)
          }
          dragRef.current = null
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }}
    />
  )
}
