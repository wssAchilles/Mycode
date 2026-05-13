package reclaim

import (
	"context"
	"errors"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"
)

type fakeScannerClient struct {
	batches [][]redis.XMessage
	cursors []string
	starts  []string
	calls   int
}

func (f *fakeScannerClient) XAutoClaim(_ context.Context, a *redis.XAutoClaimArgs) *redis.XAutoClaimCmd {
	f.calls++
	f.starts = append(f.starts, a.Start)
	cmd := redis.NewXAutoClaimCmd(context.Background())
	if len(f.batches) == 0 {
		cmd.SetVal(nil, StartCursor)
		return cmd
	}
	messages := append([]redis.XMessage(nil), f.batches[0]...)
	f.batches = f.batches[1:]
	next := StartCursor
	if len(f.cursors) > 0 {
		next = f.cursors[0]
		f.cursors = f.cursors[1:]
	}
	cmd.SetVal(messages, next)
	return cmd
}

type fakeScannerRecorder struct {
	deadLetters int
	errors      []string
	records     []fakeScannerRecord
}

type fakeScannerRecord struct {
	streamKey   string
	claimed     int
	poison      int
	ackFailures int
	lastCursor  string
}

func (f *fakeScannerRecorder) DeadLetterCount() int {
	return f.deadLetters
}

func (f *fakeScannerRecorder) RecordError(message string) {
	f.errors = append(f.errors, message)
}

func (f *fakeScannerRecorder) RecordPendingReclaimDuration(
	streamKey string,
	claimed int,
	poison int,
	ackFailures int,
	lastCursor string,
	_ time.Duration,
) {
	f.records = append(f.records, fakeScannerRecord{
		streamKey:   streamKey,
		claimed:     claimed,
		poison:      poison,
		ackFailures: ackFailures,
		lastCursor:  lastCursor,
	})
}

func TestScannerRespectsMaxBatchesAndRecordsCursor(t *testing.T) {
	client := &fakeScannerClient{
		batches: [][]redis.XMessage{
			{{ID: "1-0"}},
			{{ID: "2-0"}},
		},
		cursors: []string{"1-1", "2-1"},
	}
	recorder := &fakeScannerRecorder{}
	cursors := NewCursorTracker()
	scanner := Scanner{
		Client:   client,
		Handler:  func(context.Context, string, redis.XMessage) error { return nil },
		Recorder: recorder,
		Cursors:  cursors,
		Config: ScannerConfig{
			ConsumerGroup: "group",
			ConsumerName:  "consumer",
			MinIdle:       time.Minute,
			ClaimCount:    1,
			MaxBatches:    1,
			CursorMode:    "resume",
		},
	}

	if err := scanner.ScanStream(context.Background(), "stream-a"); err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	if client.calls != 1 {
		t.Fatalf("expected one batch, got %d", client.calls)
	}
	if got := cursors.Start("stream-a"); got != "1-1" {
		t.Fatalf("expected cursor to resume from 1-1, got %s", got)
	}
	if len(recorder.records) != 1 || recorder.records[0].claimed != 1 {
		t.Fatalf("expected one reclaim record, got %#v", recorder.records)
	}
}

func TestScannerCountsPoisonAndAckFailures(t *testing.T) {
	client := &fakeScannerClient{
		batches: [][]redis.XMessage{{{ID: "3-0"}, {ID: "4-0"}}},
		cursors: []string{StartCursor},
	}
	recorder := &fakeScannerRecorder{}
	handlerCalls := 0
	scanner := Scanner{
		Client: client,
		Handler: func(_ context.Context, streamKey string, message redis.XMessage) error {
			handlerCalls++
			if message.ID == "3-0" {
				recorder.deadLetters++
				return errors.New("poison payload")
			}
			return NewAckError(streamKey, message.ID, errors.New("ack failed"))
		},
		Recorder: recorder,
		Cursors:  NewCursorTracker(),
		Config: ScannerConfig{
			ConsumerGroup: "group",
			ConsumerName:  "consumer",
			MinIdle:       time.Minute,
			ClaimCount:    2,
			MaxBatches:    4,
			CursorMode:    "resume",
		},
	}

	if err := scanner.ScanStream(context.Background(), "stream-a"); err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	if handlerCalls != 2 {
		t.Fatalf("expected two handler calls, got %d", handlerCalls)
	}
	if len(recorder.records) != 1 {
		t.Fatalf("expected one reclaim record, got %#v", recorder.records)
	}
	record := recorder.records[0]
	if record.claimed != 2 || record.poison != 1 || record.ackFailures != 1 {
		t.Fatalf("unexpected reclaim record: %#v", record)
	}
	if len(recorder.errors) != 2 {
		t.Fatalf("expected both handler errors to be recorded, got %#v", recorder.errors)
	}
}
