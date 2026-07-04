/* FabFilter Pro-Q 3 preset (.ffp) writer. Pro-Q 4 loads these natively via
   its V3 preset folder, so targeting the reverse-engineered v3 layout covers
   both. Layout (little-endian, after raoulsh/preset-toolkit):
     'FQ3p' | int32 version=4 | int32 paramCount=334
     24 bands × 13 floats | 22 global floats                                */
import { dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'

export interface ExportBand {
  freqHz: number
  gainDb: number
  q: number
}

const BAND_SLOTS = 24
const FLOATS_PER_BAND = 13
const GLOBALS = [
  0, // process_mode: zero latency
  1, // linear_mode_value: med
  1, // gain_scale
  0, // output_gain
  0, // output_pan
  0, // unknown1
  0, // bypass
  0, // phase_invert
  0, // auto_gain
  1, // analyzer_pre
  1, // analyzer_post
  -1, // analyzer_sidechain: off
  1, // analyzer_range: 90 dB
  2, // analyzer_res: high
  2, // analyzer_speed: medium
  3, // analyzer_tilt: 4.5 dB
  0, // unknown2
  1, // show_collisions
  1, // spectrum_grab
  2, // display_range: 12 dB
  0, // enable_midi (inverted)
  0 // unknown3
]

function bandFloats(band: ExportBand | null): number[] {
  if (!band) {
    // disabled slot defaults
    return [0, 1, Math.log2(1000), 0, 0, 1, 1, 0.5, 0, 1, 2, 1, 0]
  }
  return [
    1, // enabled
    1, // not bypassed
    Math.log2(band.freqHz),
    band.gainDb,
    0, // dyn_range
    1, // dyn_range_enabled (default)
    1, // dyn_range_th (default)
    0.5 + 0.312098175 * Math.log10(band.q),
    0, // filter_type: bell
    1, // lp_hp_slope: 12 dB/oct (unused for bell)
    2, // stereo_placement: stereo
    1, // unknown1
    0 // unknown2
  ]
}

export function buildFfp(bands: ExportBand[]): Buffer {
  const floats: number[] = []
  for (let i = 0; i < BAND_SLOTS; i++) floats.push(...bandFloats(bands[i] ?? null))
  floats.push(...GLOBALS)

  const buf = Buffer.alloc(12 + floats.length * 4)
  buf.write('FQ3p', 0, 'ascii')
  buf.writeInt32LE(4, 4)
  buf.writeInt32LE(floats.length, 8)
  floats.forEach((v, i) => buf.writeFloatLE(v, 12 + i * 4))
  return buf
}

export async function exportProQ(bands: ExportBand[], defaultName: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName.replace(/[/\\:]/g, '_'),
    filters: [{ name: 'FabFilter Preset', extensions: ['ffp'] }]
  })
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, buildFfp(bands.slice(0, BAND_SLOTS)))
  return res.filePath
}
