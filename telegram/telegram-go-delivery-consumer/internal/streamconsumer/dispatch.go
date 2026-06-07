package streamconsumer

import (
	"context"
	"hash/fnv"
	"sync"

	redis "github.com/redis/go-redis/v9"
)

type DispatchConfig struct {
	WorkerCount int
}

func DefaultDispatchConfig() DispatchConfig {
	return DispatchConfig{
		WorkerCount: 1,
	}
}

type MessageDisposition int

const (
	DispositionNoAck MessageDisposition = iota
	DispositionAck
)

type MessageResult struct {
	Disposition MessageDisposition
	Ack         AckRequest
}

type MessageDispatcher struct {
	cfg     DispatchConfig
	handler func(ctx context.Context, streamKey string, message redis.XMessage) (MessageResult, error)
	onError func(ctx context.Context, err error, messageID string)
}

func NewMessageDispatcher(
	cfg DispatchConfig,
	handler func(ctx context.Context, streamKey string, message redis.XMessage) (MessageResult, error),
	onError func(ctx context.Context, err error, messageID string),
) *MessageDispatcher {
	if cfg.WorkerCount <= 0 {
		cfg.WorkerCount = 1
	}
	return &MessageDispatcher{
		cfg:     cfg,
		handler: handler,
		onError: onError,
	}
}

type DispatchResult struct {
	TotalMessages int
	Successes     int
	Sequential    int
	Errors        int
	Acks          []AckRequest
}

func (d *MessageDispatcher) Dispatch(ctx context.Context, streams []redis.XStream) DispatchResult {
	type queuedMessage struct {
		streamKey string
		message   redis.XMessage
	}
	type workerResult struct {
		result MessageResult
		err    error
		id     string
	}

	var (
		wg      sync.WaitGroup
		results = make(chan workerResult, countMessages(streams))
		lanes   = make([]chan queuedMessage, d.cfg.WorkerCount)
	)

	for i := range lanes {
		lanes[i] = make(chan queuedMessage, 1)
		wg.Add(1)
		go func(ch <-chan queuedMessage) {
			defer wg.Done()
			for item := range ch {
				res, err := d.handler(ctx, item.streamKey, item.message)
				results <- workerResult{result: res, err: err, id: item.message.ID}
			}
		}(lanes[i])
	}

	total := 0
	for _, stream := range streams {
		for _, msg := range stream.Messages {
			total++
			lane := keyedLaneIndex(messageLaneKey(stream.Stream, msg), d.cfg.WorkerCount)
			lanes[lane] <- queuedMessage{streamKey: stream.Stream, message: msg}
		}
	}
	for _, lane := range lanes {
		close(lane)
	}
	wg.Wait()
	close(results)

	result := DispatchResult{TotalMessages: total}
	for item := range results {
		if item.err != nil {
			d.onError(ctx, item.err, item.id)
			result.Errors++
			continue
		}
		result.Successes++
		if item.result.Disposition == DispositionAck {
			result.Acks = append(result.Acks, item.result.Ack)
		}
	}
	if d.cfg.WorkerCount == 1 {
		result.Sequential = result.Successes
	}
	return result
}

func keyedLaneIndex(key string, workers int) int {
	if workers <= 1 {
		return 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return int(h.Sum32() % uint32(workers))
}

func countMessages(streams []redis.XStream) int {
	total := 0
	for _, stream := range streams {
		total += len(stream.Messages)
	}
	return total
}
