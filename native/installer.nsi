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
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoxyNativeExperimental"
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
InstallDir "$LOCALAPPDATA\Programs\VoxyNativeExperimental"
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
      MessageBox MB_ICONSTOP "Caminho redirecionado recusado. Conteudo preservado."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro ValidateDestination PREFIX
Function ${PREFIX}ValidateDestination
  SetShellVarContext current
  GetFullPathName $Expected "$LOCALAPPDATA\Programs\VoxyNativeExperimental"
  GetFullPathName $INSTDIR "$INSTDIR"
  StrCmp $INSTDIR $Expected +3
    MessageBox MB_ICONSTOP "Destino recusado. Este instalador usa somente a pasta experimental paralela."
    Abort
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
    MessageBox MB_ICONSTOP "A pasta não pertence a esta instalação experimental. Conteúdo preservado."
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
    MessageBox MB_ICONSTOP "Feche o Voxy 2.0 Beta, a sessão e as prévias 3D antes de continuar. Nenhum processo será encerrado pelo instalador."
    Abort
  unlocked_${PREFIX}:
  Pop $0
FunctionEnd
!macroend
!insertmacro CheckExecutableUnlocked ""
!insertmacro CheckExecutableUnlocked "un."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Este pacote experimental exige Windows x64."
    Abort
  ${EndIf}
  Call ValidateDestination
FunctionEnd
Function un.onInit
  Call un.ValidateDestination
  ReadINIStr $Owner "$INSTDIR\.voxy-native-install.ini" "Voxy" "Owner"
  StrCmp $Owner "${APP_ID}" +3
    MessageBox MB_ICONSTOP "Marcador de propriedade ausente. Desinstalação interrompida."
    Abort
FunctionEnd

Section "Voxy 2.0 Beta" Main
  Call ValidateDestination
  Push "voxy-desktop.exe"
  Call CheckExecutableUnlocked
  Push "voxy-core.exe"
  Call CheckExecutableUnlocked
  Push "voxy-world.exe"
  Call CheckExecutableUnlocked
  SetOutPath "$INSTDIR"
  ; Exact generated file list. No wildcard source or unrelated directory deletion.
  !include "${VOXY_PAYLOAD}\install-files.nsh"
  WriteINIStr "$INSTDIR\.voxy-native-install.ini" "Voxy" "Owner" "${APP_ID}"
  WriteINIStr "$INSTDIR\.voxy-native-install.ini" "Voxy" "Path" "$INSTDIR"
  WriteINIStr "$INSTDIR\.voxy-native-install.ini" "Voxy" "Version" "${VOXY_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ; Earlier experimental builds used another Start menu folder: remove only our own links.
  Delete "$SMPROGRAMS\Voxy Native Experimental\Voxy Native Experimental.lnk"
  Delete "$SMPROGRAMS\Voxy Native Experimental\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\Voxy Native Experimental"
  CreateDirectory "$SMPROGRAMS\Voxy 2.0 Beta"
  CreateShortcut "$SMPROGRAMS\Voxy 2.0 Beta\Voxy 2.0 Beta.lnk" "$INSTDIR\voxy-desktop.exe" "" "$INSTDIR\voxy-desktop.exe" 0
  CreateShortcut "$SMPROGRAMS\Voxy 2.0 Beta\Desinstalar.lnk" "$INSTDIR\Uninstall.exe"
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
  Delete "$SMPROGRAMS\Voxy 2.0 Beta\Voxy 2.0 Beta.lnk"
  Delete "$SMPROGRAMS\Voxy 2.0 Beta\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\Voxy 2.0 Beta"
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
