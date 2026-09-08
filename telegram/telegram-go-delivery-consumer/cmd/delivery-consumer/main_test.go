package main

import (
	"context"
	"errors"
	"testing"
	"time"

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

func TestWaitForReplayWorkerJoinsOrTimesOut(t *testing.T) {
	done := make(chan error, 1)
	done <- context.Canceled
	close(done)
	if err := waitForReplayWorker(done, time.Second); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait did not return worker result: %v", err)
	}

	blocked := make(chan error)
	if err := waitForReplayWorker(blocked, 0); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("wait did not bound worker shutdown: %v", err)
	}
	if err := waitForReplayWorker(nil, time.Second); err != nil {
		t.Fatalf("disabled worker wait failed: %v", err)
	}
}
