package wake

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"
)

type RepairStreamClient interface {
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
}

type RepairPayload struct {
	OutboxID     string    `json:"outboxID"`
	ChunkIndex   int       `json:"chunkIndex"`
	RecipientIDs []string  `json:"recipientIDs"`
	Reason       string    `json:"reason"`
	RecordedAt   time.Time `json:"recordedAt"`
}

type RepairWriter struct {
	client    RepairStreamClient
	streamKey string
}

func NewRepairWriter(client RepairStreamClient, streamKey string) *RepairWriter {
	return &RepairWriter{client: client, streamKey: streamKey}
}

func (w *RepairWriter) Write(ctx context.Context, payload RepairPayload) error {
	if w == nil || w.client == nil || w.streamKey == "" {
		return nil
	}
	if payload.RecordedAt.IsZero() {
		payload.RecordedAt = time.Now().UTC()
	}
	recipientIDs, err := json.Marshal(payload.RecipientIDs)
	if err != nil {
		return fmt.Errorf("encode wake repair recipients: %w", err)
	}
	_, err = w.client.XAdd(ctx, &redis.XAddArgs{
		Stream: w.streamKey,
		Values: map[string]interface{}{
			"outbox_id":     payload.OutboxID,
			"chunk_index":   payload.ChunkIndex,
			"recipient_ids": string(recipientIDs),
			"reason":        payload.Reason,
			"recorded_at":   payload.RecordedAt.Format(time.RFC3339Nano),
		},
	}).Result()
	if err != nil {
		return fmt.Errorf("write wake repair: %w", err)
	}
	return nil
}
