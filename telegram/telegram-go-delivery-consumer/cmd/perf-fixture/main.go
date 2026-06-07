package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer"
)

type metricRow struct {
	Name            string `json:"name"`
	Iterations      int    `json:"iterations"`
	RequestCount    int    `json:"requestCount"`
	BatchSize       int    `json:"batchSize"`
	QueueDepth      int    `json:"queueDepth"`
	P50US           int64  `json:"p50Us"`
	P95US           int64  `json:"p95Us"`
	P99US           int64  `json:"p99Us"`
	Timeouts        int    `json:"timeouts"`
	Fallback        bool   `json:"fallback"`
	BudgetExhausted bool   `json:"budgetExhausted"`
	CacheHit        *int   `json:"cacheHit"`
	CacheMiss       *int   `json:"cacheMiss"`
	AckCount        int    `json:"ackCount"`
	WorkerLaneCount int    `json:"workerLaneCount"`
}

type payload struct {
	SchemaVersion string      `json:"schemaVersion"`
	Service       string      `json:"service"`
	Suite         string      `json:"suite"`
	Summary       metricRow   `json:"summary"`
	Results       []metricRow `json:"results"`
}

func main() {
	iterations := flag.Int("iterations", 200, "number of dispatch iterations")
	messages := flag.Int("messages", 4096, "messages per dispatch")
	workers := flag.Int("workers", 8, "keyed worker lanes")
	ackBatchSize := flag.Int("ack-batch-size", 128, "ack batch size reported by the fixture")
	flag.Parse()

	streams := buildStreams(*messages)
	dispatcher := streamconsumer.NewMessageDispatcher(
		streamconsumer.DispatchConfig{WorkerCount: *workers},
		func(_ context.Context, streamKey string, message redis.XMessage) (streamconsumer.MessageResult, error) {
			return streamconsumer.MessageResult{
				Disposition: streamconsumer.DispositionAck,
				Ack: streamconsumer.AckRequest{
					StreamKey: streamKey,
					MessageID: message.ID,
				},
			}, nil
		},
		func(context.Context, error, string) {},
	)

	samples := make([]int64, 0, *iterations)
	ackCount := 0
	for i := 0; i < *iterations; i++ {
		started := time.Now()
		result := dispatcher.Dispatch(context.Background(), streams)
		elapsed := time.Since(started).Microseconds()
		samples = append(samples, elapsed)
		ackCount = result.Successes
		if result.Errors > 0 {
			fmt.Fprintf(os.Stderr, "dispatch returned %d errors\n", result.Errors)
			os.Exit(1)
		}
	}

	row := metricRow{
		Name:            "keyed_dispatch_batch_ack",
		Iterations:      *iterations,
		RequestCount:    *iterations * *messages,
		BatchSize:       *ackBatchSize,
		QueueDepth:      *workers,
		P50US:           percentile(samples, 50),
		P95US:           percentile(samples, 95),
		P99US:           percentile(samples, 99),
		Timeouts:        0,
		Fallback:        false,
		BudgetExhausted: false,
		AckCount:        ackCount,
		WorkerLaneCount: *workers,
	}
	out := payload{
		SchemaVersion: "telegram_perf_fixture_v1",
		Service:       "go_delivery",
		Suite:         "delivery_consumer_local_hot_path",
		Summary:       row,
		Results:       []metricRow{row},
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "encode perf fixture: %v\n", err)
		os.Exit(1)
	}
}

func buildStreams(messages int) []redis.XStream {
	stream := redis.XStream{Stream: "chat:delivery:bus:v1"}
	stream.Messages = make([]redis.XMessage, 0, messages)
	for i := 0; i < messages; i++ {
		chatID := i % 512
		stream.Messages = append(stream.Messages, redis.XMessage{
			ID: fmt.Sprintf("%d-0", i+1),
			Values: map[string]any{
				"event": fmt.Sprintf(`{"payload":{"chatId":"chat-%d","messageId":"msg-%d"}}`, chatID, i),
			},
		})
	}
	return []redis.XStream{stream}
}

func percentile(values []int64, pct int) int64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})
	index := ((len(sorted) - 1) * pct) / 100
	return sorted[index]
}
