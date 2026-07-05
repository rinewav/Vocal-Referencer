<div align="center">

# Vocal Referencer

**歌ってみた・ボーカルミックスのためのリファレンス解析デスクトップアプリ**

[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#インストール)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

好きな曲からボーカルを分離し、自分のボーカルと聴き比べ・見比べながら、
EQ やコンプの方向性を数値とグラフで検討できます。**処理はすべてローカルで完結します。**

*A local-first desktop app for vocal mix engineers: separate vocals from any song,
A/B them against your own take with auto-alignment and loudness matching,
and get EQ curve / compressor suggestions. Your audio never leaves your machine.*

</div>

<!-- スクリーンショットを追加したら docs/ に置いてここで参照
![Library view](docs/screenshot-library.png)
![Compare view](docs/screenshot-compare.png)
-->

## ✨ 主な機能

### ボーカル分離
- **BS-Roformer**（UVR 系の SOTA モデル）による高品質なボーカル / インスト分離
- **Mel-Roformer Karaoke** によるリード / コーラス（ハモリ）分離
- 音声ファイルだけでなく**動画ファイルからの抽出**にも対応（無音音声の検出付き）
- 分離はインポート時に自動実行。すべてローカル処理で、音声が外部に送信されることはありません

### ライブラリ
- 曲単位の**プロジェクト制ライブラリ**でリファレンスと自分のボーカルをペア管理
- タグ付け・サムネイル・名称変更に対応
- ステムを **DAW へ直接ドラッグ & ドロップ**で書き出し

### A/B 比較再生
- 相互相関による**自動アライン**＋手動微調整で 2 つのボーカルを時間同期
- ワンキーで切り替わる**時間同期 A/B 再生**、ループ再生対応
- **ラウドネスマッチ**（ITU-R BS.1770 実測ゲイン）で音量差による錯覚を排除

### 解析・提案
- リファレンスと自分のボーカルの**平均スペクトラム比較**表示
- スペクトル比から**EQ 推奨カーブ**をグラフ表示（Matchering 方式）— 適用量は調整可能
- 推奨カーブを **FabFilter Pro-Q 3 / 4 プリセット（.ffp）として書き出し**（24 バンドフィット）
- ダイナミックレンジ解析から**等価コンプ設定を推定**（レシオ・スレッショルド・アタック・リリース）
- 解析結果はキャッシュされ、2 回目以降は即座に表示

### UI・その他
- 日本語 / English の UI 切り替え
- 7 種類のカラーテーマ（Nightfall・Blush・Crimson・Graphite・Tide・Aubergine・Ember）
- 初回起動時のインタラクティブチュートリアル
- Discord Rich Presence 対応（設定でオフにできます）
- 設定の全初期化（リセット）機能

## 💻 動作環境

| OS | 対応 |
|---|---|
| macOS | Apple Silicon (arm64) / Intel (x64) |
| Windows | x64（NSIS インストーラ） |

初回起動時に解析エンジン（Python 実行環境・分離ライブラリ・AI モデル、**約 1.8 GB**）をダウンロードします。以降は追加モデルの取得時を除き、完全にオフラインで動作します。

## 🚀 インストール

[Releases](https://github.com/rinewav/Vocal-Referencer/releases) から最新のインストーラをダウンロードしてください。

- macOS: `.dmg` を開いてアプリケーションフォルダへドラッグ
- Windows: `.exe`（NSIS）を実行

ソースからビルドする場合は[開発](#-開発)を参照してください。

## 📖 使い方

1. **リファレンス曲を追加** — 音声 / 動画ファイルをウィンドウにドロップするとプロジェクトが作成され、ボーカル分離が自動で始まります
2. **自分のボーカルを登録** — プロジェクトのタイルに自分のボーカル（ラフミックス）をドロップ
3. **比較** — 比較ビューで A/B 切り替え再生。自動アラインとラウドネスマッチにより、純粋に「処理の違い」だけを聴き比べられます
4. **解析** — スペクトラム比較・EQ 推奨カーブ・コンプ推定を確認
5. **書き出し** — EQ カーブを Pro-Q 3/4 プリセット（.ffp）で書き出し、またはステムを DAW へドラッグ & ドロップ

> **注意:** リファレンスとして扱う楽曲は、お住まいの地域の著作権法が認める範囲（私的複製など）でご利用ください。

## 🔒 プライバシー

- 音声の分離・解析はすべて**お使いのマシン上で実行**されます。音声データが外部サーバーへ送信されることはありません
- ネットワーク接続を使うのは「初回セットアップ / 追加モデルのダウンロード」と「Discord Rich Presence（ローカル IPC・任意）」のみです

## 🛠 開発

必要環境: Node.js 20 以降 / pnpm

```bash
git clone https://github.com/rinewav/Vocal-Referencer.git
cd Vocal-Referencer
pnpm install

pnpm dev          # 開発起動（ホットリロード）
pnpm typecheck    # 型チェック
pnpm dist:mac     # macOS 向けビルド (dmg)
pnpm dist:win     # Windows 向けビルド (nsis)
```

### アーキテクチャ

```
src/
├── main/                 # Electron メインプロセス
│   ├── engine/           #   Python サイドカー管理（DL・マニフェスト・起動）
│   ├── library.ts        #   プロジェクト / ステム管理
│   ├── db.ts             #   better-sqlite3 永続化
│   ├── proq.ts           #   Pro-Q .ffp プリセット生成
│   └── discord.ts        #   Discord Rich Presence (IPC 直叩き)
├── preload/              # コンテキストブリッジ
└── renderer/             # React UI
    ├── components/       #   Library / Compare / Analysis / Tutorial ほか
    └── lib/              #   Web Audio 再生・DSP (fft.js)・D&D 書き出し
```

- **スタック:** Electron + electron-vite + React + TypeScript + better-sqlite3
- **分離エンジン:** [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) を Python サイドカーとして初回ダウンロード方式で同梱。モデルは UVR モデル zoo の BS-Roformer / Mel-Roformer を使用
- **解析:** レンダラ側の fft.js による DSP（平均スペクトラム・ラウドネス・ダイナミクス解析）


## 📄 ライセンス

[GPL-3.0-or-later](LICENSE)

本アプリが利用・参照している主要な OSS / モデル:

- [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) (MIT) — ボーカル分離エンジン
- UVR 系分離モデル（BS-Roformer / Mel-Roformer Karaoke）— 各モデルのライセンスに従います（初回セットアップ時に同意を確認）
- [Matchering](https://github.com/sergree/matchering) (GPLv3) — EQ マッチングアルゴリズムの参考実装
