'use strict'

const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * macOS向けのad-hoc署名フック。
 *
 * `mac.identity: null`（証明書なし配布）だと electron-builder はバンドルを署名せず、
 * `Contents/_CodeSignature/CodeResources` が生成されない。この状態のdmgを
 * ダウンロード/転送するとquarantine属性が付き、Gatekeeperが「破損している」と判定して
 * 何も起動しない。ローカル（quarantine無）では起動するため気づきにくい。
 *
 * ここで `codesign --force --deep --sign -` によりバンドル全体をad-hoc署名し、
 * 正当なCodeResourcesシールを付ける。これで「破損」ではなく通常の
 * 「未確認デベロッパ」（右クリック→開く で回避可）になる。
 * 完全なダブルクリック起動には Apple Developer ID 署名＋公証が必要。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })

  // シールが有効か検証（失敗すればビルドを止める）。
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit'
  })

  console.log(`[afterPack] ad-hoc signed: ${appPath}`)
}
