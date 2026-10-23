# OM Overlays – Obrist Motorsport

Eigene iRacing-Overlays im Obrist-Motorsport-Look (Carbon, Gold, #13). Dieselben Overlays laufen
als transparente Fenster über iRacing und als Browserquelle in OBS.

**Overlays:** Relative, Standings, Fuel-Rechner, Inputs, Delta, Trackmap

## Installation

1. `OM-Overlays-Setup-1.2.0.exe` doppelklicken. Es sind keine weiteren Programme nötig
   (kein Node.js, kein npm), und es braucht keine Admin-Rechte.
2. Windows SmartScreen meldet beim ersten Start «Der Computer wurde durch Windows geschützt», weil
   das Setup nicht digital signiert ist: **Weitere Informationen → Trotzdem ausführen**.
3. Installiert wird nach `%LOCALAPPDATA%\Programs\OM Overlays`, mit Verknüpfung im Startmenü und
   auf dem Desktop.

**Update:** neues Setup einfach darüber installieren. Einstellungen und Streckenkarten bleiben.
**Deinstallieren:** Windows-Einstellungen → Apps → Installierte Apps → OM Overlays.

Ohne Installation: `OM-Overlays-1.2.0-portable.zip` entpacken und `OM Overlays.exe` starten.

## Benutzung

**Hintergrundbetrieb:** Schliesst du das Hauptfenster, läuft OM Overlays weiter – erkennbar am
#13-Symbol im Infobereich der Taskleiste (ggf. unter dem Pfeil ^). Klick darauf öffnet das
Hauptfenster wieder; Rechtsklick zeigt Sperren, Ausblenden, Datenquelle, «Mit Windows starten» und
**Beenden**. Ein erneuter Start über das Startmenü öffnet ebenfalls das laufende Programm.
Mit «Mit Windows starten» läuft es nach dem Hochfahren unsichtbar im Hintergrund.

**Automatisch ein- und ausblenden:** Die Overlay-Fenster erscheinen nur, wenn iRacing läuft und du
in einer Session bist, und verschwinden, sobald du die Session verlässt. Im Demo-Modus sind sie
immer sichtbar (zum Positionieren).

1. **iRacing im randlosen Fenstermodus** starten (Optionen → Grafik → Fenstermodus/Borderless).
   Im exklusiven Vollbild liegen keine Fenster darüber – das gilt für alle Overlay-Tools.
2. Im Control Panel oben **iRacing** als Datenquelle wählen. Der Status springt auf
   «iRacing verbunden», sobald du in einer Session sitzt.
3. Pro Overlay **Im Spiel** einschalten, Grösse und Deckkraft einstellen.
4. **Overlays entsperren**, Fenster an ihren Platz ziehen, wieder **sperren**. Gesperrt gehen alle
   Klicks durch zu iRacing. Positionen werden gespeichert. Ohne Session dafür auf **Demo** wechseln.

**Tastenkürzel** (auch über Stream Deck → Hotkey):

| Kürzel | Wirkung |
|---|---|
| Strg+Umschalt+L | Overlays sperren / entsperren |
| Strg+Umschalt+H | Alle Overlay-Fenster aus-/einblenden |

**Demo-Modus:** Ohne laufendes iRacing auf **Demo** umschalten – simuliert ein GT3-Rennen am Red Bull
Ring mit dir auf P5. Ideal zum Positionieren und für die OBS-Einrichtung.

## Updates

OM Overlays sucht beim Start und danach alle 6 Stunden auf GitHub
(`xdect/Obrist-Motorsport-Overlays`, einstellbar in `package.json` unter `updates.github`) nach
einer neuen Version. Gibt es eine, erscheint ein Hinweis im Hauptfenster und im Infobereich.
**Jetzt installieren** lädt das Setup, prüft die Prüfsumme, installiert und startet neu.
Während einer iRacing-Session wird nie installiert – das Update wartet bis zum Ende der Session.
Abschalten: «Automatisch nach Updates suchen» im Hauptfenster.

### Neue Version veröffentlichen

Einmalig: auf GitHub das Repository `Obrist-Motorsport-Overlays` unter `xdect` anlegen –
**öffentlich** (sonst kann das Programm die Updates nicht ohne Anmeldung laden) und leer (ohne
README). Dieser Ordner ist bereits ein Git-Repository mit Commit und Tag `v1.2.0`. Hochladen:

```bash
git remote add origin https://github.com/xdect/Obrist-Motorsport-Overlays.git
git push -u origin main --follow-tags
```

Der Tag löst den ersten automatischen Build aus; danach steht 1.2.0 als Release bereit.

Für jede weitere Version:

1. Version in `package.json` erhöhen (z. B. `1.3.0`).
2. In `CHANGELOG.md` einen Abschnitt `## 1.3.0` mit den Neuerungen ergänzen – die erscheinen in
   der App unter «Was ist neu».
3. Committen, Tag setzen, pushen:
   ```bash
   git commit -am "Version 1.3.0" && git tag v1.3.0 && git push --follow-tags
   ```

GitHub baut dann automatisch (Workflow `.github/workflows/release.yml`, ca. 5 Minuten) und
veröffentlicht das Release mit Setup, portabler ZIP und `latest.json`. Alle installierten
OM Overlays finden das Update von selbst. Den Fortschritt siehst du im Repository unter «Actions».

## OBS

Browserquelle hinzufügen, Adresse aus dem Control Panel kopieren, z. B.

```
http://127.0.0.1:7913/overlays/relative.html
```

Breite/Höhe wie die Grundgrösse setzen (Relative 430×300, Standings 540×620, Fuel 330×230,
Inputs 430×150, Delta 470×96, Trackmap 330×330). Der Hintergrund ist transparent. Optional per URL:
`?scale=1.5` (Grösse) und `?opacity=0.8` (Deckkraft). Wartet die App auf iRacing, blenden sich die
Overlays in OBS automatisch aus. OM Overlays muss dafür laufen.

## Hinweise zu den Daten

- **Relative:** Abstand aus der iRacing-Schätzzeit (`CarIdxEstTime`), wie im iRacing-Relative.
  Vor dir = negativ. Rot = überrundet dich, Blau = wird von dir überrundet.
- **Fuel:** misst den Verbrauch pro sauberer Runde (Boxenrunden und angebrochene Runden zählen
  nicht). Nachtank-Menge = verbleibende Runden × Ø-Verbrauch + Reserve − Tankinhalt.
  Bei Zeitrennen wird die Zielrunde nach Ablauf der Uhr mitgerechnet.
- **Trackmap:** iRacing liefert keine Streckenkarte. Beim ersten Besuch einer Strecke zeichnet die
  App sie aus deiner Fahrt auf (eine saubere Runde ohne Box). Danach ist sie gespeichert.
  Ist die Karte gespiegelt oder verdreht: im Control Panel «Spiegeln» bzw. «Drehen».
- Einstellungen und Karten liegen unter `%APPDATA%\OM Overlays\`.

## Fehlersuche

Bleibt der Status trotz laufender Session auf «Wartet auf iRacing», im Installationsordner eine
Eingabeaufforderung öffnen und ausführen:

```
resources\app\bin\om-telemetry.exe -list
```

Das listet alle Telemetrie-Variablen, die iRacing gerade liefert. «iRacing läuft nicht» heisst:
das Modul findet den iRacing-Speicher nicht.

## Aufbau

```
src/main/main.js            Electron: Control Panel, Overlay-Fenster, Tastenkürzel
src/core/index.js           eigener Prozess: Datenquelle → Engine → lokaler Server (Port 7913)
src/core/sources/iracing.js startet om-telemetry.exe und bereitet die Daten auf
src/core/sources/demo.js    Simulation für den Demo-Modus
src/core/engine.js          Relative, Standings, Fuel, Delta – reine Logik, getestet
src/core/yaml-lite.js       Parser für die Session-Infos von iRacing
src/core/track-recorder.js  Streckenkarte aus Telemetrie aufzeichnen
native/telemetry/           om-telemetry.exe (Go): liest iRacings Shared Memory, ohne Fremdpakete
tools/installer/            Setup-Programm (Go), enthält das ganze Paket
tools/omres/                setzt Icon und Versionsinfo in den .exe-Dateien
web/overlays/               die sechs Overlays (HTML)
web/control/                Control Panel
web/shared/                 OM-Design (om.css), Datenverbindung (link.js, om.js)
```

## Selbst bauen

Unter Linux oder macOS mit Go 1.22+, Node.js, curl, git, zip/unzip:

```bash
bash tools/build.sh
```

Das Skript testet alles, holt die Electron-Laufzeit (v33.2.1) von GitHub, prüft deren Prüfsumme,
setzt Icon und Versionsinfo und erzeugt `dist/OM-Overlays-Setup-<version>.exe` sowie die
portable ZIP. Version in `package.json` hochzählen für ein Update.

Nur den Datenkern im Browser testen: `node src/core/index.js --demo`, dann http://127.0.0.1:7913.
