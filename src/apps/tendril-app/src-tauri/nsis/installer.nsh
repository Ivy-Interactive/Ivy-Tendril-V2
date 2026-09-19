; Tendril Desktop installer/uninstaller hooks (NSIS).
;
; Wired up as `bundle.windows.nsis.installerHooks` in `tauri.conf.json`. Tauri `!include`s this file
; at global scope, then inserts the four `NSIS_HOOK_*` macros below into its own install and
; uninstall sections. An earlier version of this file defined electron-builder's `customUnInstall`
; plus a standalone `un.CleanUp` section, and was referenced from nowhere - so none of it ever ran.
;
; Why hooks are needed at all: Tauri only manages `$INSTDIR`. Tendril also puts a background daemon
; outside it. On first run the app copies its bundled `tendril` and `opencode` sidecars into
; `$PROFILE\.tendril\bin` and registers a logon task pointing at that copy (see
; `service/provision.rs`). The generated installer knows about neither, so without these hooks an
; uninstall leaves a scheduled task trying to launch a deleted binary at every login, and an upgrade
; can fail outright because a running daemon holds `$INSTDIR\tendril.exe` open.
;
; Two variables used below are Tauri's own, declared in its `installer.nsi` template and in scope by
; the time these macros expand:
;   $UpdateMode                  1 when the uninstaller was invoked as part of an upgrade (`/UPDATE`).
;   $DeleteAppDataCheckboxState  1 when the user ticked "delete application data" on the uninstall
;                                confirm page. Tauri renders that checkbox itself, unticked by default.
; If a future Tauri renames either, this fails to compile rather than silently misbehaving.
;
; `$PROFILE` is the right root for the out-of-INSTDIR files because the bundle installs per-user
; (`installMode` is left at its `currentUser` default), so the installer is never elevated into some
; other account's profile.

; Stop the daemon and the agent it supervises. Used before an install (those files are about to be
; overwritten) and before an uninstall (they are about to be deleted).
;
; `tendril.exe` can be running from two places at once - the managed child the app spawns out of
; `$INSTDIR`, and the daemon the logon task starts out of `$PROFILE\.tendril\bin` - and only the
; first is what Windows reports as locking `$INSTDIR`. Killing by image name covers both. Tauri's own
; `CheckIfAppIsRunning` does not: it only looks for the app itself, which can be closed while its
; daemon child keeps running.
;
; Every call here is allowed to fail - a first-time install has no task and no live process - so they
; use `nsExec` and discard the exit code on purpose. `/End` precedes `taskkill` so the scheduler does
; not read the kill as a crash and restart what was just stopped. Nothing is lost by stopping the
; daemon this way: its supervisor kills it the same way on a normal quit, and SQLite is in WAL mode.
!macro TendrilStopBackgroundService
  nsExec::ExecToLog 'schtasks.exe /End /TN "com.spacecorps.tendril.service"'
  Pop $0
  nsExec::ExecToLog 'taskkill.exe /F /IM tendril.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill.exe /F /IM opencode.exe'
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running Tendril background service..."
  !insertmacro TendrilStopBackgroundService
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Deliberately empty. The background service is installed by the app on first run, not from here:
  ; it belongs in the invoking user's profile and has to be registered as that user. Driving it from
  ; the installer would also duplicate work the app already does idempotently on every launch.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; This section also runs during an upgrade - Tauri invokes the old uninstaller with `/UPDATE`
  ; before laying down the new build. So stop the service either way, but only unregister the task on
  ; a real uninstall: tearing it down mid-upgrade would leave the user without autostart until some
  ; later app launch reprovisioned it.
  DetailPrint "Stopping the Tendril background service..."
  !insertmacro TendrilStopBackgroundService

  ${If} $UpdateMode <> 1
    DetailPrint "Unregistering the Tendril background service..."
    nsExec::ExecToLog 'schtasks.exe /Delete /TN "com.spacecorps.tendril.service" /F'
    Pop $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Call un.TendrilRemoveProvisionedFiles
  ${EndIf}
!macroend

; Split out of the macro so its branch labels are function-local and cannot collide.
Function un.TendrilRemoveProvisionedFiles
  ; The sidecars the app provisioned into the user's profile. They sit outside `$INSTDIR`, so Tauri
  ; does not touch them; left behind they orphan two large binaries plus a stamp file that would make
  ; a later reinstall believe it had already provisioned.
  ;
  ; Named files rather than `RMDir /r`, followed by a plain `RMDir` that only succeeds on an empty
  ; directory: `bin` is the directory Tendril puts on the PATH it hands to coding agents, so a user
  ; may have their own tools in there, and those are not ours to delete.
  DetailPrint "Removing Tendril background service binaries..."
  Delete "$PROFILE\.tendril\bin\tendril.exe"
  Delete "$PROFILE\.tendril\bin\opencode.exe"
  Delete "$PROFILE\.tendril\bin\.provisioned"
  ; Staging leftovers from a provisioning run that was interrupted part-way.
  Delete "$PROFILE\.tendril\bin\.tendril.exe.new"
  Delete "$PROFILE\.tendril\bin\.tendril.exe.old"
  Delete "$PROFILE\.tendril\bin\.opencode.exe.new"
  Delete "$PROFILE\.tendril\bin\.opencode.exe.old"
  RMDir "$PROFILE\.tendril\bin"

  ; `$PROFILE\.tendril` itself holds the database, every plan, every cloned repository and
  ; config.yaml. It is preserved unless the user explicitly ticked Tauri's "delete application data"
  ; box, and even then it is confirmed once: that checkbox reads like it means caches, and this is
  ; unrecoverable work. `/SD IDNO` is what makes a silent uninstall keep the data - with nobody there
  ; to answer, no response must not count as consent to delete.
  ${If} $DeleteAppDataCheckboxState <> 1
    Goto keep_data
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
    "Also delete your Tendril workspace at $PROFILE\.tendril?$\r$\n$\r$\nThis permanently removes your database, plans, cloned repositories and configuration. It cannot be undone.$\r$\n$\r$\nChoose No to keep them for a future install." \
    /SD IDNO IDYES purge_data IDNO keep_data

purge_data:
  DetailPrint "Purging the Tendril workspace at $PROFILE\.tendril..."
  RMDir /r "$PROFILE\.tendril"
  Goto data_done

keep_data:
  DetailPrint "Preserving user plans, repos, and configuration in $PROFILE\.tendril"

data_done:
FunctionEnd
