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
}

func (f *fakeStreamClient) XGroupCreateMkStream(_ context.Context, _ string, _ string, _ string) *redis.StatusCmd {
	f.groupCreated = true
	cmd := redis.NewStatusCmd(context.Background())
	cmd.SetVal("OK")
	return cmd
}

func (f *fakeStreamClient) XReadGroup(_ context.Context, _ *redis.XReadGroupArgs) *redis.XStreamSliceCmd {
	cmd := redis.NewXStreamSliceCmd(context.Background())
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

func TestConsumeOnceAcknowledgesMessages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", true)
	client := &fakeStreamClient{}
	consumer := New(client, config.Config{
		StreamKey:     "chat:delivery:bus:v1",
		ConsumerGroup: "go-dryrun",
		ConsumerName:  "consumer-a",
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
