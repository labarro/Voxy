!macro customInstall
  # Updates may pass --keep-shortcuts and retain a missing or stale Start link.
  # Always restore the searchable Voxy entry with an explicit branded icon.
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    !insertmacro createMenuDirectory
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ClearErrors
  !endif
!macroend
