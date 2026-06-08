package dlq

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

func (w *Writer) Write(ctx context.Context, message redis.XMessage, reason string) error {
	rawEvent, _ := contracts.RawEvent(message)
	return w.write(ctx, message.ID, reason, rawEvent, nil)
}

func (w *Writer) WritePrimaryFailure(ctx context.Context, sourceMessageID string, reason string, metadata map[string]interface{}) error {
	return w.write(ctx, sourceMessageID, reason, "", metadata)
}

func (w *Writer) write(ctx context.Context, sourceMessageID string, reason string, rawEvent string, metadata map[string]interface{}) error {
	values := map[string]interface{}{
		"source_message_id": sourceMessageID,
		"reason":            reason,
		"event":             rawEvent,
		"recorded_at":       time.Now().UTC().Format(time.RFC3339Nano),
	}
	for key, value := range metadata {
		values[key] = value
	}
	_, err := w.client.XAdd(ctx, &redis.XAddArgs{
		Stream: w.streamKey,
		Values: values,
	}).Result()
	if err != nil {
		return fmt.Errorf("write dlq entry: %w", err)
	}
	return nil
}
