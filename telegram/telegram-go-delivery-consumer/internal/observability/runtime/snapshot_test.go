package runtime

import "testing"

func TestCollectReportsRuntimeSnapshot(t *testing.T) {
	snapshot := Collect()

	if snapshot.Goroutines <= 0 {
		t.Fatalf("expected positive goroutine count, got %#v", snapshot)
	}
	if snapshot.HeapSysBytes == 0 {
		t.Fatalf("expected heap sys bytes to be populated, got %#v", snapshot)
	}
}
