package streamconsumer

import (
	"context"
	"fmt"

	redis "github.com/redis/go-redis/v9"
)

type streamAcker interface {
	XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd
}

type AckRequest struct {
	StreamKey string
	MessageID string
}

type AckAggregator struct {
	client    streamAcker
	group     string
	batchSize int
}

func NewAckAggregator(client streamAcker, group string, batchSize int) *AckAggregator {
	if batchSize <= 0 {
		batchSize = 1
	}
	return &AckAggregator{
		client:    client,
		group:     group,
		batchSize: batchSize,
	}
}

func (a *AckAggregator) Ack(ctx context.Context, requests []AckRequest) error {
	if len(requests) == 0 {
		return nil
	}

	grouped := make(map[string][]string, len(requests))
	order := make([]string, 0, len(requests))
	for _, request := range requests {
		if request.StreamKey == "" || request.MessageID == "" {
			continue
		}
		if _, exists := grouped[request.StreamKey]; !exists {
			order = append(order, request.StreamKey)
		}
		grouped[request.StreamKey] = append(grouped[request.StreamKey], request.MessageID)
	}

	for _, streamKey := range order {
		ids := grouped[streamKey]
		for start := 0; start < len(ids); start += a.batchSize {
			end := start + a.batchSize
			if end > len(ids) {
				end = len(ids)
			}
			if err := a.client.XAck(ctx, streamKey, a.group, ids[start:end]...).Err(); err != nil {
				failedID := ids[start]
				return fmt.Errorf("ack stream message %s on %s: %w", failedID, streamKey, err)
			}
		}
	}

	return nil
}
