package reclaim

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	redis "github.com/redis/go-redis/v9"
)

const DefaultMaxBatches = 4

type Client interface {
	XAutoClaim(ctx context.Context, a *redis.XAutoClaimArgs) *redis.XAutoClaimCmd
}

type Handler func(ctx context.Context, streamKey string, message redis.XMessage) error

type Recorder interface {
	DeadLetterCount() int
	RecordError(message string)
	RecordPendingReclaimDuration(
		streamKey string,
		claimed int,
		poison int,
		ackFailures int,
		lastCursor string,
		duration time.Duration,
	)
}

type ScannerConfig struct {
	ConsumerGroup string
	ConsumerName  string
	MinIdle       time.Duration
	ClaimCount    int64
	MaxBatches    int
	CursorMode    string
}

type Scanner struct {
	Client   Client
	Handler  Handler
	Recorder Recorder
	Cursors  *CursorTracker
	Logger   *log.Logger
	Config   ScannerConfig
}

func (s Scanner) ScanStream(ctx context.Context, streamKey string) error {
	start := StartCursor
	if s.Config.CursorMode != "restart" {
		start = s.Cursors.Start(streamKey)
	}

	maxBatches := s.Config.MaxBatches
	if maxBatches <= 0 {
		maxBatches = DefaultMaxBatches
	}

	for batch := 0; batch < maxBatches; batch++ {
		nextStart, shouldContinue, err := s.scanBatch(ctx, streamKey, start)
		if err != nil {
			return err
		}
		if !shouldContinue {
			return nil
		}
		start = nextStart
	}
	return nil
}

func (s Scanner) scanBatch(ctx context.Context, streamKey string, start string) (string, bool, error) {
	batchStarted := time.Now()
	messages, nextStart, err := s.Client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   streamKey,
		Group:    s.Config.ConsumerGroup,
		Consumer: s.Config.ConsumerName,
		MinIdle:  s.Config.MinIdle,
		Start:    start,
		Count:    s.Config.ClaimCount,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			s.record(streamKey, 0, 0, 0, start, time.Since(batchStarted))
			return start, false, nil
		}
		return start, false, fmt.Errorf("autoclaim pending stream messages for %s: %w", streamKey, err)
	}

	poisonCount, ackFailures := s.handleClaimed(ctx, streamKey, messages)
	s.Cursors.Record(streamKey, nextStart)
	s.record(streamKey, len(messages), poisonCount, ackFailures, nextStart, time.Since(batchStarted))

	if nextStart == StartCursor || nextStart == "" {
		return nextStart, false, nil
	}
	return nextStart, true, nil
}

func (s Scanner) handleClaimed(ctx context.Context, streamKey string, messages []redis.XMessage) (int, int) {
	poisonCount := 0
	ackFailures := 0
	for _, message := range messages {
		deadLettersBefore := s.deadLetterCount()
		if err := s.Handler(ctx, streamKey, message); err != nil {
			if IsAckError(err) {
				ackFailures++
			}
			s.recordError(err.Error())
			if s.Logger != nil {
				s.Logger.Printf("handle pending message %s failed: %v", message.ID, err)
			}
		}
		deadLettersAfter := s.deadLetterCount()
		if deadLettersAfter > deadLettersBefore {
			poisonCount += deadLettersAfter - deadLettersBefore
		}
	}
	return poisonCount, ackFailures
}

func (s Scanner) deadLetterCount() int {
	if s.Recorder == nil {
		return 0
	}
	return s.Recorder.DeadLetterCount()
}

func (s Scanner) recordError(message string) {
	if s.Recorder == nil {
		return
	}
	s.Recorder.RecordError(message)
}

func (s Scanner) record(
	streamKey string,
	claimed int,
	poison int,
	ackFailures int,
	lastCursor string,
	duration time.Duration,
) {
	if s.Recorder == nil {
		return
	}
	s.Recorder.RecordPendingReclaimDuration(streamKey, claimed, poison, ackFailures, lastCursor, duration)
}
