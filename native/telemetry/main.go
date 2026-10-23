package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"
)

// memSource abstrahiert das Shared Memory (Windows) – im Test durch einen Fake ersetzt.
type memSource interface {
	Open() bool
	IsOpen() bool
	Bytes() []byte
	Wait(ms uint32)
	Close()
}

type message map[string]any

type reader struct {
	src          memSource
	vars         []string
	varIdx       map[string]varHeader
	varSig       [2]int32
	lastTick     int32
	lastSession  int32
	lastStatus   time.Time
	offlineSince time.Time
	connected    bool
	buf          []byte
}

func newReader(src memSource, vars []string) *reader {
	return &reader{src: src, vars: vars, lastTick: -1, lastSession: -1}
}

func (r *reader) status(connected bool, force bool) []message {
	if connected == r.connected && !force && time.Since(r.lastStatus) < time.Second {
		return nil
	}
	r.connected = connected
	r.lastStatus = time.Now()
	return []message{{"t": "status", "connected": connected}}
}

// poll liest einmal und gibt die zu sendenden Nachrichten zurück.
func (r *reader) poll() []message {
	if !r.src.IsOpen() {
		if !r.src.Open() {
			return r.status(false, false)
		}
		r.varIdx = nil
		r.lastSession = -1
		r.lastTick = -1
	}
	mem := r.src.Bytes()
	h, ok := parseHeader(mem)
	if !ok || h.Status&statusConnected == 0 || h.NumBuf < 1 {
		if r.offlineSince.IsZero() {
			r.offlineSince = time.Now()
		} else if time.Since(r.offlineSince) > 10*time.Second {
			r.src.Close() // iRacing beendet: Handle freigeben, später neu öffnen
			r.offlineSince = time.Time{}
		}
		r.lastSession = -1
		return r.status(false, false)
	}
	r.offlineSince = time.Time{}
	var out []message
	if !r.connected {
		out = append(out, r.status(true, true)...)
	}
	if h.totalSize() > len(mem) {
		return out
	}

	sig := [2]int32{h.NumVars, h.VarHeaderOffset}
	if r.varIdx == nil || sig != r.varSig {
		r.varIdx = parseVarHeaders(mem, h)
		r.varSig = sig
	}

	if h.SessionInfoUpdate != r.lastSession {
		if s := readSession(mem, h); s != "" {
			r.lastSession = h.SessionInfoUpdate
			out = append(out, message{"t": "session", "update": h.SessionInfoUpdate, "yaml": s})
		}
	}

	// Neuesten Datenpuffer konsistent kopieren (iRacing schreibt parallel)
	for attempt := 0; attempt < 3; attempt++ {
		i := h.latestBuf()
		tick := h.BufTick[i]
		if tick == r.lastTick {
			return out
		}
		off, n := int(h.BufOffset[i]), int(h.BufLen)
		if off < 0 || off+n > len(mem) {
			return out
		}
		if cap(r.buf) < n {
			r.buf = make([]byte, n)
		}
		r.buf = r.buf[:n]
		copy(r.buf, mem[off:off+n])
		h2, _ := parseHeader(mem)
		if h2.BufTick[i] != tick {
			h = h2
			continue
		}
		vals := make(map[string]any, len(r.vars))
		for _, name := range r.vars {
			if v, ok := r.varIdx[name]; ok {
				vals[name] = readValue(r.buf, v)
			}
		}
		r.lastTick = tick
		out = append(out, message{"t": "tele", "tick": tick, "vars": vals})
		return out
	}
	return out
}

func main() {
	varsFlag := flag.String("vars", "", "kommagetrennte Liste der Telemetrie-Variablen")
	list := flag.Bool("list", false, "alle verfügbaren Variablen auflisten und beenden")
	once := flag.Bool("once", false, "einen Datensatz ausgeben und beenden")
	flag.Parse()

	src := newWinMem()
	out := bufio.NewWriterSize(os.Stdout, 64*1024)
	enc := json.NewEncoder(out)

	if *list {
		for i := 0; i < 50 && !src.Open(); i++ {
			time.Sleep(100 * time.Millisecond)
		}
		if !src.IsOpen() {
			fmt.Println("iRacing läuft nicht.")
			os.Exit(1)
		}
		h, _ := parseHeader(src.Bytes())
		idx := parseVarHeaders(src.Bytes(), h)
		names := make([]string, 0, len(idx))
		for n := range idx {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			fmt.Printf("%-36s type=%d count=%d\n", n, idx[n].Type, idx[n].Count)
		}
		return
	}

	var vars []string
	for _, v := range strings.Split(*varsFlag, ",") {
		if v = strings.TrimSpace(v); v != "" {
			vars = append(vars, v)
		}
	}

	// Elternprozess weg (stdin geschlossen) → beenden, damit kein Prozess hängen bleibt.
	if !*once {
		go func() {
			io.Copy(io.Discard, os.Stdin)
			os.Exit(0)
		}()
	}

	r := newReader(src, vars)
	for {
		if src.IsOpen() {
			src.Wait(50)
		} else {
			time.Sleep(500 * time.Millisecond)
		}
		msgs := r.poll()
		for _, m := range msgs {
			if err := enc.Encode(m); err != nil {
				os.Exit(0)
			}
		}
		if len(msgs) > 0 {
			if err := out.Flush(); err != nil {
				os.Exit(0) // Pipe geschlossen
			}
		}
		if *once {
			for _, m := range msgs {
				if m["t"] == "tele" {
					return
				}
			}
		}
	}
}
