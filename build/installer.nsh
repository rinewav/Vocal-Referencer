; electron-builder が buildResources から自動 include するカスタム NSIS スクリプト。
; ここで customCheckAppRunning を定義すると、インストーラ/アンインストーラ双方の
; 既定のアプリ実行中チェック(_CHECK_APP_RUNNING)を置き換える。
;
; 既定チェックは tasklist/find によるプロセス検出→失敗時に
;   "${PRODUCT_NAME} cannot be closed. Please close it manually and click Retry"
; を表示してインストールを止める。Windows on ARM の x64 エミュレーション下や
; 名前にスペースを含む exe で誤検知しやすく、何も起動していなくても止まる。
;
; 対策: 検出ループとブロッキングダイアログをやめ、対象 exe を静かに強制終了して
; 常にインストールを続行する。未起動なら taskkill はエラーを返すだけ(無視)。
; インストーラ本体は exe 名が異なる("... Setup ...")ため巻き込まれない。
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\taskkill.exe" /f /im "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 500
!macroend
