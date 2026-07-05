/* Preset writers beyond Pro-Q (see proq.ts):
   - ZL Equalizer 2 / ZL Compressor: VST3 .vstpreset container wrapping the
     JUCE binary-framed APVTS XML. Class IDs follow JUCE's deterministic CID
     (ABCDEF01 9182FAEB + manufacturer 'Zliu' + plugin code), verified against
     the locally installed ZL Compressor moduleinfo.json.
   - FabFilter Pro-C 2: 'FC2p' v2 layout (46 floats). Threshold is raw dB
     (confirmed across factory presets); ratio/attack/release use deduced
     normalized curves — verify once in the plugin. Unset slots copy the
     factory "Default Setting" values. */
import { dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'

export interface CompParams {
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
}

export interface EqBand {
  freqHz: number
  gainDb: number
  q: number
}

/* ---------- VST3 preset container ---------- */

/* JUCE AudioProcessor::copyXmlToBinary framing: magic, text length, XML, NUL */
function juceStateBlock(xml: string): Buffer {
  const text = Buffer.from(xml, 'utf8')
  const buf = Buffer.alloc(8 + text.length + 1)
  buf.writeUInt32LE(0x21324344, 0)
  buf.writeUInt32LE(text.length + 1, 4)
  text.copy(buf, 8)
  return buf
}

/* .vstpreset: header, component-state chunk, chunk list */
function buildVstPreset(classId: string, comp: Buffer): Buffer {
  const HEADER = 48
  const listOffset = HEADER + comp.length
  const buf = Buffer.alloc(listOffset + 4 + 4 + 20) // 'List' + count + one entry
  buf.write('VST3', 0, 'ascii')
  buf.writeInt32LE(1, 4)
  buf.write(classId, 8, 'ascii')
  buf.writeBigInt64LE(BigInt(listOffset), 40)
  comp.copy(buf, HEADER)
  buf.write('List', listOffset, 'ascii')
  buf.writeInt32LE(1, listOffset + 4)
  buf.write('Comp', listOffset + 8, 'ascii')
  buf.writeBigInt64LE(BigInt(HEADER), listOffset + 12)
  buf.writeBigInt64LE(BigInt(comp.length), listOffset + 20)
  return buf
}

const param = (id: string, value: number) => `<PARAM id="${id}" value="${value}"/>`

/* ---------- ZL Equalizer 2 ---------- */

const ZLEQ_CID = 'ABCDEF019182FAEB5A6C697545717532' // 'Zliu' + 'Equ2'

export function buildZlEqPreset(bands: EqBand[], outputGainDb: number): Buffer {
  const params: string[] = []
  bands.slice(0, 24).forEach((b, i) => {
    params.push(
      param(`filter_status${i}`, 2), // On
      param(`filter_type${i}`, 0), // Peak
      param(`freq${i}`, +b.freqHz.toFixed(1)),
      param(`gain${i}`, +b.gainDb.toFixed(2)),
      param(`q${i}`, +b.q.toFixed(3))
    )
  })
  if (outputGainDb !== 0) params.push(param('total_output_gain', +Math.max(-30, Math.min(30, outputGainDb)).toFixed(2)))
  // root tag mirrors the plugin's setStateInformation check (verbatim, even
  // though ZLEqualizer reuses the ZLCompressor tag name upstream)
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?> <ZLCompressorParaState>' +
    `<ZLEqualizerParameters>${params.join('')}</ZLEqualizerParameters>` +
    '<ZLEqualizerNAParameters/></ZLCompressorParaState>'
  return buildVstPreset(ZLEQ_CID, juceStateBlock(xml))
}

/* ---------- ZL Compressor ---------- */

const ZLCOMP_CID = 'ABCDEF019182FAEB5A6C6975436F6D70' // 'Zliu' + 'Comp'

export function buildZlCompPreset(comp: CompParams): Buffer {
  const params = [
    param('threshold', +Math.max(-100, Math.min(0, comp.thresholdDb)).toFixed(1)),
    param('ratio', +Math.max(1, Math.min(100, comp.ratio)).toFixed(2)),
    param('attack', +Math.max(0, Math.min(1000, comp.attackMs)).toFixed(1)),
    param('release', +Math.max(0, Math.min(5000, comp.releaseMs)).toFixed(1)),
    param('knee_width', 6)
  ]
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?> <ZLCompressorParaState>' +
    `<ZLCompressorParameters>${params.join('')}</ZLCompressorParameters>` +
    '<ZLCompressorNAParameters/></ZLCompressorParaState>'
  return buildVstPreset(ZLCOMP_CID, juceStateBlock(xml))
}

/* ---------- FabFilter Pro-C 2 ---------- */

/* factory "Default Setting.ffp" floats — indices we don't understand stay
   exactly as FabFilter ships them so the file always loads cleanly */
const PROC2_DEFAULTS = [
  0, -18, 0.6, 18, 60, 0.1, 0.4112, 0, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0.5, 0, 0,
  6.6439, 3, 1, 1, 9.9658, 0, 0.5, 0, 0, 12.2877, 3, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1
]

export function buildProC2Ffp(comp: CompParams): Buffer {
  const f = [...PROC2_DEFAULTS]
  f[0] = 0 // style: Clean
  f[1] = Math.max(-36, Math.min(0, comp.thresholdDb))
  f[2] = Math.max(0, Math.min(1, Math.log2(Math.max(1, comp.ratio)) / 5)) // 1..32 log
  f[3] = 6 // knee dB (matches the preview compressor)
  f[5] = Math.max(0, Math.min(1, Math.log(comp.attackMs / 0.005) / Math.log(50000))) // 0.005..250 ms log
  f[6] = Math.max(0, Math.min(1, Math.log(comp.releaseMs / 5) / Math.log(500))) // 5..2500 ms log

  const buf = Buffer.alloc(12 + f.length * 4)
  buf.write('FC2p', 0, 'ascii')
  buf.writeInt32LE(2, 4)
  buf.writeInt32LE(f.length, 8)
  f.forEach((v, i) => buf.writeFloatLE(v, 12 + i * 4))
  return buf
}

/* ---------- save dialog ---------- */

export async function saveBuffer(defaultName: string, filterName: string, ext: string, data: Buffer): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName.replace(/[/\\:]/g, '_'),
    filters: [{ name: filterName, extensions: [ext] }]
  })
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, data)
  return res.filePath
}
