/* Discord Rich Presence over the local IPC socket — no external dependency.
   Speaks the raw Discord-RPC framing (op + length + JSON) directly so we avoid
   pulling in discord-rpc / native modules. Everything here fails silently when
   Discord isn't running and retries on its own once it comes up. */
import { createConnection, Socket } from 'net'
import { randomUUID } from 'crypto'
import { getSetting } from './settings'

// Discord application ("client") id from the Developer Portal. It decides the
// app name + artwork shown on the profile. Ships with Vocal Referencer's own
// app id; per-user override via the `discordClientId` setting.
const DEFAULT_CLIENT_ID = '1523213928660729876'

const OP_HANDSHAKE = 0
const OP_FRAME = 1

type PresenceState = { view?: string; lang?: string }

let sock: Socket | null = null
let connected = false // handshake acknowledged (READY dispatch received)
let enabled = false
let idle = false
let last: PresenceState = {}
let reconnectTimer: NodeJS.Timeout | null = null
let rbuf = Buffer.alloc(0)
const startedAt = Date.now()

function clientId(): string {
  const fromSetting = getSetting('discordClientId')
  return (typeof fromSetting === 'string' && fromSetting.trim()) || DEFAULT_CLIENT_ID
}

/* Discord opens one socket per running client instance (…-0 … …-9). */
function ipcCandidates(): string[] {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  }
  const base =
    process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp'
  const dir = base.replace(/\/+$/, '')
  return Array.from({ length: 10 }, (_, i) => `${dir}/discord-ipc-${i}`)
}

function encode(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

function activity(): Record<string, unknown> {
  const ja = last.lang === 'ja'
  let details: string
  if (idle) details = ja ? 'アイドル中…' : 'Idle…'
  else if (last.view === 'compare') details = ja ? 'ボーカルを比較中' : 'Comparing a vocal'
  else details = ja ? 'ライブラリを表示中' : 'Browsing the library'
  return {
    details,
    state: 'Vocal Referencer',
    timestamps: { start: startedAt },
    assets: { large_image: 'app', large_text: 'Vocal Referencer' },
    buttons: [{ label: 'Get Vocal Referencer', url: 'https://rinedayo.booth.pm/' }],
    instance: false
  }
}

function sendActivity(): void {
  if (!sock || !connected) return
  const payload = {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: activity() },
    nonce: randomUUID()
  }
  try {
    sock.write(encode(OP_FRAME, payload))
  } catch {
    /* socket died mid-write — the close handler will reconnect */
  }
}

/* Reassemble length-prefixed frames and watch for the READY dispatch that
   Discord sends after a successful handshake. */
function onData(chunk: Buffer): void {
  rbuf = Buffer.concat([rbuf, chunk])
  while (rbuf.length >= 8) {
    const len = rbuf.readInt32LE(4)
    if (rbuf.length < 8 + len) break
    const body = rbuf.subarray(8, 8 + len)
    rbuf = rbuf.subarray(8 + len)
    try {
      const msg = JSON.parse(body.toString('utf8'))
      if (msg?.evt === 'READY') {
        connected = true
        sendActivity()
      }
    } catch {
      /* ignore malformed frame */
    }
  }
}

function cleanup(): void {
  connected = false
  rbuf = Buffer.alloc(0)
  if (sock) {
    sock.removeAllListeners()
    try {
      sock.destroy()
    } catch {
      /* already gone */
    }
    sock = null
  }
}

function scheduleReconnect(): void {
  if (!enabled || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (enabled) connect(0)
  }, 15000)
}

function connect(index: number): void {
  if (!enabled || !clientId()) return
  const candidates = ipcCandidates()
  if (index >= candidates.length) {
    // no live Discord socket found — try again later in case it launches
    scheduleReconnect()
    return
  }
  cleanup()
  const s = createConnection(candidates[index])
  sock = s
  s.on('connect', () => {
    try {
      s.write(encode(OP_HANDSHAKE, { v: 1, client_id: clientId() }))
    } catch {
      /* handled by the error/close listeners */
    }
  })
  s.on('data', onData)
  s.on('error', () => {
    // this pipe isn't a live Discord (or it hung up) — try the next index
    cleanup()
    connect(index + 1)
  })
  s.on('close', () => {
    const wasConnected = connected
    cleanup()
    if (wasConnected) scheduleReconnect()
  })
}

export async function enableDiscord(on: boolean): Promise<{ ok: boolean; error?: string }> {
  enabled = on
  if (!on) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    cleanup()
    return { ok: true }
  }
  if (!clientId()) return { ok: false, error: 'no-client-id' }
  connect(0)
  return { ok: true }
}

export function setPresence(state: PresenceState): void {
  last = { ...last, ...state }
  sendActivity()
}

export function setDiscordIdle(on: boolean): void {
  idle = on
  sendActivity()
}
