package main

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

type fakeMem struct {
	b    []byte
	open bool
}

func (f *fakeMem) Open() bool    { f.open = true; return true }
func (f *fakeMem) IsOpen() bool  { return f.open }
func (f *fakeMem) Bytes() []byte { return f.b }
func (f *fakeMem) Wait(uint32)   {}
func (f *fakeMem) Close()        { f.open = false }

type fv struct {
	name  string
	typ   int32
	count int32
}

// buildMem baut ein Speicherabbild wie es iRacing erzeugt.
func buildMem(vars []fv, session string, tick int32, fill func(buf []byte, offs map[string]int)) []byte {
	const varHdrOff = 144
	sessOff := varHdrOff + len(vars)*varHeaderSize
	sess := append([]byte(session), 0)
	// Pufferlayout
	offs := map[string]int{}
	o := 0
	for _, v := range vars {
		offs[v.name] = o
		o += typeSize[v.typ] * int(v.count)
	}
	bufLen := o
	buf0 := sessOff + len(sess) + 64
	total := buf0 + bufLen*3
	b := make([]byte, total)
	put := func(off int, v int32) { binary.LittleEndian.PutUint32(b[off:], uint32(v)) }
	put(0, 2)               // ver
	put(4, statusConnected) // status
	put(8, 60)
	put(12, 7) // sessionInfoUpdate
	put(16, int32(len(sess)))
	put(20, int32(sessOff))
	put(24, int32(len(vars)))
	put(28, varHdrOff)
	put(32, 3) // numBuf
	put(36, int32(bufLen))
	for i, v := range vars {
		h := varHdrOff + i*varHeaderSize
		put(h, v.typ)
		put(h+4, int32(offs[v.name]))
		put(h+8, v.count)
		copy(b[h+16:], v.name)
	}
	copy(b[sessOff:], sess)
	// Puffer 0 und 2 alt, Puffer 1 neu
	for i := 0; i < 3; i++ {
		t := tick - 10
		if i == 1 {
			t = tick
		}
		put(48+i*16, t)
		put(48+i*16+4, int32(buf0+i*bufLen))
	}
	fill(b[buf0+bufLen:buf0+2*bufLen], offs)
	return b
}

func TestReaderReadsLatestBuffer(t *testing.T) {
	vars := []fv{
		{"FuelLevel", typeFloat, 1},
		{"Gear", typeInt, 1},
		{"OnPitRoad", typeBool, 1},
		{"SessionTime", typeDouble, 1},
		{"CarIdxLapDistPct", typeFloat, 64},
		{"CarIdxPosition", typeInt, 64},
	}
	mem := buildMem(vars, "---\nWeekendInfo:\n TrackName: redbullring gp\n...\n", 1234, func(buf []byte, offs map[string]int) {
		binary.LittleEndian.PutUint32(buf[offs["FuelLevel"]:], math.Float32bits(61.5))
		binary.LittleEndian.PutUint32(buf[offs["Gear"]:], 4)
		buf[offs["OnPitRoad"]] = 1
		binary.LittleEndian.PutUint64(buf[offs["SessionTime"]:], math.Float64bits(812.25))
		binary.LittleEndian.PutUint32(buf[offs["CarIdxLapDistPct"]+4*3:], math.Float32bits(0.5))
		binary.LittleEndian.PutUint32(buf[offs["CarIdxLapDistPct"]+4*4:], math.Float32bits(float32(math.NaN())))
		binary.LittleEndian.PutUint32(buf[offs["CarIdxPosition"]+4*3:], 5)
	})
	r := newReader(&fakeMem{b: mem}, []string{"FuelLevel", "Gear", "OnPitRoad", "SessionTime", "CarIdxLapDistPct", "CarIdxPosition", "Missing"})
	msgs := r.poll()
	kinds := map[string]message{}
	for _, m := range msgs {
		kinds[m["t"].(string)] = m
	}
	if kinds["status"]["connected"] != true {
		t.Fatalf("status fehlt: %v", msgs)
	}
	if kinds["session"]["yaml"] == "" {
		t.Fatal("session fehlt")
	}
	tele := kinds["tele"]
	if tele == nil || tele["tick"] != int32(1234) {
		t.Fatalf("tele falsch: %v", tele)
	}
	v := tele["vars"].(map[string]any)
	if v["FuelLevel"].(float64) != 61.5 || v["Gear"] != int32(4) || v["OnPitRoad"] != true || v["SessionTime"].(float64) != 812.25 {
		t.Fatalf("werte falsch: %v", v)
	}
	pct := v["CarIdxLapDistPct"].([]any)
	if len(pct) != 64 || pct[3].(float64) != 0.5 || pct[4].(float64) != 0 {
		t.Fatalf("array falsch: %v", pct[:6])
	}
	if _, ok := v["Missing"]; ok {
		t.Fatal("unbekannte Variable sollte fehlen")
	}
	// JSON muss sich serialisieren lassen (kein NaN)
	if _, err := json.Marshal(tele); err != nil {
		t.Fatal(err)
	}
	// Gleicher Tick → keine neue Telemetrie, Session nicht erneut
	if again := r.poll(); len(again) != 0 {
		t.Fatalf("erwartete keine Nachrichten, bekam %v", again)
	}
}

func TestDisconnected(t *testing.T) {
	mem := make([]byte, 200)
	r := newReader(&fakeMem{b: mem}, nil)
	msgs := r.poll()
	if len(msgs) != 1 || msgs[0]["connected"] != false {
		t.Fatalf("%v", msgs)
	}
}

func TestLatin1(t *testing.T) {
	if s := latin1ToUTF8([]byte{'M', 0xFC, 'l', 'l', 'e', 'r'}); s != "Müller" {
		t.Fatal(s)
	}
}
