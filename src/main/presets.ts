/* Preset writers beyond Pro-Q (see proq.ts):
   ZL Equalizer 2: VST3 .vstpreset container wrapping the JUCE binary-framed
   APVTS XML. The class ID follows JUCE's deterministic CID scheme
   (ABCDEF01 9182FAEB + manufacturer 'Zliu' + plugin code), verified against
   a locally installed ZL plugin's moduleinfo.json. */
import { dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'

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
