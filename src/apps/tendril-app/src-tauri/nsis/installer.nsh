; Tendril Desktop Installer & Uninstaller Custom Logic (NSIS)
; Enforces non-destructive data retention during upgrades and uninstallation.

!include "MUI2.nsh"
!include "nsDialogs.nsh"

Var Dialog
Var CheckboxDeleteData
Var DeleteDataState

!macro customUnInstall
  ; Show custom confirmation page only during uninstall
  Page custom un.CustomUnPage un.CustomUnPageLeave
!macroend

Function un.CustomUnPage
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Uninstalling Tendril Desktop Application.$\r$\nBy default, all user data, plans, repositories, and configurations in %USERPROFILE%\.tendril are preserved."
  Pop $0

  ${NSD_CreateCheckbox} 0 40u 100% 12u "Delete Tendril workspace and configuration data (irreversible)"
  Pop $CheckboxDeleteData
  ${NSD_SetState} $CheckboxDeleteData 0 ; Default: Unchecked (Preserve user data)

  nsDialogs::Show
FunctionEnd

Function un.CustomUnPageLeave
  ${NSD_GetState} $CheckboxDeleteData $DeleteDataState
FunctionEnd

Section "un.CleanUp"
  ; Stop any running background service or scheduled tasks
  ExecWait 'schtasks.exe /Delete /TN "com.spacecorps.tendril.service" /F'

  ; Remove application binaries
  RMDir /r "$INSTDIR"

  ; Clean data ONLY if explicitly opt-in checked by the user
  ${If} $DeleteDataState == 1
    DetailPrint "Purging Tendril workspace data as requested by user..."
    RMDir /r "$PROFILE\.tendril"
  ${Else}
    DetailPrint "Preserving user plans, repos, and configuration in $PROFILE\.tendril"
  ${EndIf}
SectionEnd
