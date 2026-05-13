package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	redis "github.com/redis/go-redis/v9"
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
	start := "0-0"
	maxBatches := c.cfg.PendingReclaimMaxBatches
	if maxBatches <= 0 {
		maxBatches = defaultPendingReclaimMaxBatches
	}

	for batch := 0; batch < maxBatches; batch++ {
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
				c.state.RecordPendingReclaim(streamKey, 0, 0, 0, start)
				return nil
			}
			return fmt.Errorf("autoclaim pending stream messages for %s: %w", streamKey, err)
		}

		poisonCount := 0
		ackFailures := 0
		for _, message := range messages {
			deadLettersBefore := c.state.Snapshot().DeadLetters
			if err := c.handleMessage(ctx, streamKey, message); err != nil {
				if strings.Contains(err.Error(), "ack ") {
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
		c.state.RecordPendingReclaim(streamKey, len(messages), poisonCount, ackFailures, nextStart)

		if nextStart == "0-0" || nextStart == "" {
			return nil
		}
		start = nextStart
	}
	return nil
}
