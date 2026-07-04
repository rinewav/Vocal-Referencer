# Vocal Referencer

歌ってみた等のボーカルミックス師向けデスクトップアプリ。既存曲からボーカルを分離し、自分のボーカルと並べて聴き比べ・見比べて、処理を検討できます。

## 主な機能（v1）

- **ボーカル分離** — BS-Roformer（UVR系最新モデル）による高品質分離。リード/コーラス分離にも対応。処理はすべてローカルで実行され、音声が外部に送信されることはありません
- **ライブラリ** — 原曲と分離ステムを曲単位で管理。タグ付け、チップをDAWへ直接ドラッグ&ドロップで書き出し
- **A/B比較再生** — 自動アライン（相互相関）＋手動微調整、時間同期のA/B切替、ラウドネスマッチ（ITU-R BS.1770）で音量差による錯覚を排除
- **解析表示** — リファレンスと自分のボーカルの平均スペクトラム比較
- **EQ推奨カーブ** — スペクトル比から補正カーブをグラフ表示（Matchering方式）
- **等価コンプ設定の推定** — ダイナミックレンジ解析から推奨レシオ・スレッショルド・アタック・リリースを数値表示

## セットアップ

初回起動時に解析エンジン（Python実行環境・分離ライブラリ・AIモデル、約1.5GB）をダウンロードします。以降は完全にオフラインで動作します（追加モデル取得時を除く）。

## 開発

```bash
npm install
npm run dev        # 開発起動
npm run typecheck  # 型チェック
npm run dist:mac   # macOS向けビルド (dmg)
npm run dist:win   # Windows向けビルド (nsis)
```

スタック: Electron + electron-vite + React + TypeScript + better-sqlite3。分離エンジンは [audio-separator](https://github.com/nomadkaraoke/python-audio-separator)（Pythonサイドカー、初回DL方式）。

## ライセンス

GPL-3.0-or-later。同梱・参照している主要OSS: audio-separator (MIT)、UVR系分離モデル、[Matchering](https://github.com/sergree/matchering) のアルゴリズム（GPLv3）を参考にしたEQマッチング実装。
