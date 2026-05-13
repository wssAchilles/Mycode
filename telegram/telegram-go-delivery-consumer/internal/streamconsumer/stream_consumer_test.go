package streamconsumer

import (
	"context"
	"errors"
	"io"
	"log"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type fakeStreamClient struct {
	groupCreated     bool
	ackedIDs         []string
	xaddRecords      []fakeXAddRecord
	streams          []redis.XStream
	claimedMessages  []redis.XMessage
	claimedBatches   [][]redis.XMessage
	claimCursors     []string
	xAutoClaimStarts []string
	xAutoClaimCalls  int
	xAckErr          error
}

type fakeXAddRecord struct {
	stream string
	values map[string]interface{}
}

type fakePublishRecord struct {
	channel string
	message interface{}
}

type fakePrimaryExecutor struct {
	calls          int
	payload        primary.FanoutPayload
	result         primary.ExecutionResult
	err            error
	failureRecords []fakePrimaryFailureRecord
}

type fakePrimaryFailureRecord struct {
	outboxID string
	reason   string
	terminal bool
}

func (f *fakePrimaryExecutor) ExecuteFanout(ctx context.Context, payload primary.FanoutPayload) (primary.ExecutionResult, error) {
	_ = ctx
	f.calls++
	f.payload = payload
	if f.err != nil {
		return primary.ExecutionResult{}, f.err
	}
	return f.result, nil
}

func (f *fakePrimaryExecutor) RecordFailure(_ context.Context, payload primary.FanoutPayload, reason string, terminal bool) error {
	f.failureRecords = append(f.failureRecords, fakePrimaryFailureRecord{
		outboxID: payload.OutboxID,
		reason:   reason,
		terminal: terminal,
	})
	return nil
}

func (f *fakeStreamClient) XGroupCreateMkStream(_ context.Context, _ string, _ string, _ string) *redis.StatusCmd {
	f.groupCreated = true
	cmd := redis.NewStatusCmd(context.Background())
	cmd.SetVal("OK")
	return cmd
}

func (f *fakeStreamClient) XReadGroup(_ context.Context, _ *redis.XReadGroupArgs) *redis.XStreamSliceCmd {
	cmd := redis.NewXStreamSliceCmd(context.Background())
	if len(f.streams) > 0 {
		cmd.SetVal(f.streams)
		return cmd
	}
	cmd.SetVal([]redis.XStream{
		{
			Stream: "chat:delivery:bus:v1",
			Messages: []redis.XMessage{
				{
					ID: "1-0",
					Values: map[string]interface{}{
						"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-1","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-1"}}`,
					},
				},
			},
		},
	})
	return cmd
}

func (f *fakeStreamClient) XAutoClaim(_ context.Context, a *redis.XAutoClaimArgs) *redis.XAutoClaimCmd {
	f.xAutoClaimCalls++
	f.xAutoClaimStarts = append(f.xAutoClaimStarts, a.Start)
	cmd := redis.NewXAutoClaimCmd(context.Background())
	if len(f.claimedBatches) > 0 {
		claimed := append([]redis.XMessage(nil), f.claimedBatches[0]...)
		f.claimedBatches = f.claimedBatches[1:]
		next := "0-0"
		if len(f.claimCursors) > 0 {
			next = f.claimCursors[0]
			f.claimCursors = f.claimCursors[1:]
		}
		cmd.SetVal(claimed, next)
		return cmd
	}
	if len(f.claimedMessages) == 0 {
		cmd.SetVal(nil, "0-0")
		return cmd
	}
	claimed := append([]redis.XMessage(nil), f.claimedMessages...)
	f.claimedMessages = nil
	cmd.SetVal(claimed, "0-0")
	return cmd
}

func (f *fakeStreamClient) XAck(_ context.Context, _ string, _ string, ids ...string) *redis.IntCmd {
	f.ackedIDs = append(f.ackedIDs, ids...)
	cmd := redis.NewIntCmd(context.Background())
	if f.xAckErr != nil {
		cmd.SetErr(f.xAckErr)
		return cmd
	}
	cmd.SetVal(int64(len(ids)))
	return cmd
}

func (f *fakeStreamClient) XAdd(_ context.Context, a *redis.XAddArgs) *redis.StringCmd {
	values, _ := a.Values.(map[string]interface{})
	f.xaddRecords = append(f.xaddRecords, fakeXAddRecord{
		stream: a.Stream,
		values: values,
	})
	cmd := redis.NewStringCmd(context.Background())
	cmd.SetVal("dlq-1")
	return cmd
}

func TestConsumeOnceAcknowledgesMessages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	client := &fakeStreamClient{}
	consumer := New(client, config.Config{
		StreamKey:     "chat:delivery:bus:v1",
		DLQStreamKey:  "chat:delivery:bus:dlq:v1",
		ConsumerGroup: "go-dryrun",
		ConsumerName:  "consumer-a",
		ExecutionMode: "dry-run",
		BlockDuration: time.Second,
		ReadCount:     10,
		DryRun:        true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ensureGroup(context.Background()); err != nil {
		t.Fatalf("ensureGroup failed: %v", err)
	}
	if !client.groupCreated {
		t.Fatalf("expected consumer group to be created")
	}
	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.EventsConsumed != 1 {
		t.Fatalf("expected one consumed event, got %d", snapshot.EventsConsumed)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "1-0" {
		t.Fatalf("expected ack for the consumed message, got %#v", client.ackedIDs)
	}
}

func (f *fakeStreamClient) Publish(_ context.Context, channel string, message interface{}) *redis.IntCmd {
	cmd := redis.NewIntCmd(context.Background())
	cmd.SetVal(1)
	f.xaddRecords = append(f.xaddRecords, fakeXAddRecord{
		stream: "pubsub:" + channel,
		values: map[string]interface{}{
			"message": message,
		},
	})
	return cmd
}

func TestConsumeOnceTracksShadowProjectionMatches(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-shadow", "consumer-a", "shadow", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "1-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-1","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-1","chatId":"chat-1","recipientIds":["u1","u2","u3"],"outboxId":"outbox-1","dispatchMode":"queued"}}`,
						},
					},
					{
						ID: "2-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-2","topic":"fanout_projection_completed","emittedAt":"2026-04-15T00:00:01Z","partitionKey":"chat-1","payload":{"messageId":"msg-1","chatId":"chat-1","outboxId":"outbox-1","chunkIndex":0,"projection":{"recipientCount":3,"chunkCount":1}}}`,
						},
					},
				},
			},
		},
	}
	consumer := New(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		ConsumerGroup:         "go-shadow",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "shadow",
		MaxRecipientsPerChunk: 10,
		BlockDuration:         time.Second,
		ReadCount:             10,
		DryRun:                false,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.ShadowPlanned != 1 {
		t.Fatalf("expected one shadow plan, got %d", snapshot.ShadowPlanned)
	}
	if snapshot.ShadowCompared != 1 || snapshot.ShadowMatched != 1 {
		t.Fatalf("expected one matched shadow comparison, got %#v", snapshot)
	}
}

func TestConsumeOnceWritesPoisonMessagesToDLQ(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-shadow", "consumer-a", "shadow", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "3-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-3","topic":"fanout_projection_completed","emittedAt":"2026-04-15T00:00:02Z","partitionKey":"chat-1","payload":{"messageId":"msg-2","chatId":"chat-1"}}`,
						},
					},
				},
			},
		},
	}
	consumer := New(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		ConsumerGroup:         "go-shadow",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "shadow",
		MaxRecipientsPerChunk: 10,
		BlockDuration:         time.Second,
		ReadCount:             10,
		DryRun:                false,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.DeadLetters != 1 {
		t.Fatalf("expected one dead-letter write, got %#v", snapshot)
	}
	if len(client.xaddRecords) != 1 {
		t.Fatalf("expected one dlq write, got %#v", client.xaddRecords)
	}
	if client.xaddRecords[0].stream != "chat:delivery:bus:dlq:v1" {
		t.Fatalf("expected dlq stream write, got %s", client.xaddRecords[0].stream)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "3-0" {
		t.Fatalf("expected poisoned message ack, got %#v", client.ackedIDs)
	}
}

func TestConsumeOnceProcessesAutoClaimedPendingMessages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	client := &fakeStreamClient{
		streams: []redis.XStream{{Stream: "chat:delivery:bus:v1"}},
		claimedMessages: []redis.XMessage{
			{
				ID: "9-0",
				Values: map[string]interface{}{
					"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-9","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-9"}}`,
				},
			},
		},
	}
	consumer := New(client, config.Config{
		StreamKey:            "chat:delivery:bus:v1",
		DLQStreamKey:         "chat:delivery:bus:dlq:v1",
		ConsumerGroup:        "go-dryrun",
		ConsumerName:         "consumer-a",
		ExecutionMode:        "dry-run",
		BlockDuration:        time.Second,
		ReadCount:            10,
		PendingIdleDuration:  time.Minute,
		PendingClaimCount:    10,
		PendingClaimInterval: time.Hour,
		DryRun:               true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if client.xAutoClaimCalls != 1 {
		t.Fatalf("expected one autoclaim call, got %d", client.xAutoClaimCalls)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "9-0" {
		t.Fatalf("expected ack for claimed message, got %#v", client.ackedIDs)
	}
	if state.Snapshot().EventsConsumed != 1 {
		t.Fatalf("expected claimed message to be recorded as consumed")
	}
	if state.Snapshot().PendingReclaimClaimed != 1 {
		t.Fatalf("expected pending reclaim claimed metric, got %#v", state.Snapshot())
	}
	if state.Snapshot().PendingReclaimStreams["chat:delivery:bus:v1"].Claimed != 1 {
		t.Fatalf("expected per-stream reclaim metrics, got %#v", state.Snapshot().PendingReclaimStreams)
	}
}

func TestConsumeOnceCountsTypedAckFailureForClaimedMessages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	client := &fakeStreamClient{
		streams: []redis.XStream{{Stream: "chat:delivery:bus:v1"}},
		claimedMessages: []redis.XMessage{
			{
				ID: "9-1",
				Values: map[string]interface{}{
					"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-9-1","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-9-1"}}`,
				},
			},
		},
		xAckErr: errors.New("redis ack failed"),
	}
	consumer := New(client, config.Config{
		StreamKey:            "chat:delivery:bus:v1",
		DLQStreamKey:         "chat:delivery:bus:dlq:v1",
		ConsumerGroup:        "go-dryrun",
		ConsumerName:         "consumer-a",
		ExecutionMode:        "dry-run",
		BlockDuration:        time.Second,
		ReadCount:            10,
		PendingIdleDuration:  time.Minute,
		PendingClaimCount:    10,
		PendingClaimInterval: time.Hour,
		DryRun:               true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.PendingReclaimAckFailures != 1 {
		t.Fatalf("expected one typed ack failure, got %#v", snapshot)
	}
	if snapshot.PendingReclaimStreams["chat:delivery:bus:v1"].AckFailures != 1 {
		t.Fatalf("expected per-stream ack failure metric, got %#v", snapshot.PendingReclaimStreams)
	}
}

func TestConsumeOnceDeadLettersPoisonAutoClaimedMessages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-shadow", "consumer-a", "shadow", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{{Stream: "chat:delivery:bus:v1"}},
		claimedMessages: []redis.XMessage{
			{
				ID: "10-0",
				Values: map[string]interface{}{
					"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-10","topic":"fanout_projection_completed","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-10","chatId":"chat-1"}}`,
				},
			},
		},
	}
	consumer := New(client, config.Config{
		StreamKey:            "chat:delivery:bus:v1",
		DLQStreamKey:         "chat:delivery:bus:dlq:v1",
		ConsumerGroup:        "go-shadow",
		ConsumerName:         "consumer-a",
		ExecutionMode:        "shadow",
		BlockDuration:        time.Second,
		ReadCount:            10,
		PendingIdleDuration:  time.Minute,
		PendingClaimCount:    10,
		PendingClaimInterval: time.Hour,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.DeadLetters != 1 {
		t.Fatalf("expected claimed poison message to be dead-lettered, got %#v", snapshot)
	}
	if len(client.xaddRecords) != 1 || client.xaddRecords[0].stream != "chat:delivery:bus:dlq:v1" {
		t.Fatalf("expected one dlq write, got %#v", client.xaddRecords)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "10-0" {
		t.Fatalf("expected ack for claimed poison message, got %#v", client.ackedIDs)
	}
	if snapshot.PendingReclaimPoison != 1 {
		t.Fatalf("expected pending poison metric, got %#v", snapshot)
	}
}

func TestConsumeOnceSkipsAutoClaimBeforeInterval(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	client := &fakeStreamClient{
		streams: []redis.XStream{{Stream: "chat:delivery:bus:v1"}},
	}
	consumer := New(client, config.Config{
		StreamKey:            "chat:delivery:bus:v1",
		DLQStreamKey:         "chat:delivery:bus:dlq:v1",
		ConsumerGroup:        "go-dryrun",
		ConsumerName:         "consumer-a",
		ExecutionMode:        "dry-run",
		BlockDuration:        time.Second,
		ReadCount:            10,
		PendingIdleDuration:  time.Minute,
		PendingClaimCount:    10,
		PendingClaimInterval: time.Hour,
		DryRun:               true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("first consume once failed: %v", err)
	}
	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("second consume once failed: %v", err)
	}
	if client.xAutoClaimCalls != 1 {
		t.Fatalf("expected autoclaim to respect interval, got %d calls", client.xAutoClaimCalls)
	}
}

func TestConsumeOnceLimitsAutoClaimBatches(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	client := &fakeStreamClient{
		streams: []redis.XStream{{Stream: "chat:delivery:bus:v1"}},
		claimedBatches: [][]redis.XMessage{
			{
				{
					ID: "20-0",
					Values: map[string]interface{}{
						"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-20","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-20"}}`,
					},
				},
			},
			{
				{
					ID: "21-0",
					Values: map[string]interface{}{
						"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-21","topic":"message_written","emittedAt":"2026-04-15T00:00:01Z","partitionKey":"chat-1","payload":{"messageId":"msg-21"}}`,
					},
				},
			},
		},
		claimCursors: []string{"20-1", "21-1"},
	}
	consumer := New(client, config.Config{
		StreamKey:                "chat:delivery:bus:v1",
		DLQStreamKey:             "chat:delivery:bus:dlq:v1",
		ConsumerGroup:            "go-dryrun",
		ConsumerName:             "consumer-a",
		ExecutionMode:            "dry-run",
		BlockDuration:            time.Second,
		ReadCount:                10,
		PendingIdleDuration:      time.Minute,
		PendingClaimCount:        1,
		PendingClaimInterval:     time.Hour,
		PendingReclaimMaxBatches: 1,
		DryRun:                   true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if client.xAutoClaimCalls != 1 {
		t.Fatalf("expected one reclaim batch, got %d", client.xAutoClaimCalls)
	}
	snapshot := state.Snapshot()
	if snapshot.PendingReclaimClaimed != 1 {
		t.Fatalf("expected one claimed pending message, got %#v", snapshot)
	}
	if snapshot.PendingReclaimLastCursor["chat:delivery:bus:v1"] != "20-1" {
		t.Fatalf("expected last cursor to be recorded, got %#v", snapshot.PendingReclaimLastCursor)
	}
}

func TestReclaimPendingStreamResumesFromLastCursor(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	client := &fakeStreamClient{
		claimedBatches: [][]redis.XMessage{
			{
				{
					ID: "30-0",
					Values: map[string]interface{}{
						"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-30","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-30"}}`,
					},
				},
			},
			{
				{
					ID: "31-0",
					Values: map[string]interface{}{
						"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-31","topic":"message_written","emittedAt":"2026-04-15T00:00:01Z","partitionKey":"chat-1","payload":{"messageId":"msg-31"}}`,
					},
				},
			},
		},
		claimCursors: []string{"30-1", "0-0"},
	}
	consumer := New(client, config.Config{
		StreamKey:                "chat:delivery:bus:v1",
		DLQStreamKey:             "chat:delivery:bus:dlq:v1",
		ConsumerGroup:            "go-dryrun",
		ConsumerName:             "consumer-a",
		ExecutionMode:            "dry-run",
		PendingIdleDuration:      time.Minute,
		PendingClaimCount:        1,
		PendingReclaimMaxBatches: 1,
		ReclaimCursorMode:        "resume",
		DryRun:                   true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.reclaimPendingStream(context.Background(), "chat:delivery:bus:v1"); err != nil {
		t.Fatalf("first reclaim failed: %v", err)
	}
	if err := consumer.reclaimPendingStream(context.Background(), "chat:delivery:bus:v1"); err != nil {
		t.Fatalf("second reclaim failed: %v", err)
	}

	expectedStarts := []string{"0-0", "30-1"}
	if len(client.xAutoClaimStarts) != len(expectedStarts) {
		t.Fatalf("unexpected autoclaim starts: %#v", client.xAutoClaimStarts)
	}
	for index, expected := range expectedStarts {
		if client.xAutoClaimStarts[index] != expected {
			t.Fatalf("expected start %s at index %d, got %#v", expected, index, client.xAutoClaimStarts)
		}
	}
}

func TestConsumeOnceWritesCanaryProjectionBookkeeping(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-canary", "consumer-a", "canary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "4-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-4","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-4","chatId":"chat-1","recipientIds":["u1","u2"],"outboxId":"outbox-4","dispatchMode":"queued"}}`,
						},
					},
					{
						ID: "5-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-5","topic":"fanout_projection_completed","emittedAt":"2026-04-15T00:00:01Z","partitionKey":"chat-1","payload":{"messageId":"msg-4","chatId":"chat-1","outboxId":"outbox-4","chunkIndex":0,"projection":{"recipientCount":2,"chunkCount":1}}}`,
						},
					},
				},
			},
		},
	}
	consumer := New(client, config.Config{
		StreamKey:               "chat:delivery:bus:v1",
		DLQStreamKey:            "chat:delivery:bus:dlq:v1",
		CanaryStreamKey:         "chat:delivery:canary:v1",
		ConsumerGroup:           "go-canary",
		ConsumerName:            "consumer-a",
		ExecutionMode:           "canary",
		MaxRecipientsPerChunk:   10,
		CanaryMismatchThreshold: 1,
		CanaryDLQThreshold:      1,
		BlockDuration:           time.Second,
		ReadCount:               10,
		DryRun:                  false,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.CanaryExecutions != 1 || snapshot.CanarySucceeded != 1 {
		t.Fatalf("expected successful canary execution, got %#v", snapshot)
	}
	if len(client.xaddRecords) != 1 {
		t.Fatalf("expected one canary stream write, got %#v", client.xaddRecords)
	}
	if client.xaddRecords[0].stream != "chat:delivery:canary:v1" {
		t.Fatalf("expected canary stream write, got %s", client.xaddRecords[0].stream)
	}
	if client.xaddRecords[0].values["segment"] != "projection_bookkeeping" {
		t.Fatalf("expected projection bookkeeping segment, got %#v", client.xaddRecords[0].values)
	}
}

func TestConsumeOnceExecutesEligiblePrimaryFanout(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "6-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-6","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-6","chatId":"chat-1","chatType":"private","seq":6,"senderId":"u1","recipientIds":["u1","u2"],"recipientCount":2,"outboxId":"outbox-6","dispatchMode":"go_primary"}}`,
						},
					},
				},
			},
		},
	}
	primaryExecutor := &fakePrimaryExecutor{
		result: primary.ExecutionResult{
			OutboxID:        "outbox-6",
			RecipientCount:  2,
			ProjectionCount: 1,
		},
	}
	consumer := NewWithDeps(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		ConsumerGroup:         "go-primary",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "primary",
		GoPrimaryReady:        true,
		PrimaryMaxRecipients:  2,
		PrimaryPrivateEnabled: true,
		PrimaryGroupEnabled:   false,
		MaxRecipientsPerChunk: 10,
		BlockDuration:         time.Second,
		ReadCount:             10,
		DryRun:                false,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		PrimaryExecutor: primaryExecutor,
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if primaryExecutor.calls != 1 {
		t.Fatalf("expected primary executor to be called once, got %d", primaryExecutor.calls)
	}
	if primaryExecutor.payload.MessageID != "msg-6" || primaryExecutor.payload.OutboxID != "outbox-6" {
		t.Fatalf("unexpected primary payload: %#v", primaryExecutor.payload)
	}
	snapshot := state.Snapshot()
	if snapshot.PrimaryExecutions != 1 || snapshot.PrimarySucceeded != 1 {
		t.Fatalf("expected successful primary execution, got %#v", snapshot)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "6-0" {
		t.Fatalf("expected primary message ack, got %#v", client.ackedIDs)
	}
}

func TestConsumeOnceExecutesEligibleGroupCanaryFanout(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "6-1",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-6g","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"group-1","payload":{"messageId":"msg-6g","chatId":"group-1","chatType":"group","seq":6,"senderId":"u1","recipientIds":["u1","u2","u3"],"recipientCount":3,"outboxId":"outbox-6g","dispatchMode":"go_group_canary"}}`,
						},
					},
				},
			},
		},
	}
	primaryExecutor := &fakePrimaryExecutor{
		result: primary.ExecutionResult{
			OutboxID:        "outbox-6g",
			RecipientCount:  3,
			ProjectionCount: 1,
		},
	}
	consumer := NewWithDeps(client, config.Config{
		StreamKey:                 "chat:delivery:bus:v1",
		DLQStreamKey:              "chat:delivery:bus:dlq:v1",
		ConsumerGroup:             "go-primary",
		ConsumerName:              "consumer-a",
		ExecutionMode:             "primary",
		GoPrimaryReady:            true,
		PrimaryMaxRecipients:      2,
		PrimaryGroupMaxRecipients: 4,
		PrimaryPrivateEnabled:     true,
		PrimaryGroupEnabled:       true,
		MaxRecipientsPerChunk:     10,
		BlockDuration:             time.Second,
		ReadCount:                 10,
		DryRun:                    false,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		PrimaryExecutor: primaryExecutor,
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if primaryExecutor.calls != 1 {
		t.Fatalf("expected group canary primary executor call, got %d", primaryExecutor.calls)
	}
	snapshot := state.Snapshot()
	if snapshot.PrimaryGroupExecutions != 1 || snapshot.PrimaryGroupSucceeded != 1 {
		t.Fatalf("expected group canary counters to be tracked, got %#v", snapshot)
	}
}

func TestConsumeOnceSkipsPrimaryWhenHardGateIsOff(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "7-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-7","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-7","chatId":"chat-1","chatType":"private","seq":7,"senderId":"u1","recipientIds":["u1","u2"],"recipientCount":2,"outboxId":"outbox-7","dispatchMode":"go_primary"}}`,
						},
					},
				},
			},
		},
	}
	primaryExecutor := &fakePrimaryExecutor{}
	consumer := NewWithDeps(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		ConsumerGroup:         "go-primary",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "primary",
		GoPrimaryReady:        false,
		PrimaryMaxRecipients:  2,
		PrimaryPrivateEnabled: true,
		MaxRecipientsPerChunk: 10,
		BlockDuration:         time.Second,
		ReadCount:             10,
		DryRun:                false,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		PrimaryExecutor: primaryExecutor,
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if primaryExecutor.calls != 0 {
		t.Fatalf("expected hard gate to block primary executor, got %d calls", primaryExecutor.calls)
	}
	if state.Snapshot().PrimarySkipped != 1 {
		t.Fatalf("expected primary skipped metric, got %#v", state.Snapshot())
	}
}

func TestConsumeOnceSkipsQueuedDispatchesInPrimaryMode(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "8-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-8","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-8","chatId":"chat-1","chatType":"private","seq":8,"senderId":"u1","recipientIds":["u1","u2"],"recipientCount":2,"outboxId":"outbox-8","dispatchMode":"queued"}}`,
						},
					},
				},
			},
		},
	}
	primaryExecutor := &fakePrimaryExecutor{}
	consumer := NewWithDeps(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		ConsumerGroup:         "go-primary",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "primary",
		GoPrimaryReady:        true,
		PrimaryMaxRecipients:  2,
		PrimaryPrivateEnabled: true,
		MaxRecipientsPerChunk: 10,
		BlockDuration:         time.Second,
		ReadCount:             10,
		DryRun:                false,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		PrimaryExecutor: primaryExecutor,
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if primaryExecutor.calls != 0 {
		t.Fatalf("expected queued dispatch to skip primary executor, got %d calls", primaryExecutor.calls)
	}
	snapshot := state.Snapshot()
	if snapshot.PrimarySkipped != 1 || snapshot.LastPrimarySkipReason != "dispatch_mode_not_primary" {
		t.Fatalf("expected dispatch-mode skip to be recorded, got %#v", snapshot)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "8-0" {
		t.Fatalf("expected skipped primary message ack, got %#v", client.ackedIDs)
	}
}

func TestConsumeOnceRetriesPrimaryFailuresBeforeDLQ(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "9-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-9","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-9","chatId":"chat-1","chatType":"private","seq":9,"senderId":"u1","recipientIds":["u1","u2"],"recipientCount":2,"outboxId":"outbox-9","dispatchMode":"go_primary"}}`,
						},
					},
				},
			},
		},
	}
	primaryExecutor := &fakePrimaryExecutor{
		err: context.DeadlineExceeded,
	}
	consumer := NewWithDeps(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		ConsumerGroup:         "go-primary",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "primary",
		GoPrimaryReady:        true,
		PrimaryMaxRecipients:  2,
		PrimaryMaxAttempts:    3,
		PrimaryPrivateEnabled: true,
		MaxRecipientsPerChunk: 10,
		BlockDuration:         time.Second,
		ReadCount:             10,
		DryRun:                false,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		PrimaryExecutor: primaryExecutor,
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if primaryExecutor.calls != 1 {
		t.Fatalf("expected one primary execution attempt, got %d", primaryExecutor.calls)
	}
	if len(primaryExecutor.failureRecords) != 1 {
		t.Fatalf("expected one retryable failure record, got %#v", primaryExecutor.failureRecords)
	}
	if primaryExecutor.failureRecords[0].terminal {
		t.Fatalf("expected retryable failure before terminal handoff, got %#v", primaryExecutor.failureRecords)
	}
	if len(client.xaddRecords) != 1 {
		t.Fatalf("expected one retry event write, got %#v", client.xaddRecords)
	}
	rawEvent, ok := client.xaddRecords[0].values["event"].(string)
	if !ok || rawEvent == "" {
		t.Fatalf("expected retry envelope payload, got %#v", client.xaddRecords[0].values)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "9-0" {
		t.Fatalf("expected retry origin message ack, got %#v", client.ackedIDs)
	}
	snapshot := state.Snapshot()
	if snapshot.PrimaryExecutions != 1 || snapshot.PrimaryFailed != 1 {
		t.Fatalf("expected failed primary attempt to be recorded, got %#v", snapshot)
	}
	if snapshot.PrimaryRetryQueued != 1 || snapshot.PrimaryRetryableFailures != 1 {
		t.Fatalf("expected retry metrics to be recorded, got %#v", snapshot)
	}
}

func TestConsumeOnceDispatchesPlatformSyncWake(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	state.SetPlatformStreamKey("platform:events:v1")
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "platform:events:v1",
				Messages: []redis.XMessage{
					{
						ID: "11-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"platform.event.v1","producer":"node-backend","eventId":"evt-platform-1","topic":"sync_wake_requested","emittedAt":"2026-04-16T00:00:00Z","partitionKey":"user-1","payload":{"userId":"user-1","updateId":42,"wakeChannel":"sync:update:wake:v1","source":"update_service"}}`,
						},
					},
				},
			},
		},
	}

	consumer := NewWithDeps(client, config.Config{
		StreamKey:                 "chat:delivery:bus:v1",
		PlatformStreamKey:         "platform:events:v1",
		DLQStreamKey:              "chat:delivery:bus:dlq:v1",
		PlatformDLQStreamKey:      "platform:events:dlq:v1",
		ConsumerGroup:             "go-primary",
		ConsumerName:              "consumer-a",
		ExecutionMode:             "primary",
		SyncWakeExecutionMode:     "publish",
		WakePubSubChannel:         "sync:update:wake:v1",
		PresenceExecutionMode:     "shadow",
		NotificationExecutionMode: "shadow",
		BlockDuration:             time.Second,
		ReadCount:                 10,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		Dispatcher: platform.NewDispatcher(client, config.Config{
			SyncWakeExecutionMode: "publish",
			WakePubSubChannel:     "sync:update:wake:v1",
		}),
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	snapshot := state.Snapshot()
	if snapshot.PlatformExecutions != 1 || snapshot.PlatformSucceeded != 1 {
		t.Fatalf("expected successful platform execution, got %#v", snapshot)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "11-0" {
		t.Fatalf("expected platform message ack, got %#v", client.ackedIDs)
	}
	if len(client.xaddRecords) != 1 || client.xaddRecords[0].stream != "pubsub:sync:update:wake:v1" {
		t.Fatalf("expected sync wake publish, got %#v", client.xaddRecords)
	}
}

func TestConsumeOnceWritesPlatformPoisonMessagesToPlatformDLQ(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	state.SetPlatformStreamKey("platform:events:v1")
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "platform:events:v1",
				Messages: []redis.XMessage{
					{
						ID: "12-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"platform.event.v1","producer":"node-backend","eventId":"evt-platform-2","topic":"sync_wake_requested","emittedAt":"2026-04-16T00:00:00Z","partitionKey":"user-1","payload":{"userId":"","updateId":0}}`,
						},
					},
				},
			},
		},
	}

	consumer := NewWithDeps(client, config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		PlatformStreamKey:     "platform:events:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		PlatformDLQStreamKey:  "platform:events:dlq:v1",
		ConsumerGroup:         "go-primary",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "primary",
		SyncWakeExecutionMode: "publish",
		WakePubSubChannel:     "sync:update:wake:v1",
		BlockDuration:         time.Second,
		ReadCount:             10,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		Dispatcher: platform.NewDispatcher(client, config.Config{
			SyncWakeExecutionMode: "publish",
			WakePubSubChannel:     "sync:update:wake:v1",
		}),
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}

	if len(client.xaddRecords) != 1 || client.xaddRecords[0].stream != "platform:events:dlq:v1" {
		t.Fatalf("expected platform dlq write, got %#v", client.xaddRecords)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "12-0" {
		t.Fatalf("expected platform poison ack, got %#v", client.ackedIDs)
	}
}
