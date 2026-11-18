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

// TrimStreams 按默认阈值近似裁剪指定的所有 Redis Stream。
func (t *StreamTrimmer) TrimStreams(ctx context.Context, streamKeys []string) error {
	return t.TrimStreamsWithMaxLen(ctx, streamKeys, t.threshold)
}

// TrimStreamsWithMaxLen 按给定的近似上限裁剪指定 Redis Stream 列表。
func (t *StreamTrimmer) TrimStreamsWithMaxLen(ctx context.Context, streamKeys []string, maxLen int64) error {
	if maxLen <= 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(streamKeys))
	for _, key := range streamKeys {
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		if err := t.trimStreamWithMaxLen(ctx, key, maxLen); err != nil {
			return fmt.Errorf("trim stream %s: %w", key, err)
		}
	}
	return nil
}

func (t *StreamTrimmer) trimStream(ctx context.Context, streamKey string) error {
	return t.trimStreamWithMaxLen(ctx, streamKey, t.threshold)
}

func (t *StreamTrimmer) trimStreamWithMaxLen(ctx context.Context, streamKey string, maxLen int64) error {
	trimmed, err := t.client.XTrimMaxLenApprox(ctx, streamKey, maxLen, 0).Result()
	if err != nil {
		return fmt.Errorf("xtrim %s: %w", streamKey, err)
	}
	if trimmed > 0 {
		t.logger.Printf("trimmed %d entries from stream %s (threshold=%d)", trimmed, streamKey, maxLen)
	}
	if t.recorder != nil {
		t.recorder.RecordTrim(streamKey)
	}
	return nil
}
