; Extra steps for the NSIS installer (electron-builder `nsis.include`).
;
; 1.2 was also distributed through a hand-made Inno Setup wrapper that installs
; into the same folder (%LOCALAPPDATA%\Programs\Clipper). This installer takes
; over that folder, so drop the Inno leftovers — otherwise "Apps & features"
; lists Clipper twice and the old uninstaller would delete the new files.

!macro customInstall
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{6925E2A3-6A31-4F18-8CD2-3C1E5158B749}_is1"
  Delete "$INSTDIR\unins000.exe"
  Delete "$INSTDIR\unins000.dat"
  ; Inno's optional "start with Windows" shortcut launched without --hidden and
  ; raced the app's own autostart entry, which is what opened the window at logon.
  Delete "$SMSTARTUP\Clipper.lnk"
!macroend
