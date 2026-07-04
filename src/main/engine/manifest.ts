/* Download manifest for the first-run engine setup.
   Sizes are advertised estimates for the consent screen; real totals come
   from Content-Length at download time. */

export interface EnginePart {
  /* stable key, also shown as the row name in FirstRun */
  name: string
  kind: 'python-runtime' | 'pip' | 'model'
  /* estimated size label for the consent screen */
  sizeLabel: string
  /* archive URL — python-runtime only, resolved per platform */
  url?: string
  /* model filename — model parts only; download (incl. config yaml pairing)
     is delegated to `audio-separator --download_model_only` */
  modelFilename?: string
}

const PBS_TAG = '20241016'
const PBS_PY = '3.12.7'

function pythonRuntimeUrl(): string {
  const base = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}`
  const triple =
    process.platform === 'win32'
      ? 'x86_64-pc-windows-msvc'
      : process.arch === 'arm64'
        ? 'aarch64-apple-darwin'
        : 'x86_64-apple-darwin'
  return `${base}/cpython-${PBS_PY}+${PBS_TAG}-${triple}-install_only.tar.gz`
}

/* Default separation model: BS-Roformer ep317 (UVR model zoo, vocal/inst SOTA lineage).
   Filename must match audio-separator's models.json registry. */
export const DEFAULT_MODEL_FILE = 'model_bs_roformer_ep_317_sdr_12.9755.ckpt'

export function engineManifest(): EnginePart[] {
  return [
    {
      name: 'Python Runtime',
      kind: 'python-runtime',
      sizeLabel: '~45 MB',
      url: pythonRuntimeUrl()
    },
    {
      name: 'Audio Engine',
      kind: 'pip',
      sizeLabel: '~800 MB'
    },
    {
      name: 'Separation Model',
      kind: 'model',
      sizeLabel: '~600 MB',
      modelFilename: DEFAULT_MODEL_FILE
    }
  ]
}

/* pip packages installed into the bundled runtime */
export const PIP_PACKAGES = ['audio-separator[cpu]']
