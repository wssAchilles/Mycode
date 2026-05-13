package reclaim

import (
	"testing"
	"time"
)

func TestSchedulerControlsInterval(t *testing.T) {
	now := time.Unix(100, 0)
	scheduler := NewScheduler(time.Minute)

	if !scheduler.Due(now) {
		t.Fatalf("new scheduler should be due")
	}
	scheduler.MarkRun(now)
	if scheduler.Due(now.Add(30 * time.Second)) {
		t.Fatalf("scheduler should not be due before interval")
	}
	if !scheduler.Due(now.Add(time.Minute)) {
		t.Fatalf("scheduler should be due at interval")
	}
}
