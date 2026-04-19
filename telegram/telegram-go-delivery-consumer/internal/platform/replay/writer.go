package replay

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"

	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
)

type StreamClient interface {
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
}

type Writer struct {
	client    StreamClient
	streamKey string
}

func New(client StreamClient, streamKey string) *Writer {
	if client == nil || streamKey == "" {
		return nil
	}
	return &Writer{
		client:    client,
		streamKey: streamKey,
	}
}

func (w *Writer) Write(
	ctx context.Context,
	envelope buscontracts.PlatformEventEnvelope,
	result platformcontracts.DispatchResult,
) (platformcontracts.ReplayRecord, error) {
	body, err := json.Marshal(envelope)
	if err != nil {
		return platformcontracts.ReplayRecord{}, fmt.Errorf("marshal platform replay envelope: %w", err)
	}

	id, err := w.client.XAdd(ctx, &redis.XAddArgs{
		Stream: w.streamKey,
		Values: map[string]interface{}{
			"event_id":     envelope.EventID,
			"topic":        envelope.Topic,
			"status":       replayStatus(result),
			"reason":       result.Reason,
			"channel":      result.Channel,
			"lag_ms":       result.LagMillis,
			"attempt":      replayAttempt(result),
			"replay_kind":  replayKind(result),
			"event":        string(body),
			"recorded_at":  time.Now().UTC().Format(time.RFC3339Nano),
			"partitionKey": envelope.PartitionKey,
		},
	}).Result()
	if err != nil {
		return platformcontracts.ReplayRecord{}, fmt.Errorf("write platform replay entry: %w", err)
	}

	return platformcontracts.ReplayRecord{
		Stream:       w.streamKey,
		ID:           id,
		Topic:        envelope.Topic,
		EventID:      envelope.EventID,
		Status:       replayStatus(result),
		ReplayKind:   replayKind(result),
		Attempt:      replayAttempt(result),
		PartitionKey: envelope.PartitionKey,
	}, nil
}

func replayStatus(result platformcontracts.DispatchResult) string {
	status := platformcontracts.ReplayStatusForResult(result)
	if status != "" {
		return status
	}
	return platformcontracts.ReplayStatusFailed
}

func replayKind(result platformcontracts.DispatchResult) string {
	if result.ReplayKind != "" {
		return result.ReplayKind
	}
	return platformcontracts.ReplayKindAutomaticFallback
}

func replayAttempt(result platformcontracts.DispatchResult) int {
	if result.Attempt > 0 {
		return result.Attempt
	}
	return 1
}
