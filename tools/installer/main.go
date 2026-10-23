//go:build windows

// OM Overlays Setup: enthält das komplette Programm (payload.zip) und installiert es ohne
// Admin-Rechte nach %LOCALAPPDATA%\Programs\OM Overlays – mit Startmenü- und Desktop-Verknüpfung
// und Eintrag unter «Apps & Features». Mit /uninstall wird wieder entfernt.
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

//go:embed version.txt
var versionRaw string

const (
	appName     = "OM Overlays"
	exeName     = "OM Overlays.exe"
	uninstName  = "OM Overlays deinstallieren.exe"
	publisher   = "Obrist Motorsport"
	regKey      = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OMOverlays`
	captionMain = "OM Overlays Setup"
	captionBusy = "OM Overlays wird installiert"
)

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW = user32.NewProc("MessageBoxW")
	procFindWindowW = user32.NewProc("FindWindowW")
	procPostMessage = user32.NewProc("PostMessageW")
)

const (
	mbOK        = 0x0
	mbYesNo     = 0x4
	mbIconError = 0x10
	mbIconQuest = 0x20
	mbIconInfo  = 0x40
	mbTopmost   = 0x40000
	mbSetFg     = 0x10000
	idYes       = 6
	wmClose     = 0x0010
	createNoWin = 0x08000000
	detached    = 0x00000008
)

func version() string { return strings.TrimSpace(versionRaw) }

func msgBox(text, caption string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(caption)
	r, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags|mbTopmost|mbSetFg)
	return int(r)
}

func fail(format string, a ...any) {
	msgBox(fmt.Sprintf(format, a...), captionMain, mbOK|mbIconError)
	os.Exit(1)
}

// hidden führt ein Systemprogramm ohne Konsolenfenster aus.
func hidden(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWin}
	return cmd.Run()
}

func installDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "Programs", appName)
}

func startMenuLink() string {
	return filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs`, appName+".lnk")
}

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func powershell(script string) error {
	return hidden("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
}

func stopRunning() {
	hidden("taskkill.exe", "/F", "/T", "/IM", exeName)
	hidden("taskkill.exe", "/F", "/IM", "om-telemetry.exe")
	time.Sleep(800 * time.Millisecond)
}

func extract(dst string) error {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return err
	}
	root := filepath.Clean(dst) + string(os.PathSeparator)
	for _, f := range zr.File {
		target := filepath.Join(dst, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(filepath.Clean(target)+string(os.PathSeparator), root) && filepath.Clean(target) != filepath.Clean(dst) {
			return fmt.Errorf("ungültiger Pfad im Paket: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// replaceInstall packt die neue Version neben der alten aus und tauscht erst danach.
// Schlägt etwas fehl, bleibt die bisherige Version unverändert und lauffähig.
func replaceInstall(dir string) error {
	newDir, oldDir := dir+".neu", dir+".alt"
	os.RemoveAll(newDir)
	os.RemoveAll(oldDir) // Reste eines früheren Versuchs
	if err := extract(newDir); err != nil {
		os.RemoveAll(newDir)
		return fmt.Errorf("Entpacken fehlgeschlagen: %w", err)
	}
	if err := copySelf(filepath.Join(newDir, uninstName)); err != nil {
		os.RemoveAll(newDir)
		return err
	}
	if _, err := os.Stat(dir); err == nil {
		// Bis zu 15 s warten, bis Windows die Dateien der beendeten App freigibt
		var rerr error
		for i := 0; i < 30; i++ {
			if rerr = os.Rename(dir, oldDir); rerr == nil {
				break
			}
			if i == 6 || i == 18 {
				stopRunning()
			}
			time.Sleep(500 * time.Millisecond)
		}
		if rerr != nil {
			os.RemoveAll(newDir)
			return fmt.Errorf("die bisherige Version ist noch in Benutzung und bleibt unverändert installiert (%v)", rerr)
		}
	}
	if err := os.Rename(newDir, dir); err != nil {
		os.Rename(oldDir, dir) // alte Version zurück
		os.RemoveAll(newDir)
		return fmt.Errorf("neue Version konnte nicht an ihren Platz: %w", err)
	}
	os.RemoveAll(oldDir) // was jetzt nicht geht, räumt die nächste Installation auf
	return nil
}

func dirSizeKB(dir string) int64 {
	var total int64
	filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total / 1024
}

func copySelf(dst string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if strings.EqualFold(filepath.Clean(self), filepath.Clean(dst)) {
		return nil
	}
	data, err := os.ReadFile(self)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o755)
}

// install: update=true heisst «aus der App gestartet» – ohne Rückfrage, danach Neustart mit restartArgs.
func install(update bool, restartArgs []string) {
	dir := installDir()
	ver := version()
	busyCaption := captionBusy
	if update {
		busyCaption = "OM Overlays wird aktualisiert"
		time.Sleep(1500 * time.Millisecond) // App beendet sich gerade selbst
	} else {
		q := fmt.Sprintf("%s %s installieren?\n\nZiel: %s\nVerknüpfungen: Startmenü und Desktop\n\nLäuft OM Overlays gerade, wird es dafür beendet. Deine Einstellungen bleiben erhalten.", appName, ver, dir)
		if msgBox(q, captionMain, mbYesNo|mbIconQuest) != idYes {
			return
		}
	}
	stopRunning()

	// Entpacken im Hintergrund, solange ein Hinweisfenster offen ist.
	var boxClosed atomic.Bool
	done := make(chan error, 1)
	go func() {
		err := func() error {
			return replaceInstall(dir)
		}()
		cap16, _ := syscall.UTF16PtrFromString(busyCaption)
		for i := 0; i < 60 && !boxClosed.Load(); i++ {
			if h, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(cap16))); h != 0 {
				procPostMessage.Call(h, wmClose, 0, 0)
			}
			time.Sleep(50 * time.Millisecond)
		}
		done <- err
	}()
	runtime.LockOSThread()
	busyText := "OM Overlays wird installiert …\n\nDas dauert einige Sekunden. Dieses Fenster schliesst sich von selbst."
	if update {
		busyText = fmt.Sprintf("OM Overlays wird auf Version %s aktualisiert …\n\nDas dauert einige Sekunden. Danach startet OM Overlays neu.", ver)
	}
	msgBox(busyText, busyCaption, mbOK|mbIconInfo)
	boxClosed.Store(true)
	runtime.UnlockOSThread()
	if err := <-done; err != nil {
		fail("Installation fehlgeschlagen:\n\n%v\n\nBitte OM Overlays beenden (Symbol im Infobereich → Beenden) und das Setup erneut starten.", err)
	}

	exe := filepath.Join(dir, exeName)
	// Verknüpfungen (Desktop-Pfad über .NET, damit auch OneDrive-Desktops stimmen)
	script := fmt.Sprintf(`$ws = New-Object -ComObject WScript.Shell
function L($p) { $s = $ws.CreateShortcut($p); $s.TargetPath = %[1]s; $s.WorkingDirectory = %[2]s; $s.IconLocation = %[1]s + ',0'; $s.Description = 'Obrist Motorsport Overlays'; $s.Save() }
L(%[3]s)
$d = Join-Path ([Environment]::GetFolderPath('Desktop')) %[4]s
if (%[5]s -or (Test-Path -LiteralPath $d)) { L($d) }`, psQuote(exe), psQuote(dir), psQuote(startMenuLink()), psQuote(appName+".lnk"), map[bool]string{true: "$false", false: "$true"}[update])
	shortcutErr := powershell(script)

	uninst := filepath.Join(dir, uninstName)
	reg := func(name, typ, val string) {
		hidden("reg.exe", "add", regKey, "/v", name, "/t", typ, "/d", val, "/f")
	}
	reg("DisplayName", "REG_SZ", appName)
	reg("DisplayVersion", "REG_SZ", ver)
	reg("Publisher", "REG_SZ", publisher)
	reg("DisplayIcon", "REG_SZ", exe+",0")
	reg("InstallLocation", "REG_SZ", dir)
	reg("UninstallString", "REG_SZ", `"`+uninst+`" /uninstall`)
	reg("QuietUninstallString", "REG_SZ", `"`+uninst+`" /uninstall /quiet`)
	reg("NoModify", "REG_DWORD", "1")
	reg("NoRepair", "REG_DWORD", "1")
	reg("EstimatedSize", "REG_DWORD", fmt.Sprint(dirSizeKB(dir)))

	if update { // ohne Rückfrage neu starten, im selben Zustand wie vorher
		cmd := exec.Command(exe, restartArgs...)
		cmd.Dir = dir
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detached}
		if err := cmd.Start(); err != nil {
			fail("Update installiert, aber OM Overlays konnte nicht gestartet werden:\n\n%v", err)
		}
		return
	}

	msg := fmt.Sprintf("%s %s ist installiert.\n\nDu findest es im Startmenü und auf dem Desktop.", appName, ver)
	if shortcutErr != nil {
		msg = fmt.Sprintf("%s %s ist installiert, aber die Verknüpfungen konnten nicht angelegt werden.\n\nStarte das Programm direkt hier:\n%s", appName, ver, exe)
	}
	if msgBox(msg+"\n\nJetzt starten?", captionMain, mbYesNo|mbIconInfo) == idYes {
		cmd := exec.Command(exe)
		cmd.Dir = dir
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detached}
		cmd.Start()
	}
}

func uninstall(quiet bool) {
	dir := installDir()
	if !quiet && msgBox(appName+" deinstallieren?\n\nDeine Einstellungen und aufgezeichneten Streckenkarten bleiben erhalten.", captionMain, mbYesNo|mbIconQuest) != idYes {
		return
	}
	stopRunning()
	powershell(fmt.Sprintf(`Remove-Item -LiteralPath %s -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) %s) -Force -ErrorAction SilentlyContinue`,
		psQuote(startMenuLink()), psQuote(appName+".lnk")))
	hidden("reg.exe", "delete", regKey, "/f")
	// Autostart-Eintrag («Mit Windows starten») entfernen
	hidden("reg.exe", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", appName, "/f")
	if !quiet {
		msgBox(appName+" wurde deinstalliert.", captionMain, mbOK|mbIconInfo)
	}
	// Das laufende Deinstallationsprogramm liegt im Ordner selbst → Löschen kurz verzögert.
	// cmd.exe versteht Go's Argument-Escaping nicht → Kommandozeile roh übergeben.
	cmd := exec.Command("cmd.exe")
	cmd.Dir = os.TempDir() // nicht im Ordner stehen, der gelöscht werden soll
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWin | detached,
		CmdLine:       fmt.Sprintf(`cmd.exe /C "ping -n 3 127.0.0.1 >nul & rmdir /S /Q "%s" & rmdir /S /Q "%s.alt""`, dir, dir),
	}
	cmd.Start()
}

func main() {
	// Wichtig: Wird das Setup aus der App gestartet, «erbt» es deren Arbeitsordner – den
	// Installationsordner. Ein Ordner, in dem ein Programm steht, lässt sich unter Windows
	// weder löschen noch umbenennen. Darum zuerst woandershin wechseln.
	os.Chdir(os.TempDir())
	// Argumente: /uninstall [/quiet] | /update [-- <Startargumente für die App>]
	var own, restart []string
	for i, a := range os.Args[1:] {
		if a == "--" {
			restart = os.Args[i+2:]
			break
		}
		own = append(own, strings.ToLower(a))
	}
	has := func(f string) bool {
		for _, a := range own {
			if a == f {
				return true
			}
		}
		return false
	}
	if has("/uninstall") {
		uninstall(has("/quiet"))
		return
	}
	install(has("/update"), restart)
}
