package streamconsumer

import (
	"context"
	"time"

	redis "github.com/redis/go-redis/v9"

	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func (c *StreamConsumer) reclaimPendingIfDue(ctx context.Context) error {
	if c.cfg.PendingIdleDuration <= 0 || c.cfg.PendingClaimInterval <= 0 || c.cfg.PendingClaimCount <= 0 {
		return nil
	}
	now := time.Now()
	if !c.reclaimScheduler.Due(now) {
		return nil
	}

	for _, streamKey := range c.streamKeys() {
		if err := c.reclaimPendingStream(ctx, streamKey); err != nil {
			return err
		}
	}
	c.reclaimScheduler.MarkRun(now)
	return nil
}

func (c *StreamConsumer) reclaimPendingStream(ctx context.Context, streamKey string) error {
	scanner := reclaimstate.Scanner{
		Client: c.client,
		Handler: func(ctx context.Context, sk string, msg redis.XMessage) error {
			err := c.handleMessage(ctx, sk, msg)
			if err != nil {
				c.applyRecovery(ctx, err, msg.ID)
			}
			return err
		},
		Recorder: reclaimSummaryRecorder{state: c.state},
		Cursors:  c.reclaimCursors,
		Logger:   c.logger,
		Config: reclaimstate.ScannerConfig{
			ConsumerGroup: c.cfg.ConsumerGroup,
			ConsumerName:  c.cfg.ConsumerName,
			MinIdle:       c.cfg.PendingIdleDuration,
			ClaimCount:    c.cfg.PendingClaimCount,
			MaxBatches:    c.cfg.PendingReclaimMaxBatches,
			CursorMode:    c.cfg.ReclaimCursorMode,
		},
	}
	return scanner.ScanStream(ctx, streamKey)
}

type reclaimSummaryRecorder struct {
	state *summary.Summary
}

func (r reclaimSummaryRecorder) DeadLetterCount() int {
	if r.state == nil {
		return 0
	}
	return r.state.Snapshot().DeadLetters
}

func (r reclaimSummaryRecorder) RecordError(_ string) {
	// 错误指标已由上层 applyRecovery 统一记录，避免同一条回收失败重复计数
}

func (r reclaimSummaryRecorder) RecordPendingReclaimDuration(
	streamKey string,
	claimed int,
	poison int,
	ackFailures int,
	lastCursor string,
	duration time.Duration,
) {
	if r.state == nil {
		return
	}
	r.state.RecordPendingReclaimDuration(streamKey, claimed, poison, ackFailures, lastCursor, duration)
}
