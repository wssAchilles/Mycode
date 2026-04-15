package canary

import (
	"context"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

type StreamClient interface {
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
}

type ProjectionBookkeepingRecord struct {
	SourceMessageID string
	Envelope        contracts.DeliveryEventEnvelope
	Payload         contracts.ProjectionPayload
	Matched         bool
	Reason          string
}

type Writer struct {
	client    StreamClient
	streamKey string
}

func New(client StreamClient, streamKey string) *Writer {
	return &Writer{
		client:    client,
		streamKey: streamKey,
	}
}

func (w *Writer) WriteProjectionBookkeeping(
	ctx context.Context,
	record ProjectionBookkeepingRecord,
) (string, error) {
	result := "matched"
	if !record.Matched {
		result = "mismatch"
	}

	eventID, err := w.client.XAdd(ctx, &redis.XAddArgs{
		Stream: w.streamKey,
		Values: map[string]interface{}{
			"source_message_id": record.SourceMessageID,
			"source_event_id":   record.Envelope.EventID,
			"segment":           "projection_bookkeeping",
			"result":            result,
			"message_id":        record.Payload.MessageID,
			"chat_id":           record.Payload.ChatID,
			"outbox_id":         record.Payload.OutboxID,
			"chunk_index":       record.Payload.ChunkIndex,
			"recipient_count":   record.Payload.ProjectionRecipientCount(),
			"chunk_count":       record.Payload.ProjectionChunkCount(),
			"reason":            record.Reason,
			"recorded_at":       time.Now().UTC().Format(time.RFC3339Nano),
		},
	}).Result()
	if err != nil {
		return "", fmt.Errorf("write canary projection bookkeeping: %w", err)
	}
	return eventID, nil
}
