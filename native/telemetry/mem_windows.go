//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procOpenFileMappingW = kernel32.NewProc("OpenFileMappingW")
	procOpenEventW       = kernel32.NewProc("OpenEventW")
	procVirtualQuery     = kernel32.NewProc("VirtualQuery")
)

const (
	fileMapRead = 0x0004
	synchronize = 0x00100000
	memMapName  = `Local\IRSDKMemMapFileName`
	dataEvtName = `Local\IRSDKDataValidEvent`
)

type memoryBasicInformation struct {
	BaseAddress       uintptr
	AllocationBase    uintptr
	AllocationProtect uint32
	PartitionID       uint16
	_                 uint16
	RegionSize        uintptr
	State             uint32
	Protect           uint32
	Type              uint32
	_                 uint32
}

type winMem struct {
	mapping syscall.Handle
	event   syscall.Handle
	addr    uintptr
	size    int
}

func newWinMem() *winMem { return &winMem{} }

func (m *winMem) IsOpen() bool { return m.addr != 0 }

func (m *winMem) Open() bool {
	if m.addr != 0 {
		return true
	}
	name, _ := syscall.UTF16PtrFromString(memMapName)
	h, _, _ := procOpenFileMappingW.Call(fileMapRead, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return false
	}
	addr, err := syscall.MapViewOfFile(syscall.Handle(h), fileMapRead, 0, 0, 0)
	if err != nil || addr == 0 {
		syscall.CloseHandle(syscall.Handle(h))
		return false
	}
	var mbi memoryBasicInformation
	r, _, _ := procVirtualQuery.Call(addr, uintptr(unsafe.Pointer(&mbi)), unsafe.Sizeof(mbi))
	if r == 0 || mbi.RegionSize < headerSize {
		syscall.UnmapViewOfFile(addr)
		syscall.CloseHandle(syscall.Handle(h))
		return false
	}
	m.mapping = syscall.Handle(h)
	m.addr = addr
	m.size = int(mbi.RegionSize)

	evName, _ := syscall.UTF16PtrFromString(dataEvtName)
	e, _, _ := procOpenEventW.Call(synchronize, 0, uintptr(unsafe.Pointer(evName)))
	m.event = syscall.Handle(e)
	return true
}

func (m *winMem) Bytes() []byte {
	if m.addr == 0 {
		return nil
	}
	return unsafe.Slice((*byte)(unsafe.Pointer(m.addr)), m.size)
}

// Wait wartet auf das "Daten gültig"-Signal von iRacing (60 Hz) oder höchstens ms.
func (m *winMem) Wait(ms uint32) {
	if m.event != 0 {
		syscall.WaitForSingleObject(m.event, ms)
		return
	}
	time.Sleep(16 * time.Millisecond)
}

func (m *winMem) Close() {
	if m.addr != 0 {
		syscall.UnmapViewOfFile(m.addr)
		m.addr = 0
	}
	if m.mapping != 0 {
		syscall.CloseHandle(m.mapping)
		m.mapping = 0
	}
	if m.event != 0 {
		syscall.CloseHandle(m.event)
		m.event = 0
	}
}
