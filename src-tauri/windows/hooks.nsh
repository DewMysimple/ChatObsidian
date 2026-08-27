!include LogicLib.nsh

; Tauri inserts this macro before copying the new application files.
; Only ChatObsidian is targeted. Obsidian.exe is intentionally never touched.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "正在关闭 ChatObsidian 以覆盖旧版本..."

  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /IM chat-obsidian.exe'
  Pop $R0
  Pop $R1
  ; taskkill returns 128 when there was no matching process; that is safe.
  ${If} $R0 != 0
    ${If} $R0 != 128
      MessageBox MB_ICONSTOP|MB_OK "无法结束 ChatObsidian（taskkill 退出码：$R0）。安装已中止，请关闭程序后重试。"
      Abort
    ${EndIf}
  ${EndIf}

  StrCpy $R2 0
  chatobsidian_wait_for_exit:
    Sleep 250
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (@(Get-Process -Name chat-obsidian -ErrorAction SilentlyContinue).Count -gt 0) { exit 1 } else { exit 0 }"'
    Pop $R0
    Pop $R1
    ${If} $R0 == 0
      Goto chatobsidian_exit_confirmed
    ${EndIf}
    IntOp $R2 $R2 + 1
    ${If} $R2 < 20
      Goto chatobsidian_wait_for_exit
    ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "ChatObsidian 仍被占用，安装已中止。请结束相关进程后重试。"
  Abort

  chatobsidian_exit_confirmed:
  DetailPrint "ChatObsidian 已退出，继续覆盖安装。"
!macroend
