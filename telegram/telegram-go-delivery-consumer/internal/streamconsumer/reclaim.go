package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"

	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
)

const defaultPendingReclaimMaxBatches = 4

func (c *StreamConsumer) reclaimPendingIfDue(ctx context.Context) error {
	if c.cfg.PendingIdleDuration <= 0 || c.cfg.PendingClaimInterval <= 0 || c.cfg.PendingClaimCount <= 0 {
		return nil
	}
	now := time.Now()
	if !c.lastPendingClaim.IsZero() && now.Sub(c.lastPendingClaim) < c.cfg.PendingClaimInterval {
		return nil
	}

	for _, streamKey := range c.streamKeys() {
		if err := c.reclaimPendingStream(ctx, streamKey); err != nil {
			return err
		}
	}
	c.lastPendingClaim = now
	return nil
}

func (c *StreamConsumer) reclaimPendingStream(ctx context.Context, streamKey string) error {
	start := reclaimstate.StartCursor
	if c.cfg.ReclaimCursorMode != "restart" {
		start = c.reclaimCursors.Start(streamKey)
	}
	maxBatches := c.cfg.PendingReclaimMaxBatches
	if maxBatches <= 0 {
		maxBatches = defaultPendingReclaimMaxBatches
	}

	for batch := 0; batch < maxBatches; batch++ {
		batchStarted := time.Now()
		messages, nextStart, err := c.client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
			Stream:   streamKey,
			Group:    c.cfg.ConsumerGroup,
			Consumer: c.cfg.ConsumerName,
			MinIdle:  c.cfg.PendingIdleDuration,
			Start:    start,
			Count:    c.cfg.PendingClaimCount,
		}).Result()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				c.state.RecordPendingReclaimDuration(streamKey, 0, 0, 0, start, time.Since(batchStarted))
				return nil
			}
			return fmt.Errorf("autoclaim pending stream messages for %s: %w", streamKey, err)
		}

		poisonCount := 0
		ackFailures := 0
		for _, message := range messages {
			deadLettersBefore := c.state.Snapshot().DeadLetters
			if err := c.handleMessage(ctx, streamKey, message); err != nil {
				if reclaimstate.IsAckError(err) {
					ackFailures++
				}
				c.state.RecordError(err.Error())
				c.logger.Printf("handle pending message %s failed: %v", message.ID, err)
			}
			deadLettersAfter := c.state.Snapshot().DeadLetters
			if deadLettersAfter > deadLettersBefore {
				poisonCount += deadLettersAfter - deadLettersBefore
			}
		}
		c.reclaimCursors.Record(streamKey, nextStart)
		c.state.RecordPendingReclaimDuration(streamKey, len(messages), poisonCount, ackFailures, nextStart, time.Since(batchStarted))

		if nextStart == reclaimstate.StartCursor || nextStart == "" {
			return nil
		}
		start = nextStart
	}
	return nil
}
