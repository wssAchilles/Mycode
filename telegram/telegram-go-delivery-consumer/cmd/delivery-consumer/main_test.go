package main

import (
	"testing"

	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
)

func TestBuildReplayWorkerRequiresExplicitAuthorization(t *testing.T) {
	built := false
	worker := buildReplayWorker(false, func() *platformreplay.Worker {
		built = true
		return new(platformreplay.Worker)
	})
	if built || worker != nil {
		t.Fatalf("disabled replay worker crossed construction boundary")
	}

	sentinel := new(platformreplay.Worker)
	worker = buildReplayWorker(true, func() *platformreplay.Worker {
		built = true
		return sentinel
	})
	if !built || worker != sentinel {
		t.Fatalf("explicit replay worker authorization was ignored")
	}
}
