package streamconsumer

import (
	"context"
	"fmt"
	"log"
)

// StreamTrimmer periodically trims Redis streams to prevent unbounded memory growth.
// Uses approximate trimming (MAXLEN ~) for better performance.
type StreamTrimmer struct {
	client    StreamClient
	threshold int64
	logger    *log.Logger
	recorder  TrimRecorder
}

// TrimRecorder records trimming events for observability.
type TrimRecorder interface {
	RecordTrim(streamKey string)
}

// NewStreamTrimmer creates a new trimmer with the given threshold.
func NewStreamTrimmer(client StreamClient, threshold int64, logger *log.Logger, recorder TrimRecorder) *StreamTrimmer {
	return &StreamTrimmer{
		client:    client,
		threshold: threshold,
		logger:    logger,
		recorder:  recorder,
	}
}

// TrimStreams trims all specified streams to the configured threshold.
// Uses XTRIM MAXLEN ~ threshold (approximate trimming) for better performance.
func (t *StreamTrimmer) TrimStreams(ctx context.Context, streamKeys []string) error {
	for _, key := range streamKeys {
		if err := t.trimStream(ctx, key); err != nil {
			return fmt.Errorf("trim stream %s: %w", key, err)
		}
	}
	return nil
}

func (t *StreamTrimmer) trimStream(ctx context.Context, streamKey string) error {
	trimmed, err := t.client.XTrimMaxLenApprox(ctx, streamKey, t.threshold, 0).Result()
	if err != nil {
		return fmt.Errorf("xtrim %s: %w", streamKey, err)
	}
	if trimmed > 0 {
		t.logger.Printf("trimmed %d entries from stream %s (threshold=%d)", trimmed, streamKey, t.threshold)
	}
	if t.recorder != nil {
		t.recorder.RecordTrim(streamKey)
	}
	return nil
}
