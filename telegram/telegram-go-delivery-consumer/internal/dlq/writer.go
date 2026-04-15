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
	_, err := w.client.XAdd(ctx, &redis.XAddArgs{
		Stream: w.streamKey,
		Values: map[string]interface{}{
			"source_message_id": message.ID,
			"reason":            reason,
			"event":             rawEvent,
			"recorded_at":       time.Now().UTC().Format(time.RFC3339Nano),
		},
	}).Result()
	if err != nil {
		return fmt.Errorf("write dlq entry: %w", err)
	}
	return nil
}
