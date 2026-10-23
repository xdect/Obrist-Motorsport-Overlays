#!/usr/bin/env bash
# Baut die Windows-Setup-Datei von OM Overlays.
# Läuft unter Linux oder macOS; braucht Go (1.22+), Node.js (nur für die Tests), curl, unzip, zip, git.
# Ergebnis: dist/OM-Overlays-Setup-<version>.exe und dist/OM-Overlays-<version>-portable.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="$(node -p "require('./package.json').version")"
ELECTRON_VER="33.2.1"
CACHE="$ROOT/.cache"
GOSRC="$CACHE/gosrc"
STAGE="$ROOT/dist/stage/OM Overlays"
EZIP="$CACHE/electron-v$ELECTRON_VER-win32-x64.zip"

step() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }

step "Tests"
node --test test/engine.test.js test/iracing.test.js test/updater.test.js
(cd native/telemetry && go test ./...)

step "Telemetrie-Modul für Windows bauen"
mkdir -p bin
(cd native/telemetry && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$ROOT/bin/om-telemetry.exe" .)

step "Abhängigkeiten holen (falls nötig)"
mkdir -p "$GOSRC"
clone() { [ -d "$GOSRC/$2" ] || git clone -q --depth 1 ${3:+--branch "$3"} "https://github.com/$1.git" "$GOSRC/$2"; }
clone tc-hib/winres winres
clone nfnt/resize resize
clone golang/image image v0.15.0
[ -f "$GOSRC/resize/go.mod" ] || printf 'module github.com/nfnt/resize\n' > "$GOSRC/resize/go.mod"
if [ ! -f "$EZIP" ]; then
  curl -fsSL -o "$EZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VER/electron-v$ELECTRON_VER-win32-x64.zip"
fi
curl -fsSL -o "$CACHE/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$ELECTRON_VER/SHASUMS256.txt" || true
WANT="$(grep " \*electron-v$ELECTRON_VER-win32-x64.zip" "$CACHE/SHASUMS256.txt" | cut -d' ' -f1)"
HAVE="$( (sha256sum "$EZIP" 2>/dev/null || shasum -a 256 "$EZIP") | cut -d' ' -f1)"
[ "$WANT" = "$HAVE" ] || { echo "Prüfsumme der Electron-Laufzeit stimmt nicht!"; exit 1; }
echo "Electron $ELECTRON_VER: Prüfsumme ok"

step "Ressourcen-Werkzeug bauen"
(cd tools/omres && GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o "$CACHE/omres" .)

step "Programmordner zusammenstellen"
rm -rf "$ROOT/dist/stage"
mkdir -p "$STAGE"
unzip -q "$EZIP" -d "$STAGE"
rm -f "$STAGE/resources/default_app.asar"
"$CACHE/omres" patch -in "$STAGE/electron.exe" -out "$STAGE/OM Overlays.exe" -icon build/icon.png \
  -name "OM Overlays" -desc "OM Overlays – Obrist Motorsport" -file "OM Overlays.exe" -version "$VER"
rm "$STAGE/electron.exe"
APP="$STAGE/resources/app"
mkdir -p "$APP/build" "$APP/bin"
cp package.json "$APP/"
cp -R src web "$APP/"
cp build/icon.png "$APP/build/"
cp bin/om-telemetry.exe "$APP/bin/"
du -sh "$STAGE"

step "Setup bauen"
rm -f tools/installer/payload.zip
(cd "$ROOT/dist/stage/OM Overlays" && zip -qr -9 "$ROOT/tools/installer/payload.zip" .)
printf '%s\n' "$VER" > tools/installer/version.txt
"$CACHE/omres" syso -out tools/installer/rsrc_windows_amd64.syso -icon build/icon.png \
  -name "OM Overlays Setup" -desc "OM Overlays Setup" -file "OM-Overlays-Setup-$VER.exe" -version "$VER"
mkdir -p dist
(cd tools/installer && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o "$ROOT/dist/OM-Overlays-Setup-$VER.exe" .)

step "Update-Information (latest.json) und Release-Notizen"
REPO="$(node -p "(require('./package.json').updates||{}).github||''")"
SETUP="OM-Overlays-Setup-$VER.exe"
# Abschnitt «## <version>» aus CHANGELOG.md
awk -v v="$VER" '/^## /{p=($2==v)} p && !/^## /' CHANGELOG.md | sed '/^[[:space:]]*$/d' > dist/notes.md
[ -s dist/notes.md ] || echo "- Verbesserungen und Fehlerbehebungen" > dist/notes.md
SHA="$( (sha256sum "dist/$SETUP" 2>/dev/null || shasum -a 256 "dist/$SETUP") | cut -d' ' -f1)"
SIZE="$(wc -c < "dist/$SETUP" | tr -d ' ')"
VER="$VER" REPO="$REPO" SETUP="$SETUP" SHA="$SHA" SIZE="$SIZE" node -e '
  const fs = require("fs");
  const e = process.env;
  const m = {
    version: e.VER,
    url: `https://github.com/${e.REPO}/releases/download/v${e.VER}/${e.SETUP}`,
    sha256: e.SHA,
    size: Number(e.SIZE),
    notes: fs.readFileSync("dist/notes.md", "utf8").trim(),
    date: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync("dist/latest.json", JSON.stringify(m, null, 2) + "\n");
  console.log(JSON.stringify(m, null, 2));
'

step "Portable ZIP"
rm -f "dist/OM-Overlays-$VER-portable.zip"
(cd "$ROOT/dist/stage" && zip -qr -9 "$ROOT/dist/OM-Overlays-$VER-portable.zip" "OM Overlays")

ls -lh dist/*.exe dist/*.zip
echo "Fertig."
