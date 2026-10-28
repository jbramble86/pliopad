App downloads offered by the web app ("Get the apps") and the website.

On the live server these files live outside the app folder (they are too large for Git): set the
environment variable PLIOPAD_DOWNLOADS to that folder, e.g. /home/<user>/pliopad-data/downloads.
Without it, this folder is used.

Replace these files to publish a new version, and update versions.json:
  Pliopad-Windows.zip   Windows build (zip of the PlioPad-Windows folder)
  Pliopad-Android.apk   Android build
  Pliopad-Mac.dmg       macOS build (not built yet; shows "Coming soon" until present)
  versions.json         e.g. { "windows": "1.1.0", "android": "1.4.0" }
