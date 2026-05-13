package runtime

import goruntime "runtime"

type Snapshot struct {
	Goroutines     int    `json:"goroutines"`
	AllocBytes     uint64 `json:"allocBytes"`
	HeapAllocBytes uint64 `json:"heapAllocBytes"`
	HeapSysBytes   uint64 `json:"heapSysBytes"`
	NumGC          uint32 `json:"numGc"`
}

func Collect() Snapshot {
	var stats goruntime.MemStats
	goruntime.ReadMemStats(&stats)
	return Snapshot{
		Goroutines:     goruntime.NumGoroutine(),
		AllocBytes:     stats.Alloc,
		HeapAllocBytes: stats.HeapAlloc,
		HeapSysBytes:   stats.HeapSys,
		NumGC:          stats.NumGC,
	}
}
