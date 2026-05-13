package streamconsumer

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func TestRedisIntegrationAutoClaimsAndAcksPendingMessage(t *testing.T) {
	redisURL := os.Getenv("DELIVERY_CONSUMER_REDIS_INTEGRATION_URL")
	if redisURL == "" {
		t.Skip("set DELIVERY_CONSUMER_REDIS_INTEGRATION_URL to run Redis integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis URL: %v", err)
	}
	client := redis.NewClient(options)
	t.Cleanup(func() {
		_ = client.Close()
	})
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping redis: %v", err)
	}

	suffix := time.Now().UnixNano()
	streamKey := fmt.Sprintf("test:delivery:stream:%d", suffix)
	dlqKey := fmt.Sprintf("test:delivery:dlq:%d", suffix)
	group := fmt.Sprintf("test-group-%d", suffix)
	staleConsumer := "stale-consumer"
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cleanupCancel()
		_ = client.Del(cleanupCtx, streamKey, dlqKey).Err()
	})

	if err := client.XGroupCreateMkStream(ctx, streamKey, group, "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}
	messageID, err := client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]interface{}{
			"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-redis-1","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-redis-1"}}`,
		},
	}).Result()
	if err != nil {
		t.Fatalf("add stream message: %v", err)
	}
	streams, err := client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: staleConsumer,
		Streams:  []string{streamKey, ">"},
		Count:    1,
		Block:    time.Second,
	}).Result()
	if err != nil {
		t.Fatalf("seed pending message: %v", err)
	}
	if len(streams) != 1 || len(streams[0].Messages) != 1 || streams[0].Messages[0].ID != messageID {
		t.Fatalf("unexpected seeded pending message: %#v", streams)
	}
	pendingBefore, err := client.XPending(ctx, streamKey, group).Result()
	if err != nil {
		t.Fatalf("inspect pending before reclaim: %v", err)
	}
	if pendingBefore.Count != 1 {
		t.Fatalf("expected one pending message before reclaim, got %#v", pendingBefore)
	}

	state := summary.New(streamKey, group, "claimer", "dry-run", true)
	consumer := New(client, config.Config{
		StreamKey:                streamKey,
		DLQStreamKey:             dlqKey,
		ConsumerGroup:            group,
		ConsumerName:             "claimer",
		ExecutionMode:            "dry-run",
		ReadCount:                10,
		PendingIdleDuration:      time.Millisecond,
		PendingClaimCount:        10,
		PendingClaimInterval:     time.Hour,
		PendingReclaimMaxBatches: 2,
		PlatformReplayScanCount:  5000,
		ReservationConcurrency:   8,
		MongoInQueryChunkSize:    1000,
		DryRun:                   true,
	}, state, log.New(io.Discard, "", 0))

	if err := consumer.reclaimPendingStream(ctx, streamKey); err != nil {
		t.Fatalf("reclaim pending stream: %v", err)
	}

	pendingAfter, err := client.XPending(ctx, streamKey, group).Result()
	if err != nil {
		t.Fatalf("inspect pending after reclaim: %v", err)
	}
	if pendingAfter.Count != 0 {
		t.Fatalf("expected pending list to be empty after reclaim, got %#v", pendingAfter)
	}
	snapshot := state.Snapshot()
	if snapshot.EventsConsumed != 1 || snapshot.PendingReclaimClaimed != 1 {
		t.Fatalf("unexpected reclaim summary: %#v", snapshot)
	}
}
