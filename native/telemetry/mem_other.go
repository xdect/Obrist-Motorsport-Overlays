//go:build !windows

package main

import "time"

// Auf anderen Systemen gibt es kein iRacing – Platzhalter, damit Tests laufen.
type winMem struct{}

func newWinMem() *winMem         { return &winMem{} }
func (m *winMem) Open() bool     { return false }
func (m *winMem) IsOpen() bool   { return false }
func (m *winMem) Bytes() []byte  { return nil }
func (m *winMem) Wait(ms uint32) { time.Sleep(time.Duration(ms) * time.Millisecond) }
func (m *winMem) Close()         {}
