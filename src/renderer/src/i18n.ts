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
  'lib.newProject': { ja: 'プロジェクトを新規作成', en: 'New project' },
  'lib.open': { ja: '開く', en: 'Open' },
  'lib.ref': { ja: 'リファレンス', en: 'Reference' },
  'lib.own': { ja: '自分のボーカル', en: 'Your vocal' },
  'lib.notSet': { ja: '未登録', en: 'Not set' },
  'lib.setRef': { ja: 'リファレンス登録', en: 'Set reference' },
  'lib.replaceRef': { ja: 'リファレンス差し替え', en: 'Replace reference' },
  'lib.rename': { ja: '名称変更', en: 'Rename' },
  'lib.thumb': { ja: 'サムネイル画像を設定', en: 'Set thumbnail image' },
  'lib.dropHint': {
    ja: '音声 / 動画ファイルをドロップでプロジェクト作成。タイルにドロップで登録',
    en: 'Drop audio / video here to create a project, or onto a tile to attach'
  },
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
  'cmp.exportProq': { ja: 'Pro-Q 3/4', en: 'Pro-Q 3/4' },
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
  'cmp.legendOwn': { ja: '自分', en: 'Yours' },
  'set.title': { ja: '設定', en: 'Settings' },
  'set.nav.appearance': { ja: '外観', en: 'Appearance' },
  'set.nav.general': { ja: '一般', en: 'General' },
  'set.nav.analysis': { ja: '解析・表示', en: 'Analysis' },
  'set.nav.export': { ja: '書き出し', en: 'Export' },
  'set.nav.about': { ja: 'このアプリについて', en: 'About' },
  'set.theme': { ja: 'テーマ', en: 'Theme' },
  'set.themeSub': { ja: 'アクセントと背景のパレットを切り替えます', en: 'Swap the accent and background palette' },
  'set.language': { ja: '言語', en: 'Language' },
  'set.languageSub': { ja: '表示言語を切り替えます', en: 'Switch the display language' },
  'set.autoSep': { ja: '自動ステム分離', en: 'Auto stem separation' },
  'set.autoSepSub': {
    ja: 'リファレンス登録時に自動で実行する分離処理',
    en: 'Separation that runs automatically when a reference is added'
  },
  'set.autoSep.off': { ja: 'なし', en: 'Off' },
  'set.autoSep.vocal': { ja: 'ボーカルのみ', en: 'Vocals only' },
  'set.autoSep.full': { ja: 'リード/コーラスまで', en: 'Lead/backing too' },
  'set.tilt': { ja: 'アナライザースロープ (dB/oct)', en: 'Analyzer slope (dB/oct)' },
  'set.tiltSub': {
    ja: 'スペクトラム表示の傾き補正。4.5 dB/oct が Pro-Q と同じ見た目',
    en: 'Display tilt of the spectrum. 4.5 dB/oct matches Pro-Q'
  },
  'set.tiltNote': {
    ja: 'EQ推奨カーブは2音源の差分から作られるためスロープの影響を受けません。スペクトラム比較の見た目だけが変わります。',
    en: 'The suggested EQ curve is a difference of two spectra, so the slope only affects how the spectrum comparison looks.'
  },
  'set.bakeGain': { ja: 'ラウドネス補正ゲインを含めて書き出す', en: 'Bake loudness-match gain into exports' },
  'set.bakeGainSub': {
    ja: 'EQプリセットの出力ゲインに自動補正値を書き込み、DAWで開くだけでラウドネスが揃います',
    en: 'Writes the auto gain into the preset output gain so loudness matches right after loading'
  },
  'set.exportNote': {
    ja: '書き出し形式ごとのボタンは比較ビューの各カードにあります。',
    en: 'Per-format export buttons live on the cards in the compare view.'
  },
  'set.aboutBody': {
    ja: 'Vocal Referencer — ボーカルミックスのためのリファレンス解析ツール。すべての処理はローカルで実行されます。',
    en: 'Vocal Referencer — reference analysis for vocal mixing. Everything runs locally.'
  },
  'set.developer': { ja: '開発者', en: 'Developer' },
  'cmp.stage.align': { ja: 'オフセット検出', en: 'Detecting offset' },
  'cmp.stage.lufs': { ja: 'ラウドネス計測', en: 'Measuring loudness' },
  'cmp.stage.spectrum': { ja: 'スペクトラム解析', en: 'Analyzing spectrum' },
  'cmp.stage.comp': { ja: 'ダイナミクス解析', en: 'Analyzing dynamics' },
  'cmp.stage.render': { ja: '処理後ラウドネス実測', en: 'Measuring processed loudness' },
  'cmp.loudness': { ja: 'ラウドネス / ゲイン管理', en: 'Loudness / gain staging' },
  'cmp.lufs.ref': { ja: 'リファレンス', en: 'Reference' },
  'cmp.lufs.own': { ja: '自分 (未処理)', en: 'Yours (dry)' },
  'cmp.lufs.proc': { ja: '自分 (EQ+コンプ後)', en: 'Yours (processed)' },
  'cmp.gain.eq': { ja: 'EQ寄与', en: 'EQ contribution' },
  'cmp.gain.comp': { ja: 'コンプ変化', en: 'Comp change' },
  'cmp.gain.auto': { ja: '自動補正ゲイン', en: 'Auto match gain' },
  'cmp.gain.hint': {
    ja: 'DAWで再現するときは、EQ+コンプの後に自動補正ゲイン分のメイクアップを入れるとリファレンスと同じラウドネスになります。',
    en: 'To reproduce in your DAW, add the auto match gain as makeup after the EQ + compressor to land on the reference loudness.'
  },
  'cmp.monitor': { ja: 'モニター音量', en: 'Monitor volume' },
  'cmp.copy': { ja: 'コピー', en: 'Copy' },
  'cmp.copied': { ja: 'コピーした', en: 'Copied' },
  'cmp.exportZlEq': { ja: 'ZL Equalizer', en: 'ZL Equalizer' },
  'cmp.exportProC2': { ja: 'Pro-C 2', en: 'Pro-C 2' },
  'cmp.exportZlComp': { ja: 'ZL Compressor', en: 'ZL Compressor' },
  'cmp.export': { ja: '書き出し', en: 'Export' },
  'cmp.bakedGainNote': {
    ja: '書き出しにラウドネス補正ゲインを含む (設定で変更可)',
    en: 'Exports include the loudness-match gain (change in Settings)'
  },
  'cmp.loop': { ja: 'ループ', en: 'Loop' },
  'cmp.loopClear': { ja: 'ループ解除', en: 'Clear loop' },
  'cmp.setupHint': {
    ja: 'このプロジェクトにはまだ比較に必要な素材が揃っていません。リファレンスと自分のボーカルはどちらが先でも登録できます。',
    en: 'This project is missing sources for comparison. Reference and your vocal can be added in either order.'
  },
  'cmp.sepStatus': { ja: 'ボーカル分離', en: 'Vocal separation' },
  'cmp.sepDone': { ja: '完了', en: 'Done' },
  'cmp.sepNote': {
    ja: '分離はリファレンス登録時に自動実行されます (設定 → 一般 で変更可)。波形をドラッグするとループ区間を選択できます。',
    en: 'Separation runs automatically when a reference is added (Settings → General). Drag on a waveform to select a loop region.'
  }
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
