; Parallel per-user experimental installer. No stable app/protocol/update writes.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!ifndef VOXY_VERSION
!error "VOXY_VERSION is required"
!endif
!ifndef VOXY_PAYLOAD
!error "VOXY_PAYLOAD is required"
!endif
!ifndef VOXY_OUTPUT
!error "VOXY_OUTPUT is required"
!endif
!define APP_ID "dev.voxy.native.experimental"
; Test builds (only with /DVOXY_TEST_INSTALL_ROOT) install into a disposable
; folder with a separate uninstall key; release builds always use the per-user path.
!ifdef VOXY_TEST_INSTALL_ROOT
!define INSTALL_ROOT "${VOXY_TEST_INSTALL_ROOT}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoxyNativeInstallerTest"
; Test builds never touch the real Start menu folder.
!define SM_FOLDER "Voxy Installer Test"
!else
!define INSTALL_ROOT "$LOCALAPPDATA\Programs\VoxyNativeExperimental"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoxyNativeExperimental"
!define SM_FOLDER "Voxy 2.0 Beta"
!endif
Name "Voxy 2.0 Beta ${VOXY_VERSION}"
!ifndef VOXY_NUMERIC_VERSION
!error "VOXY_NUMERIC_VERSION is required (x.y.z.w)"
!endif
Icon "${VOXY_ICON}"
UninstallIcon "${VOXY_ICON}"
!define MUI_ICON "${VOXY_ICON}"
!define MUI_UNICON "${VOXY_ICON}"
VIProductVersion "${VOXY_NUMERIC_VERSION}"
VIFileVersion "${VOXY_NUMERIC_VERSION}"
VIAddVersionKey "ProductName" "Voxy"
VIAddVersionKey "FileDescription" "Instalador do Voxy 2.0 Beta"
VIAddVersionKey "ProductVersion" "${VOXY_VERSION}"
VIAddVersionKey "FileVersion" "${VOXY_VERSION}"
VIAddVersionKey "CompanyName" "Voxy"
VIAddVersionKey "LegalCopyright" "Voxy · MIT"
OutFile "${VOXY_OUTPUT}"
InstallDir "${INSTALL_ROOT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ManifestDPIAware true
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
Var Expected
Var Handle
Var Entry
Var Owner
Var OwnerPath

; Only direct known paths are touched. Reject reparse points before reading an
; ownership marker or writing/removing any payload through a redirected path.
!macro AssertPlainPath PATH
  System::Call 'kernel32::GetFileAttributesW(w "${PATH}") i .r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "Caminho redirecionado recusado. Nada foi alterado." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro ValidateDestination PREFIX
Function ${PREFIX}ValidateDestination
  SetShellVarContext current
  ; Root cause of the 2.0.0-beta.1 failure: GetFullPathName returns an EMPTY
  ; string for a path that does not exist yet. On a clean install both sides
  ; became "", the check passed and "$INSTDIR\*.*" scanned the drive root,
  ; which was then reported as a foreign folder. Compare the literal paths
  ; (case-insensitive StrCmp, trailing backslash removed) and refuse empty ones.
  StrCpy $Expected "${INSTALL_ROOT}"
  StrCpy $0 $INSTDIR 1 -1
  StrCmp $0 "\" 0 +2
    StrCpy $INSTDIR $INSTDIR -1
  StrCmp $INSTDIR "" destination_refused_${PREFIX}
  StrCmp $INSTDIR $Expected destination_ok_${PREFIX}
  destination_refused_${PREFIX}:
    MessageBox MB_ICONSTOP "Destino recusado. Este instalador usa somente a pasta paralela do Voxy 2.0 Beta." /SD IDOK
    Abort
  destination_ok_${PREFIX}:
  ; Reject junctions/symlinks in the mutable installation path and its parent.
  !insertmacro AssertPlainPath "$LOCALAPPDATA"
  !insertmacro AssertPlainPath "$LOCALAPPDATA\Programs"
  !insertmacro AssertPlainPath "$INSTDIR"
  !insertmacro AssertPlainPath "$INSTDIR\.voxy-native-install.ini"
  !insertmacro AssertPlainPath "$INSTDIR\world-assets"
  !include "${VOXY_PAYLOAD}\validate-files.nsh"
  IfFileExists "$INSTDIR\*.*" 0 validate_empty_${PREFIX}
  FindFirst $Handle $Entry "$INSTDIR\*.*"
  validate_find_${PREFIX}:
    StrCmp $Entry "" validate_close_empty_${PREFIX}
    StrCmp $Entry "." validate_next_${PREFIX}
    StrCmp $Entry ".." validate_next_${PREFIX}
    FindClose $Handle
    ReadINIStr $Owner "$INSTDIR\.voxy-native-install.ini" "Voxy" "Owner"
    ReadINIStr $OwnerPath "$INSTDIR\.voxy-native-install.ini" "Voxy" "Path"
    StrCmp $Owner "${APP_ID}" 0 validate_foreign_${PREFIX}
    StrCmp $OwnerPath $Expected validate_empty_${PREFIX} validate_foreign_${PREFIX}
  validate_next_${PREFIX}:
    FindNext $Handle $Entry
    Goto validate_find_${PREFIX}
  validate_close_empty_${PREFIX}:
    FindClose $Handle
    Goto validate_empty_${PREFIX}
  validate_foreign_${PREFIX}:
    MessageBox MB_ICONSTOP "A pasta de instalação contém arquivos que não são do Voxy 2.0 Beta. Nada foi alterado." /SD IDOK
    Abort
  validate_empty_${PREFIX}:
FunctionEnd
!macroend
!insertmacro ValidateDestination ""
!insertmacro ValidateDestination "un."

!macro CheckExecutableUnlocked PREFIX
Function ${PREFIX}CheckExecutableUnlocked
  Exch $0
  IfFileExists "$INSTDIR\$0" 0 unlocked_${PREFIX}
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\$0", i 0xC0000000, i 0, p 0, i 3, i 0, p 0) p .r1'
  IntPtrCmp $1 -1 locked_${PREFIX}
  System::Call 'kernel32::CloseHandle(p r1)'
  Goto unlocked_${PREFIX}
  locked_${PREFIX}:
    MessageBox MB_ICONSTOP "Um arquivo do Voxy 2.0 Beta continua em uso. Use Encerrar Voxy e chamada na bandeja e tente novamente. Nada foi alterado." /SD IDOK
    Abort
  unlocked_${PREFIX}:
  Pop $0
FunctionEnd
!macroend
!insertmacro CheckExecutableUnlocked ""
!insertmacro CheckExecutableUnlocked "un."

; Coordinated shutdown of THIS installation only. The helper lists voxy-*.exe
; processes whose image is directly inside $INSTDIR (never the stable 1.4.1,
; other folders or other users), asks the user, then closes the interface,
; sends the core an authenticated shutdown and only then ends leftovers.
!macro StopInstallation PREFIX
Function ${PREFIX}StopInstallation
  IfFileExists "$PLUGINSDIR\voxy-stop\voxy-core.exe" 0 stop_done_${PREFIX}
  nsExec::ExecToStack '"$PLUGINSDIR\voxy-stop\voxy-core.exe" installation-processes "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" stop_done_${PREFIX}
  StrCmp $0 "10" 0 stop_done_${PREFIX}
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "O Voxy 2.0 Beta desta instalação está aberto (interface, bandeja ou chamada).$\r$\n$\r$\nEle será encerrado de forma coordenada para continuar. Uma chamada em andamento será finalizada. O Voxy 1.4.1 e outras pastas não são afetados." /SD IDOK IDOK stop_now_${PREFIX}
    Abort
  stop_now_${PREFIX}:
  DetailPrint "Encerrando o Voxy 2.0 Beta desta instalação…"
  nsExec::ExecToStack '"$PLUGINSDIR\voxy-stop\voxy-core.exe" installation-processes "$INSTDIR" --stop'
  Pop $0
  Pop $1
  StrCmp $0 "0" stop_done_${PREFIX}
    MessageBox MB_ICONSTOP "Não foi possível encerrar o Voxy 2.0 Beta desta instalação. Use Encerrar Voxy e chamada na bandeja e tente novamente. Nada foi alterado." /SD IDOK
    Abort
  stop_done_${PREFIX}:
FunctionEnd
!macroend
!insertmacro StopInstallation ""
!insertmacro StopInstallation "un."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "O Voxy 2.0 Beta exige Windows 10 ou 11 de 64 bits." /SD IDOK
    Abort
  ${EndIf}
  Call ValidateDestination
FunctionEnd
Function un.onInit
  Call un.ValidateDestination
  ReadINIStr $Owner "$INSTDIR\.voxy-native-install.ini" "Voxy" "Owner"
  StrCmp $Owner "${APP_ID}" +3
    MessageBox MB_ICONSTOP "Marcador de propriedade ausente. Desinstalação interrompida." /SD IDOK
    Abort
FunctionEnd

Section "Voxy 2.0 Beta" Main
  Call ValidateDestination
  ; The new helper (not the possibly older installed core) decides what belongs here.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\voxy-stop"
  File "/oname=$PLUGINSDIR\voxy-stop\voxy-core.exe" "${VOXY_PAYLOAD}\portable\voxy-core.exe"
  File "/oname=$PLUGINSDIR\voxy-stop\vcruntime140.dll" "${VOXY_PAYLOAD}\portable\vcruntime140.dll"
  Call StopInstallation
  Push "voxy-desktop.exe"
  Call CheckExecutableUnlocked
  Push "voxy-core.exe"
  Call CheckExecutableUnlocked
  Push "voxy-world.exe"
  Call CheckExecutableUnlocked
  SetOutPath "$INSTDIR"
  ; Ownership marker first: an interrupted install stays recognizable as ours.
  WriteINIStr "$INSTDIR\.voxy-native-install.ini" "Voxy" "Owner" "${APP_ID}"
  WriteINIStr "$INSTDIR\.voxy-native-install.ini" "Voxy" "Path" "$INSTDIR"
  ; Exact generated file list. No wildcard source or unrelated directory deletion.
  !include "${VOXY_PAYLOAD}\install-files.nsh"
  WriteINIStr "$INSTDIR\.voxy-native-install.ini" "Voxy" "Version" "${VOXY_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ; Earlier experimental builds used another Start menu folder: remove only our own links.
  Delete "$SMPROGRAMS\Voxy Native Experimental\Voxy Native Experimental.lnk"
  Delete "$SMPROGRAMS\Voxy Native Experimental\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\Voxy Native Experimental"
  CreateDirectory "$SMPROGRAMS\${SM_FOLDER}"
  CreateShortcut "$SMPROGRAMS\${SM_FOLDER}\Voxy 2.0 Beta.lnk" "$INSTDIR\voxy-desktop.exe" "" "$INSTDIR\voxy-desktop.exe" 0
  CreateShortcut "$SMPROGRAMS\${SM_FOLDER}\Desinstalar.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Voxy 2.0 Beta"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\voxy-desktop.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VOXY_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Voxy"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "VoxyNativeOwner" "${APP_ID}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ; No protocol/startup registration: these remain explicit UI preferences.
SectionEnd

Section "Uninstall"
  Call un.ValidateDestination
  ; Run a copy so the installed core file itself is never held open.
  InitPluginsDir
  CreateDirectory "$PLUGINSDIR\voxy-stop"
  CopyFiles /SILENT "$INSTDIR\voxy-core.exe" "$PLUGINSDIR\voxy-stop"
  CopyFiles /SILENT "$INSTDIR\vcruntime140.dll" "$PLUGINSDIR\voxy-stop"
  Call un.StopInstallation
  Push "voxy-desktop.exe"
  Call un.CheckExecutableUnlocked
  Push "voxy-core.exe"
  Call un.CheckExecutableUnlocked
  Push "voxy-world.exe"
  Call un.CheckExecutableUnlocked
  ; Never remove APPDATA or legacy installations. Known payload files only.
  !include "${VOXY_PAYLOAD}\uninstall-files.nsh"
  Delete "$INSTDIR\.voxy-native-install.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR\world-assets"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${SM_FOLDER}\Voxy 2.0 Beta.lnk"
  Delete "$SMPROGRAMS\${SM_FOLDER}\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\${SM_FOLDER}"
  Delete "$SMPROGRAMS\Voxy Native Experimental\Voxy Native Experimental.lnk"
  Delete "$SMPROGRAMS\Voxy Native Experimental\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\Voxy Native Experimental"
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "VoxyNativeOwner"
  ReadRegStr $1 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 == "${APP_ID}"
  ${AndIf} $1 == "$Expected"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VoxyNativeExperimental"
  ${If} $0 == '$\"$INSTDIR\voxy-desktop.exe$\"'
  ${OrIf} $0 == '$\"$INSTDIR\voxy-desktop.exe$\" --start-minimized'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VoxyNativeExperimental"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Classes\voxy-native" "VoxyNativeOwner"
  ReadRegStr $1 HKCU "Software\Classes\voxy-native\shell\open\command" ""
  ${If} $0 == "${APP_ID}"
  ${AndIf} $1 == '$\"$INSTDIR\voxy-desktop.exe$\" --protocol $\"%1$\"'
    DeleteRegValue HKCU "Software\Classes\voxy-native" ""
    DeleteRegValue HKCU "Software\Classes\voxy-native" "URL Protocol"
    DeleteRegValue HKCU "Software\Classes\voxy-native" "VoxyNativeOwner"
    DeleteRegValue HKCU "Software\Classes\voxy-native\DefaultIcon" ""
    DeleteRegValue HKCU "Software\Classes\voxy-native\shell\open\command" ""
  ${EndIf}
SectionEnd
