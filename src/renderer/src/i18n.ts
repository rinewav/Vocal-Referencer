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
  'fr.agreePre': { ja: '約1.5GBのダウンロードと、', en: 'I agree to download about 1.5 GB and ' },
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
