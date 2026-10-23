// omres setzt Icon, Versionsinfo und Manifest in Windows-Programmen.
//
//	omres patch -in electron.exe -out "OM Overlays.exe" -icon icon.png -name "OM Overlays" -version 1.0.0
//	omres syso  -out rsrc_windows_amd64.syso -icon icon.png -name "OM Overlays Setup" -version 1.0.0
package main

import (
	"bytes"
	"flag"
	"fmt"
	"image"
	_ "image/png"
	"os"

	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
)

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "omres:", err)
		os.Exit(1)
	}
}

func loadIcon(path string) *winres.Icon {
	f, err := os.Open(path)
	must(err)
	defer f.Close()
	img, _, err := image.Decode(f)
	must(err)
	icon, err := winres.NewIconFromResizedImage(img, []int{256, 64, 48, 40, 32, 24, 20, 16})
	must(err)
	return icon
}

func versionInfo(name, desc, file, ver, company string) version.Info {
	vi := version.Info{}
	vi.SetFileVersion(ver)
	vi.SetProductVersion(ver)
	const lang = 0x0407 // Deutsch (Schweiz wäre 0x0807; 0x0407 wird überall korrekt angezeigt)
	must(vi.Set(lang, version.ProductName, name))
	must(vi.Set(lang, version.FileDescription, desc))
	must(vi.Set(lang, version.CompanyName, company))
	must(vi.Set(lang, version.LegalCopyright, "© "+company))
	must(vi.Set(lang, version.OriginalFilename, file))
	must(vi.Set(lang, version.InternalName, name))
	return vi
}

type key struct {
	res  winres.Identifier
	lang uint16
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("omres patch|syso …")
		os.Exit(2)
	}
	mode := os.Args[1]
	fs := flag.NewFlagSet(mode, flag.ExitOnError)
	in := fs.String("in", "", "Eingabe-exe (patch)")
	out := fs.String("out", "", "Ausgabedatei")
	iconPath := fs.String("icon", "", "PNG-Icon (quadratisch, 256 px oder grösser)")
	name := fs.String("name", "OM Overlays", "Produktname")
	desc := fs.String("desc", "", "Dateibeschreibung")
	file := fs.String("file", "", "Original-Dateiname")
	ver := fs.String("version", "1.0.0", "Version")
	company := fs.String("company", "Obrist Motorsport", "Hersteller")
	must(fs.Parse(os.Args[2:]))
	if *desc == "" {
		*desc = *name
	}
	icon := loadIcon(*iconPath)

	switch mode {
	case "patch":
		src, err := os.ReadFile(*in)
		must(err)
		rs, err := winres.LoadFromEXE(bytes.NewReader(src))
		must(err)
		var groups, icons, versions []key
		rs.Walk(func(t, r winres.Identifier, l uint16, _ []byte) bool {
			switch t {
			case winres.RT_GROUP_ICON:
				groups = append(groups, key{r, l})
			case winres.RT_ICON:
				icons = append(icons, key{r, l})
			case winres.RT_VERSION:
				versions = append(versions, key{r, l})
			}
			return true
		})
		for _, k := range icons {
			must(rs.Set(winres.RT_ICON, k.res, k.lang, nil))
		}
		for _, k := range versions {
			must(rs.Set(winres.RT_VERSION, k.res, k.lang, nil))
		}
		if len(groups) == 0 {
			groups = []key{{winres.ID(1), winres.LCIDNeutral}}
		}
		for _, k := range groups {
			must(rs.Set(winres.RT_GROUP_ICON, k.res, k.lang, nil))
		}
		for _, k := range groups { // gleiche IDs behalten, damit das Programm sein Icon findet
			must(rs.SetIconTranslation(k.res, k.lang, icon))
		}
		rs.SetVersionInfo(versionInfo(*name, *desc, *file, *ver, *company))
		var buf bytes.Buffer
		must(rs.WriteToEXE(&buf, bytes.NewReader(src), winres.WithAuthenticode(winres.RemoveSignature)))
		must(os.WriteFile(*out, buf.Bytes(), 0o755))
		fmt.Printf("omres: %s geschrieben (%d Icon-Gruppen ersetzt)\n", *out, len(groups))

	case "syso":
		rs := &winres.ResourceSet{}
		must(rs.SetIcon(winres.ID(1), icon))
		rs.SetVersionInfo(versionInfo(*name, *desc, *file, *ver, *company))
		rs.SetManifest(winres.AppManifest{
			ExecutionLevel:      winres.AsInvoker,
			DPIAwareness:        winres.DPIPerMonitorV2,
			UseCommonControlsV6: true,
			Compatibility:       winres.Win7AndAbove,
		})
		f, err := os.Create(*out)
		must(err)
		defer f.Close()
		must(rs.WriteObject(f, winres.ArchAMD64))
		fmt.Printf("omres: %s geschrieben\n", *out)
	default:
		fmt.Println("unbekannter Modus:", mode)
		os.Exit(2)
	}
}
