/* Peak waveform on canvas. The own track can be shifted by offsetSec and
   dragged horizontally to fine-tune alignment. Click seeks. Tracks with
   onSelectRange use drag to select a loop region instead. */
import React, { useEffect, useRef, useState } from 'react'
import { computePeaks } from '../lib/audio'

const fmtHover = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

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
  /* loop region drawn as a highlight (timeline seconds) */
  loopRange?: { a: number; b: number } | null
  /* drag reports a live [a, b] selection */
  onSelectRange?: (a: number, b: number) => void
  height?: number
}

export function Waveform({
  buffer,
  color,
  offsetSec = 0,
  timelineSec,
  playheadSec,
  onSeek,
  onDragOffset,
  loopRange,
  onSelectRange,
  height = 84
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<{ min: Float32Array; max: Float32Array; width: number } | null>(null)
  const dragRef = useRef<{ startX: number; moved: boolean } | null>(null)
  /* hover time readout (hidden while dragging) */
  const [hover, setHover] = useState<{ x: number; sec: number } | null>(null)

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
    // loop region
    if (loopRange) {
      const xa = loopRange.a * pxPerSec
      const xb = loopRange.b * pxPerSec
      ctx.fillStyle = 'rgba(255,255,255,0.09)'
      ctx.fillRect(xa, 0, Math.max(1, xb - xa), height)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(xa, 0, 1, height)
      ctx.fillRect(xb, 0, 1, height)
    }
    // playhead
    if (playheadSec !== null) {
      const px = playheadSec * pxPerSec
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(px, 0, 1.5, height)
    }
  }, [buffer, color, offsetSec, timelineSec, playheadSec, height, loopRange])

  return (
    <div style={{ position: 'relative' }}>
      {hover && (
        <div
          className="glass mono"
          style={{
            position: 'absolute',
            left: Math.max(28, Math.min(hover.x, (canvasRef.current?.clientWidth ?? 200) - 28)),
            top: -4,
            transform: 'translate(-50%, -100%)',
            padding: '3px 7px',
            borderRadius: 6,
            fontSize: 10.5,
            lineHeight: 1.4,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 5
          }}
        >
          {fmtHover(hover.sec)}
        </div>
      )}
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block', borderRadius: 'var(--r-sm)', background: 'var(--bg-canvas-2)', cursor: onDragOffset ? 'grab' : 'pointer' }}
      onMouseMove={(e) => {
        if (dragRef.current) return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        setHover({ x, sec: Math.max(0, Math.min(timelineSec, (x / rect.width) * timelineSec)) })
      }}
      onMouseLeave={() => setHover(null)}
      onMouseDown={(e) => {
        setHover(null)
        dragRef.current = { startX: e.clientX, moved: false }
        const el = e.currentTarget
        const rect = el.getBoundingClientRect()
        const pxPerSec = el.clientWidth / timelineSec
        const secAt = (clientX: number) =>
          Math.max(0, Math.min(timelineSec, ((clientX - rect.left) / rect.width) * timelineSec))
        const startSec = secAt(e.clientX)
        const onMove = (ev: MouseEvent) => {
          if (!dragRef.current) return
          const dx = ev.clientX - dragRef.current.startX
          if (Math.abs(dx) > 3) dragRef.current.moved = true
          if (!dragRef.current.moved) return
          if (onDragOffset) {
            onDragOffset(dx / pxPerSec)
            dragRef.current.startX = ev.clientX
          } else if (onSelectRange) {
            const cur = secAt(ev.clientX)
            onSelectRange(Math.min(startSec, cur), Math.max(startSec, cur))
          }
        }
        const onUp = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          if (dragRef.current && !dragRef.current.moved && onSeek) {
            onSeek(secAt(ev.clientX))
          }
          dragRef.current = null
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }}
    />
    </div>
  )
}
