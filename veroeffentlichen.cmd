@echo off
rem Laedt den aktuellen Stand samt Versions-Tag zu GitHub hoch.
rem GitHub baut danach automatisch das Release; installierte OM Overlays finden das Update.
chcp 65001 >nul
cd /d "%~dp0"
where git >nul 2>&1 || (echo Git ist nicht installiert. Installieren mit: winget install --id Git.Git -e & pause & exit /b 1)
git remote get-url origin >nul 2>&1 || git remote add origin https://github.com/xdect/Obrist-Motorsport-Overlays.git
echo Lade OM Overlays zu GitHub hoch ...
git push -u origin main --follow-tags
if errorlevel 1 (echo. & echo Hochladen fehlgeschlagen. Meldung oben pruefen. & pause & exit /b 1)
echo.
echo Fertig. GitHub baut jetzt das Release (ca. 5 Minuten):
echo https://github.com/xdect/Obrist-Motorsport-Overlays/actions
pause
