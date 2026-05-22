package streamconsumer

import (
	"context"
	"sync"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/heat"
)

type DispatchConfig struct {
	MaxConcurrency int
}

func DefaultDispatchConfig() DispatchConfig {
	return DispatchConfig{
		MaxConcurrency: 8,
	}
}

type MessageDispatcher struct {
	cfg      DispatchConfig
	handler  func(ctx context.Context, streamKey string, message redis.XMessage) error
	onError  func(ctx context.Context, err error, messageID string)
	detector *heat.Detector
	scorer   *heat.Scorer
	selector *heat.Selector
}

func NewMessageDispatcher(
	cfg DispatchConfig,
	handler func(ctx context.Context, streamKey string, message redis.XMessage) error,
	onError func(ctx context.Context, err error, messageID string),
	detector *heat.Detector,
	scorer *heat.Scorer,
	selector *heat.Selector,
) *MessageDispatcher {
	return &MessageDispatcher{
		cfg:      cfg,
		handler:  handler,
		onError:  onError,
		detector: detector,
		scorer:   scorer,
		selector: selector,
	}
}

type DispatchResult struct {
	TotalMessages int
	Parallel      int
	Sequential    int
	Errors        int
}

// Dispatch processes messages. Uses sequential processing to maintain message ordering.
func (d *MessageDispatcher) Dispatch(ctx context.Context, streams []redis.XStream) DispatchResult {
	result := DispatchResult{}

	for _, stream := range streams {
		for _, msg := range stream.Messages {
			result.TotalMessages++

			if err := d.handler(ctx, stream.Stream, msg); err != nil {
				d.onError(ctx, err, msg.ID)
				result.Errors++
			} else {
				result.Sequential++
			}
		}
	}

	return result
}

// DispatchParallel processes messages concurrently (for hot groups where ordering is less critical).
func (d *MessageDispatcher) DispatchParallel(ctx context.Context, streams []redis.XStream) DispatchResult {
	result := DispatchResult{}
	grouped := groupMessagesByStream(streams)

	for streamKey, messages := range grouped {
		if len(messages) == 0 {
			continue
		}
		result.TotalMessages += len(messages)
		dispatched := d.dispatchParallel(ctx, streamKey, messages)
		result.Parallel += dispatched.ok
		result.Errors += dispatched.errors
	}

	return result
}

type dispatchCounts struct {
	ok     int
	errors int
}

func (d *MessageDispatcher) dispatchParallel(ctx context.Context, streamKey string, messages []redis.XMessage) dispatchCounts {
	var (
		wg      sync.WaitGroup
		sem     = make(chan struct{}, d.cfg.MaxConcurrency)
		okCount int
		errCount int
		mu      sync.Mutex
	)

	for _, msg := range messages {
		wg.Add(1)
		sem <- struct{}{}

		go func(sk string, m redis.XMessage) {
			defer wg.Done()
			defer func() { <-sem }()

			if err := d.handler(ctx, sk, m); err != nil {
				d.onError(ctx, err, m.ID)
				mu.Lock()
				errCount++
				mu.Unlock()
			} else {
				mu.Lock()
				okCount++
				mu.Unlock()
			}
		}(streamKey, msg)
	}

	wg.Wait()
	return dispatchCounts{ok: okCount, errors: errCount}
}

func groupMessagesByStream(streams []redis.XStream) map[string][]redis.XMessage {
	grouped := make(map[string][]redis.XMessage, len(streams))
	for _, stream := range streams {
		grouped[stream.Stream] = append(grouped[stream.Stream], stream.Messages...)
	}
	return grouped
}
