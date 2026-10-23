// Package main: om-telemetry liest die iRacing-Telemetrie aus dem Shared Memory
// und schreibt sie als JSON-Zeilen auf stdout. Keine Fremdbibliotheken.
//
// Speicherlayout gemäss irsdk_defines.h (iRacing SDK):
//
//	irsdk_header (112 Byte): ver, status, tickRate, sessionInfoUpdate, sessionInfoLen,
//	  sessionInfoOffset, numVars, varHeaderOffset, numBuf, bufLen, pad[2], varBuf[4]
//	irsdk_varBuf (16 Byte): tickCount, bufOffset, pad[2]
//	irsdk_varHeader (144 Byte): type, offset, count, countAsTime(+3 pad), name[32], desc[64], unit[32]
package main

import (
	"encoding/binary"
	"math"
	"strings"
	"unicode/utf8"
)

const (
	headerSize      = 112
	varHeaderSize   = 144
	maxBufs         = 4
	statusConnected = 1
)

// Variablentypen
const (
	typeChar     = 0
	typeBool     = 1
	typeInt      = 2
	typeBitField = 3
	typeFloat    = 4
	typeDouble   = 5
)

var typeSize = map[int32]int{typeChar: 1, typeBool: 1, typeInt: 4, typeBitField: 4, typeFloat: 4, typeDouble: 8}

type header struct {
	Ver, Status, TickRate             int32
	SessionInfoUpdate                 int32
	SessionInfoLen, SessionInfoOffset int32
	NumVars, VarHeaderOffset          int32
	NumBuf, BufLen                    int32
	BufTick, BufOffset                [maxBufs]int32
}

type varHeader struct {
	Type, Offset, Count int32
	Name                string
}

func i32(b []byte, off int) int32 { return int32(binary.LittleEndian.Uint32(b[off:])) }

func parseHeader(b []byte) (header, bool) {
	var h header
	if len(b) < headerSize {
		return h, false
	}
	h.Ver = i32(b, 0)
	h.Status = i32(b, 4)
	h.TickRate = i32(b, 8)
	h.SessionInfoUpdate = i32(b, 12)
	h.SessionInfoLen = i32(b, 16)
	h.SessionInfoOffset = i32(b, 20)
	h.NumVars = i32(b, 24)
	h.VarHeaderOffset = i32(b, 28)
	h.NumBuf = i32(b, 32)
	h.BufLen = i32(b, 36)
	for i := 0; i < maxBufs; i++ {
		h.BufTick[i] = i32(b, 48+i*16)
		h.BufOffset[i] = i32(b, 48+i*16+4)
	}
	return h, true
}

// totalSize: wie viele Bytes ab Anfang mindestens gemappt sein müssen.
func (h header) totalSize() int {
	end := headerSize
	if e := int(h.VarHeaderOffset) + int(h.NumVars)*varHeaderSize; e > end {
		end = e
	}
	if e := int(h.SessionInfoOffset) + int(h.SessionInfoLen); e > end {
		end = e
	}
	n := int(h.NumBuf)
	if n > maxBufs {
		n = maxBufs
	}
	for i := 0; i < n; i++ {
		if e := int(h.BufOffset[i]) + int(h.BufLen); e > end {
			end = e
		}
	}
	return end
}

func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

func parseVarHeaders(b []byte, h header) map[string]varHeader {
	out := make(map[string]varHeader, h.NumVars)
	for i := 0; i < int(h.NumVars); i++ {
		o := int(h.VarHeaderOffset) + i*varHeaderSize
		if o+varHeaderSize > len(b) {
			break
		}
		v := varHeader{Type: i32(b, o), Offset: i32(b, o+4), Count: i32(b, o+8), Name: cString(b[o+16 : o+48])}
		out[v.Name] = v
	}
	return out
}

// latestBuf: Index des Puffers mit dem höchsten tickCount
func (h header) latestBuf() int {
	best := 0
	n := int(h.NumBuf)
	if n > maxBufs {
		n = maxBufs
	}
	for i := 1; i < n; i++ {
		if h.BufTick[i] > h.BufTick[best] {
			best = i
		}
	}
	return best
}

func finite(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// readValue liest eine Variable aus einer Kopie des Datenpuffers.
func readValue(buf []byte, v varHeader) any {
	size := typeSize[v.Type]
	if size == 0 || v.Count < 1 {
		return nil
	}
	one := func(o int) any {
		if o+size > len(buf) {
			return nil
		}
		switch v.Type {
		case typeBool:
			return buf[o] != 0
		case typeInt, typeBitField:
			return i32(buf, o)
		case typeFloat:
			return finite(float64(math.Float32frombits(binary.LittleEndian.Uint32(buf[o:]))))
		case typeDouble:
			return finite(math.Float64frombits(binary.LittleEndian.Uint64(buf[o:])))
		case typeChar:
			return int32(buf[o])
		}
		return nil
	}
	if v.Type == typeChar && v.Count > 1 {
		end := int(v.Offset) + int(v.Count)
		if end > len(buf) {
			return nil
		}
		return cString(buf[v.Offset:end])
	}
	if v.Count == 1 {
		return one(int(v.Offset))
	}
	arr := make([]any, v.Count)
	for i := range arr {
		arr[i] = one(int(v.Offset) + i*size)
	}
	return arr
}

// latin1ToUTF8: iRacing schreibt den Session-String in Windows-1252/Latin-1.
func latin1ToUTF8(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	sb.Grow(len(b) + 16)
	for _, c := range b {
		sb.WriteRune(rune(c))
	}
	return sb.String()
}

func readSession(mem []byte, h header) string {
	start := int(h.SessionInfoOffset)
	end := start + int(h.SessionInfoLen)
	if start < 0 || end > len(mem) || start >= end {
		return ""
	}
	raw := mem[start:end]
	for i, c := range raw {
		if c == 0 {
			raw = raw[:i]
			break
		}
	}
	return latin1ToUTF8(raw)
}
