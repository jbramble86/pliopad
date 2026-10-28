; PlioPad for Windows: per-user installer (no admin prompt), built with Inno Setup 7.
; Build: ISCC.exe /DSourceDir=<Release win-x64 output> /DAppVersion=1.1.0 /O<output folder> PlioPad.iss
; build.ps1 next to this file does all of that.

#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif
#ifndef SourceDir
  #error Pass /DSourceDir=<folder with Pliopad.exe>
#endif

[Setup]
; Keep AppId the same forever: it is how Windows recognizes upgrades and the uninstall entry.
AppId={{6F3B2C1E-8D47-4E5A-9B21-5C0A7E4D9F13}
AppName=PlioPad
AppVersion={#AppVersion}
AppVerName=PlioPad {#AppVersion}
AppPublisher=PlioPad
AppPublisherURL=https://pliopad.com
AppSupportURL=https://pliopad.com
VersionInfoVersion={#AppVersion}
VersionInfoProductName=PlioPad
DefaultDirName={localappdata}\Programs\PlioPad
DefaultGroupName=PlioPad
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputBaseFilename=PlioPad-Setup-{#AppVersion}
SetupIconFile=..\Pliopad.Windows\Assets\Pliopad.ico
UninstallDisplayIcon={app}\Pliopad.exe
UninstallDisplayName=PlioPad
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\PlioPad"; Filename: "{app}\Pliopad.exe"; Comment: "Notes, docs and databases"
Name: "{autodesktop}\PlioPad"; Filename: "{app}\Pliopad.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Pliopad.exe"; Description: "Launch PlioPad"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The app's files only. Notes saved on this PC (%LOCALAPPDATA%\Pliopad) are kept, so reinstalling keeps them.
Type: filesandordirs; Name: "{app}"
