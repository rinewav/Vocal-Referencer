/* Minimal i18n (Covo pattern): tr(key) + Lang.set + useLang() re-render hook. */
import { useSyncExternalStore } from 'react'

export type LangCode = 'ja' | 'en'

const STRINGS: Record<string, { ja: string; en: string }> = {
  'fr.welcome': { ja: 'Vocal Referencer へようこそ', en: 'Welcome to Vocal Referencer' },
  'fr.tagline': {
    ja: 'ボーカルミックスのためのリファレンス解析',
    en: 'Reference analysis for vocal mixing'
  },
  'fr.consent': {
    ja: 'ボーカル分離と解析には追加コンポーネントが必要です。以下をダウンロードしてセットアップします。すべてこのMac / PCの中だけで処理され、音声が外部に送信されることはありません。',
    en: 'Vocal separation and analysis require additional components. The following will be downloaded and set up. Everything runs locally — your audio never leaves this machine.'
  },
  'fr.installs': { ja: 'ダウンロードされるもの', en: 'What will be installed' },
  'fr.role.python-runtime': { ja: '解析エンジンの実行環境', en: 'Runtime for the analysis engine' },
  'fr.role.pip': { ja: 'ボーカル分離・解析ライブラリ', en: 'Separation & analysis libraries' },
  'fr.role.model': { ja: 'ボーカル分離AIモデル (BS-Roformer)', en: 'Separation AI model (BS-Roformer)' },
  'fr.role.model-karaoke': { ja: 'リード/コーラス分離AIモデル (Mel-Roformer)', en: 'Lead/backing split model (Mel-Roformer)' },
  'fr.agreePre': { ja: '約1.8GBのダウンロードと、', en: 'I agree to download about 1.8 GB and ' },
  'fr.agreeBold': { ja: 'モデル・ライブラリの各ライセンス', en: 'the licenses of the models and libraries' },
  'fr.agreePost': { ja: 'に同意します。', en: '.' },
  'fr.skip': { ja: 'あとでセットアップ', en: 'Set up later' },
  'fr.setup': { ja: 'ダウンロードして開始', en: 'Download & set up' },
  'fr.fetching': {
    ja: 'コンポーネントを取得しています。回線によっては数分かかります…',
    en: 'Fetching components. This can take a few minutes…'
  },
  'fr.allset': { ja: '準備ができました。', en: 'All set.' },
  'fr.incomplete': {
    ja: 'セットアップが完了しませんでした。再試行できます。',
    en: 'Setup did not complete. You can retry.'
  },
  'fr.statusFetching': { ja: 'fetching', en: 'fetching' },
  'fr.statusReady': { ja: 'ready', en: 'ready' },
  'fr.statusIncomplete': { ja: 'incomplete', en: 'incomplete' },
  'fr.retry': { ja: '再試行', en: 'Retry' },
  'fr.open': { ja: 'はじめる', en: 'Open Vocal Referencer' },
  'app.emptyLibrary': {
    ja: '曲を追加してリファレンスライブラリを作りましょう',
    en: 'Add a song to start your reference library'
  },
  'nav.library': { ja: 'ライブラリ', en: 'Library' },
  'nav.compare': { ja: '比較', en: 'Compare' },
  'lib.add': { ja: 'リファレンスを追加', en: 'Add reference' },
  'lib.dropHint': { ja: 'ここに音声ファイルをドロップでも追加できます', en: 'You can also drop audio files here' },
  'lib.separate': { ja: 'ボーカル抽出', en: 'Extract vocals' },
  'lib.separateKaraoke': { ja: 'リード/コーラス分離', en: 'Split lead/backing' },
  'lib.addOwn': { ja: '自分のボーカル', en: 'Your vocal' },
  'lib.compare': { ja: '比較', en: 'Compare' },
  'lib.stemDragHint': { ja: 'チップやサムネイルはDAWへドラッグで書き出し / サムネイルに音源をドロップで自分のボーカル追加', en: 'Drag chips/thumbnails into your DAW · drop audio onto a tile to attach your vocal' },
  'lib.delete': { ja: '削除', en: 'Delete' },
  'lib.deleteConfirm': { ja: '削除する？', en: 'Sure?' },
  'lib.stage.model-download': { ja: 'モデル取得中', en: 'Fetching model' },
  'lib.stage.separating': { ja: '分離中', en: 'Separating' },
  'lib.stage.error': { ja: '失敗', en: 'Failed' },
  'stem.vocals': { ja: 'ボーカル', en: 'Vocals' },
  'stem.instrumental': { ja: 'インスト', en: 'Instrumental' },
  'stem.lead': { ja: 'リード', en: 'Lead' },
  'stem.backing': { ja: 'コーラス', en: 'Backing' },
  'stem.own': { ja: '自分', en: 'Mine' },
  'cmp.pickSong': { ja: 'ライブラリで曲を選んで「比較する」を押してください', en: 'Pick a song in the library and hit Compare' },
  'cmp.loading': { ja: '解析中…', en: 'Analyzing…' },
  'cmp.refTrack': { ja: 'リファレンス', en: 'Reference' },
  'cmp.ownTrack': { ja: '自分のボーカル', en: 'Your vocal' },
  'cmp.play': { ja: '再生', en: 'Play' },
  'cmp.stop': { ja: '停止', en: 'Stop' },
  'cmp.listenRef': { ja: 'リファレンスを聴く (Tab切替)', en: 'Hearing reference (Tab to switch)' },
  'cmp.listenOwn': { ja: '自分を聴く (Tab切替)', en: 'Hearing yours (Tab to switch)' },
  'cmp.loudnessMatch': { ja: 'ラウドネスマッチ', en: 'Loudness match' },
  'cmp.autoAlign': { ja: '自動アライン', en: 'Auto align' },
  'cmp.offset': { ja: 'オフセット', en: 'Offset' },
  'cmp.spectrum': { ja: 'スペクトラム比較', en: 'Spectrum comparison' },
  'cmp.eqCurve': { ja: 'EQ推奨カーブ', en: 'Suggested EQ curve' },
  'cmp.dynamics': { ja: 'ダイナミクス変化', en: 'Dynamics' },
  'cmp.legendComp': { ja: '推奨コンプ適用後', en: 'With suggested comp' },
  'cmp.simulate': { ja: '処理プレビュー (推奨EQ+コンプ)', en: 'Preview suggested EQ+comp' },
  'cmp.exportProq': { ja: 'Pro-Q 3/4 へ書き出し', en: 'Export for Pro-Q 3/4' },
  'cmp.exported': { ja: '保存した', en: 'Saved' },
  'cmp.legendFit': { ja: '書き出されるバンド近似', en: 'Exported band fit' },
  'cmp.comp': { ja: '等価コンプ設定（推定）', en: 'Equivalent compressor (estimated)' },
  'cmp.comp.none': { ja: '追いコンプ不要 — ダイナミクスはリファレンス相当', en: 'No extra compression needed — dynamics already match' },
  'cmp.comp.ratio': { ja: 'レシオ', en: 'Ratio' },
  'cmp.comp.threshold': { ja: 'スレッショルド', en: 'Threshold' },
  'cmp.comp.attack': { ja: 'アタック', en: 'Attack' },
  'cmp.comp.release': { ja: 'リリース', en: 'Release' },
  'cmp.comp.basis': { ja: '根拠: ダイナミックレンジ(P95−P10)', en: 'Basis: dynamic range (P95−P10)' },
  'cmp.legendRef': { ja: 'リファレンス', en: 'Reference' },
  'cmp.legendOwn': { ja: '自分', en: 'Yours' }
}

let current: LangCode = (localStorage.getItem('vr.lang') as LangCode) || 'ja'
const listeners = new Set<() => void>()

export const Lang = {
  get: (): LangCode => current,
  set(code: LangCode) {
    current = code
    localStorage.setItem('vr.lang', code)
    listeners.forEach((fn) => fn())
  }
}

export function tr(key: string): string {
  const entry = STRINGS[key]
  if (!entry) return key
  return entry[current]
}

export function useLang(): LangCode {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}
