package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
)

const defaultAuxiliaryStreamMaxLen int64 = 10000

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
		c.setFatalError(err)
		c.cycleHealthy.Store(false)
		c.events.Emit(ConsumerEvent{Type: EventFatal, Error: err, Timestamp: time.Now()})
		return err
	}
	c.events.Emit(ConsumerEvent{Type: EventGroupEnsured, Timestamp: time.Now()})

	// 第一阶段：启动后先排空本实例在 PEL 中的历史未确认条目
	_ = c.lifecycle.Transition(StateDrainingPEL)
	c.events.Emit(ConsumerEvent{Type: EventPELDrainStarted, Timestamp: time.Now()})
	if err := c.drainOwnPendingEntries(ctx); err != nil {
		c.logger.Printf("PEL drain failed (non-fatal): %v", err)
		c.events.Emit(ConsumerEvent{Type: EventError, Error: err, Timestamp: time.Now()})
	}
	c.events.Emit(ConsumerEvent{Type: EventPELDrainCompleted, Timestamp: time.Now()})

	// 第二阶段：进入常规新消息消费循环
	_ = c.lifecycle.Transition(StateRunning)
	c.cycleHealthy.Store(true)
	c.events.Emit(ConsumerEvent{Type: EventRunning, Timestamp: time.Now()})
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if c.draining.Load() {
			c.logger.Println("drain signal received, stopping consume loop")
			return nil
		}
		if err := c.ConsumeOnce(ctx); err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return ctx.Err()
			}
			c.cycleHealthy.Store(false)
			c.applyRecovery(ctx, err, "")
			c.logger.Printf("consume iteration failed: %v", err)
			continue
		}
		c.cycleHealthy.Store(true)
		c.consecutiveErrors.Store(0)
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

// drainStreamPending 按递增消息 ID 游标排空单条流的 PEL 积压，防止未确认毒丸导致死循环卡死在 StateDrainingPEL。
func (c *StreamConsumer) drainStreamPending(ctx context.Context, streamKey string) (int, error) {
	drained := 0
	cursor := "0"
	for {
		if ctx.Err() != nil {
			return drained, ctx.Err()
		}

		streams, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    c.cfg.ConsumerGroup,
			Consumer: c.cfg.ConsumerName,
			Streams:  []string{streamKey, cursor},
			Count:    c.cfg.ReadCount,
			Block:    c.cfg.BlockDuration,
			NoAck:    false,
		}).Result()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				return drained, nil
			}
			if IsNoGroupError(err) {
				if groupErr := c.ensureGroupFrom(ctx, "0"); groupErr != nil {
					return drained, groupErr
				}
				return drained, nil
			}
			return drained, NewStreamReadError(streamKey, err)
		}

		batchCount := 0
		lastID := ""
		for _, stream := range streams {
			for _, message := range stream.Messages {
				lastID = message.ID
				if err := c.handleMessage(ctx, streamKey, message); err != nil {
					c.applyRecovery(ctx, err, message.ID)
					c.logger.Printf("PEL drain: handle message %s failed: %v", message.ID, err)
				}
				batchCount++
			}
		}

		if batchCount == 0 {
			return drained, nil
		}
		drained += batchCount
		if lastID != "" {
			cursor = lastID
		}

		// 若返回条数小于 ReadCount，说明当前消费者 PEL 已扫描至末尾
		if c.cfg.ReadCount <= 0 || batchCount < int(c.cfg.ReadCount) {
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

	keys := c.streamKeys()
	streamArgs := make([]string, 0, len(keys)*2)
	streamArgs = append(streamArgs, keys...)
	for range keys {
		streamArgs = append(streamArgs, ">")
	}

	streams, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    c.cfg.ConsumerGroup,
		Consumer: c.cfg.ConsumerName,
		Streams:  streamArgs,
		Count:    c.cfg.ReadCount,
		Block:    c.cfg.BlockDuration,
		NoAck:    false,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil
		}
		return NewStreamReadError(c.cfg.StreamKey, err)
	}

	result := c.msgDispatcher.Dispatch(ctx, streams)
	if result.Errors > 0 {
		c.logger.Printf("dispatch: %d/%d messages failed", result.Errors, result.TotalMessages)
	}
	if err := c.ackAggregator.Ack(ctx, result.Acks); err != nil {
		c.applyRecovery(ctx, err, "")
		c.logger.Printf("ack batch failed: %v", err)
	} else {
		c.state.RecordBatchAck(len(result.Acks))
	}

	// 周期性裁剪主流与辅助流，防止无界堆积引发 Redis 驱逐雪崩
	c.trimCounter++
	if c.cfg.StreamTrimInterval > 0 && c.trimCounter >= c.cfg.StreamTrimInterval {
		c.trimCounter = 0
		if err := c.trimmer.TrimStreams(ctx, c.streamKeys()); err != nil {
			c.logger.Printf("stream trim failed: %v", err)
		}
		if err := c.trimmer.TrimStreamsWithMaxLen(ctx, c.auxiliaryStreamKeys(), defaultAuxiliaryStreamMaxLen); err != nil {
			c.logger.Printf("auxiliary stream trim failed: %v", err)
		}
	}

	return nil
}

func (c *StreamConsumer) ensureGroup(ctx context.Context) error {
	return c.ensureGroupFrom(ctx, "$")
}

func (c *StreamConsumer) ensureGroupFrom(ctx context.Context, start string) error {
	if start == "" {
		start = "$"
	}
	for _, stream := range c.streamKeys() {
		err := c.client.XGroupCreateMkStream(ctx, stream, c.cfg.ConsumerGroup, start).Err()
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
			res, err := c.handlePlatformMessage(ctx, message)
			if err != nil {
				return err
			}
			// 确认平台事件 PEL 条目，避免遗留在 PEL 被 XAUTOCLAIM 无限重放或阻塞启动排空
			if res.Disposition == DispositionAck && res.Ack.MessageID != "" {
				ackStream := res.Ack.StreamKey
				if ackStream == "" {
					ackStream = sk
				}
				if err := c.ackAggregator.Ack(ctx, []AckRequest{{StreamKey: ackStream, MessageID: res.Ack.MessageID}}); err != nil {
					return reclaimstate.NewAckError(ackStream, res.Ack.MessageID, err)
				}
				c.state.RecordBatchAck(1)
			}
			return nil
		}
		envelope, err := contracts.DecodeEnvelope(message)
		if err != nil {
			_, poisonErr := c.handlePoisonMessage(ctx, sk, message, err)
			return poisonErr
		}

		if err := c.handleEnvelope(ctx, message, envelope); err != nil {
			_, poisonErr := c.handlePoisonMessage(ctx, sk, message, err)
			return poisonErr
		}

		c.state.RecordConsumed(sk, envelope.Topic, msgID, envelope.EmittedAt)
		if err := c.ackAggregator.Ack(ctx, []AckRequest{{StreamKey: sk, MessageID: msgID}}); err != nil {
			return reclaimstate.NewAckError(sk, msgID, err)
		}
		c.state.RecordBatchAck(1)
		return nil
	})
	return handler(ctx, streamKey, message.ID, "")
}

func (c *StreamConsumer) handlePlatformMessage(ctx context.Context, message redis.XMessage) (MessageResult, error) {
	envelope, err := contracts.DecodePlatformEnvelope(message)
	if err != nil {
		return c.handlePoisonMessage(ctx, c.cfg.PlatformStreamKey, message, err)
	}
	if err := c.handlePlatformEnvelope(ctx, message, envelope); err != nil {
		return c.handlePoisonMessage(ctx, c.cfg.PlatformStreamKey, message, err)
	}
	c.state.RecordConsumed(c.cfg.PlatformStreamKey, envelope.Topic, message.ID, envelope.EmittedAt)
	return MessageResult{
		Disposition: DispositionAck,
		Ack: AckRequest{
			StreamKey: c.cfg.PlatformStreamKey,
			MessageID: message.ID,
		},
	}, nil
}

func (c *StreamConsumer) streamKeys() []string {
	keys := []string{c.cfg.StreamKey}
	if c.cfg.PlatformStreamKey != "" && c.cfg.PlatformStreamKey != c.cfg.StreamKey {
		keys = append(keys, c.cfg.PlatformStreamKey)
	}
	return keys
}

func (c *StreamConsumer) auxiliaryStreamKeys() []string {
	candidates := []string{
		c.cfg.DLQStreamKey,
		c.cfg.PlatformDLQStreamKey,
		c.cfg.CanaryStreamKey,
		c.cfg.PlatformReplayStreamKey,
		platformreplay.AuditStreamKey(c.cfg.PlatformReplayStreamKey),
		c.cfg.WakeRepairStreamKey,
	}
	out := make([]string, 0, len(candidates))
	for _, key := range candidates {
		if key != "" {
			out = append(out, key)
		}
	}
	return out
}

// applyRecovery 识别故障场景、记录恢复账本、在 NOGROUP 时自动重建消费组，并强制实施带上下文感知的指数退避休眠。
func (c *StreamConsumer) applyRecovery(ctx context.Context, err error, messageID string) {
	if err == nil {
		return
	}
	scenario := ClassifyError(err)
	recipe, ok := c.recipes[scenario]
	if !ok {
		recipe = RecoveryRecipe{
			Scenario:    scenario,
			MaxAttempts: 1,
			Escalation:  EscalationLogAndContinue,
			BackoffBase: defaultMinRecoveryBackoff,
		}
	}

	attempt := int(c.consecutiveErrors.Add(1))
	c.ledger.Record(RecoveryLedgerEntry{
		Scenario:  scenario,
		MessageID: messageID,
		Attempt:   attempt,
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

	// 捕获 Redis NOGROUP 缺失消费组时自动从 0 游标重建，配合幂等投影消除重启/驱逐后的永久死循环
	if scenario == ScenarioConsumerGroupMissing {
		if groupErr := c.ensureGroupFrom(ctx, "0"); groupErr != nil {
			c.state.RecordError(groupErr.Error())
			c.logger.Printf("[ALERT] recreate missing consumer group failed: %v", groupErr)
		} else {
			c.events.Emit(ConsumerEvent{Type: EventGroupEnsured, Timestamp: time.Now()})
			c.logger.Printf("[RECOVERY] recreated missing consumer group %s", c.cfg.ConsumerGroup)
		}
	}

	switch recipe.Escalation {
	case EscalationLogAndContinue:
		// 已由调用方记录上下文日志
	case EscalationAlertHuman:
		c.logger.Printf("[ALERT] scenario=%s attempt=%d msg=%s err=%v — requires attention", scenario, attempt, messageID, err)
	case EscalationAbort:
		c.logger.Printf("[FATAL] scenario=%s attempt=%d msg=%s err=%v — aborting consumer", scenario, attempt, messageID, err)
	}

	backoff := computeRecoveryBackoff(recipe.BackoffBase, attempt, c.maxRecoveryBackoff)
	if backoff > 0 && ctx != nil && ctx.Err() == nil {
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
		case <-timer.C:
		}
	}
}
