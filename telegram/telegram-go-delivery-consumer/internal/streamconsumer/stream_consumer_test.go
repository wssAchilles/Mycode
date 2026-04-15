package streamconsumer

import (
	"context"
	"io"
	"log"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type fakeStreamClient struct {
	groupCreated bool
	ackedIDs     []string
	xaddRecords  []fakeXAddRecord
	streams      []redis.XStream
}

type fakeXAddRecord struct {
	stream string
	values map[string]interface{}
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

func (f *fakeStreamClient) XAck(_ context.Context, _ string, _ string, ids ...string) *redis.IntCmd {
	f.ackedIDs = append(f.ackedIDs, ids...)
	cmd := redis.NewIntCmd(context.Background())
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
