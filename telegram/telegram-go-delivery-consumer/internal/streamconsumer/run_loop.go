package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
)

// Run starts the consumer loop. It first drains any pending entries from the PEL
// (two-phase startup), then enters the normal consume loop. When the loop exits
// (due to context cancellation or drain signal), it closes processDone to unblock
// any Drain caller.
func (c *StreamConsumer) Run(ctx context.Context) error {
	defer close(c.processDone)
	defer func() { _ = c.lifecycle.Transition(StateStopped) }()

	_ = c.lifecycle.Transition(StateConnecting)
	c.events.Emit(ConsumerEvent{Type: EventStarted, Timestamp: time.Now()})

	_ = c.lifecycle.Transition(StateEnsuringGroup)
	if err := c.ensureGroup(ctx); err != nil {
		c.events.Emit(ConsumerEvent{Type: EventFatal, Error: err, Timestamp: time.Now()})
		return err
	}
	c.events.Emit(ConsumerEvent{Type: EventGroupEnsured, Timestamp: time.Now()})

	// Phase 1: Drain own PEL entries before switching to new messages.
	_ = c.lifecycle.Transition(StateDrainingPEL)
	c.events.Emit(ConsumerEvent{Type: EventPELDrainStarted, Timestamp: time.Now()})
	if err := c.drainOwnPendingEntries(ctx); err != nil {
		c.logger.Printf("PEL drain failed (non-fatal): %v", err)
		c.events.Emit(ConsumerEvent{Type: EventError, Error: err, Timestamp: time.Now()})
	}
	c.events.Emit(ConsumerEvent{Type: EventPELDrainCompleted, Timestamp: time.Now()})

	// Phase 2: Normal consumption of new messages.
	_ = c.lifecycle.Transition(StateRunning)
	c.events.Emit(ConsumerEvent{Type: EventRunning, Timestamp: time.Now()})
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if c.draining.Load() {
			c.logger.Println("drain signal received, stopping consume loop")
			return nil
		}
		if err := c.ConsumeOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			c.applyRecovery(ctx, err, "")
			c.logger.Printf("consume iteration failed: %v", err)
		}
	}
}

// drainOwnPendingEntries reads and processes all messages that were delivered to this
// consumer but not yet acknowledged (PEL entries). This prevents message loss when
// the consumer restarts after a crash. Uses XREADGROUP with "0" to read own pending
// messages, then processes them through the normal handler pipeline.
func (c *StreamConsumer) drainOwnPendingEntries(ctx context.Context) error {
	totalDrained := 0
	for _, streamKey := range c.streamKeys() {
		drained, err := c.drainStreamPending(ctx, streamKey)
		if err != nil {
			return fmt.Errorf("drain PEL for %s: %w", streamKey, err)
		}
		totalDrained += drained
	}
	if totalDrained > 0 {
		c.logger.Printf("PEL drain complete: %d pending messages processed", totalDrained)
		c.state.RecordPelDrain(totalDrained)
	}
	return nil
}

// drainStreamPending drains pending entries for a single stream.
// Loops until no more PEL messages are available.
func (c *StreamConsumer) drainStreamPending(ctx context.Context, streamKey string) (int, error) {
	drained := 0
	for {
		if ctx.Err() != nil {
			return drained, ctx.Err()
		}

		streams, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    c.cfg.ConsumerGroup,
			Consumer: c.cfg.ConsumerName,
			Streams:  []string{streamKey, "0"},
			Count:    c.cfg.ReadCount,
			Block:    c.cfg.BlockDuration,
			NoAck:    false,
		}).Result()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				return drained, nil
			}
			return drained, err
		}

		batchCount := 0
		for _, stream := range streams {
			for _, message := range stream.Messages {
				if err := c.handleMessage(ctx, streamKey, message); err != nil {
					c.applyRecovery(ctx, err, message.ID)
					c.logger.Printf("PEL drain: handle message %s failed: %v", message.ID, err)
				}
				batchCount++
			}
		}

		drained += batchCount

		// If we got fewer messages than ReadCount, the PEL is empty for this consumer.
		if batchCount < int(c.cfg.ReadCount) {
			return drained, nil
		}
	}
}

// ConsumeOnce performs a single consumption cycle: reclaim pending messages,
// read new messages, process them, and optionally trim streams.
func (c *StreamConsumer) ConsumeOnce(ctx context.Context) error {
	if err := c.reclaimPendingIfDue(ctx); err != nil {
		return err
	}

	streams, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    c.cfg.ConsumerGroup,
		Consumer: c.cfg.ConsumerName,
		Streams: []string{
			c.cfg.StreamKey,
			c.cfg.PlatformStreamKey,
			">",
			">",
		},
		Count: c.cfg.ReadCount,
		Block: c.cfg.BlockDuration,
		NoAck: false,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil
		}
		return err
	}

	result := c.msgDispatcher.Dispatch(ctx, streams)
	if result.Errors > 0 {
		c.logger.Printf("dispatch: %d/%d messages failed", result.Errors, result.TotalMessages)
	}

	// Periodic stream trimming to prevent unbounded memory growth.
	c.trimCounter++
	if c.cfg.StreamTrimInterval > 0 && c.trimCounter >= c.cfg.StreamTrimInterval {
		c.trimCounter = 0
		if err := c.trimmer.TrimStreams(ctx, c.streamKeys()); err != nil {
			c.logger.Printf("stream trim failed: %v", err)
		}
	}

	return nil
}

func (c *StreamConsumer) ensureGroup(ctx context.Context) error {
	for _, stream := range c.streamKeys() {
		err := c.client.XGroupCreateMkStream(ctx, stream, c.cfg.ConsumerGroup, "$").Err()
		if err == nil || strings.Contains(err.Error(), "BUSYGROUP") {
			continue
		}
		return fmt.Errorf("create consumer group for %s: %w", stream, err)
	}
	return nil
}

func (c *StreamConsumer) handleMessage(ctx context.Context, streamKey string, message redis.XMessage) error {
	handler := c.tracer.WrapHandler(func(ctx context.Context, sk, msgID, topic string) error {
		if sk == c.cfg.PlatformStreamKey {
			return c.handlePlatformMessage(ctx, message)
		}
		envelope, err := contracts.DecodeEnvelope(message)
		if err != nil {
			return c.handlePoisonMessage(ctx, sk, message, err)
		}

		if err := c.handleEnvelope(ctx, message, envelope); err != nil {
			return c.handlePoisonMessage(ctx, sk, message, err)
		}

		c.state.RecordConsumed(sk, envelope.Topic, msgID, envelope.EmittedAt)
		if err := c.client.XAck(ctx, sk, c.cfg.ConsumerGroup, msgID).Err(); err != nil {
			return reclaimstate.NewAckError(sk, msgID, err)
		}
		return nil
	})
	return handler(ctx, streamKey, message.ID, "")
}

func (c *StreamConsumer) handlePlatformMessage(ctx context.Context, message redis.XMessage) error {
	envelope, err := contracts.DecodePlatformEnvelope(message)
	if err != nil {
		return c.handlePoisonMessage(ctx, c.cfg.PlatformStreamKey, message, err)
	}
	if err := c.handlePlatformEnvelope(ctx, message, envelope); err != nil {
		return c.handlePoisonMessage(ctx, c.cfg.PlatformStreamKey, message, err)
	}
	c.state.RecordConsumed(c.cfg.PlatformStreamKey, envelope.Topic, message.ID, envelope.EmittedAt)
	if err := c.client.XAck(ctx, c.cfg.PlatformStreamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return reclaimstate.NewAckError(c.cfg.PlatformStreamKey, message.ID, err)
	}
	return nil
}

func (c *StreamConsumer) streamKeys() []string {
	keys := []string{c.cfg.StreamKey}
	if c.cfg.PlatformStreamKey != "" && c.cfg.PlatformStreamKey != c.cfg.StreamKey {
		keys = append(keys, c.cfg.PlatformStreamKey)
	}
	return keys
}

// applyRecovery classifies the error, looks up the recovery recipe, records the
// attempt in the ledger, and emits a structured event. It does NOT retry — the
// recipe's escalation policy determines the observable outcome (log / metric / abort).
func (c *StreamConsumer) applyRecovery(ctx context.Context, err error, messageID string) {
	scenario := ClassifyError(err)
	recipe, ok := c.recipes[scenario]
	if !ok {
		recipe = RecoveryRecipe{Scenario: scenario, MaxAttempts: 1, Escalation: EscalationLogAndContinue}
	}

	c.ledger.Record(RecoveryLedgerEntry{
		Scenario:  scenario,
		MessageID: messageID,
		Attempt:   1,
		Action:    recipe.Escalation,
		Timestamp: time.Now(),
		Error:     err.Error(),
	})

	c.state.RecordError(err.Error())
	c.events.Emit(ConsumerEvent{
		Type:      EventRecoveryAttempted,
		MessageID: messageID,
		Scenario:  scenario,
		Error:     err,
		Timestamp: time.Now(),
	})

	switch recipe.Escalation {
	case EscalationLogAndContinue:
		// already logged by caller
	case EscalationAlertHuman:
		c.logger.Printf("[ALERT] scenario=%s msg=%s err=%v — requires attention", scenario, messageID, err)
	case EscalationAbort:
		c.logger.Printf("[FATAL] scenario=%s msg=%s err=%v — aborting consumer", scenario, messageID, err)
	}
}
