package reservation

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
)

func TestConcurrencyBounds(t *testing.T) {
	if Concurrency(0) != DefaultConcurrency {
		t.Fatalf("expected default concurrency")
	}
	if Concurrency(128) != 64 {
		t.Fatalf("expected cap")
	}
	if Concurrency(12) != 12 {
		t.Fatalf("expected configured concurrency")
	}
}

func TestRunBoundedCancelsAfterFirstError(t *testing.T) {
	reserveErr := errors.New("reserve failed")
	var calls int32

	values, err := RunBounded(
		context.Background(),
		[]string{"u1", "u2", "u3", "u4"},
		1,
		func(_ context.Context, userID string) (string, error) {
			atomic.AddInt32(&calls, 1)
			if userID == "u2" {
				return "", reserveErr
			}
			return userID, nil
		},
	)

	if !errors.Is(err, reserveErr) {
		t.Fatalf("expected reservation error, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("expected worker to stop after first error, got %d calls", calls)
	}
	if len(values) != 1 || values[0] != "u1" {
		t.Fatalf("expected successful values before error, got %#v", values)
	}
}
