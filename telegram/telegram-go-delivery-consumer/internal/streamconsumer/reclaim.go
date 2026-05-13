package streamconsumer

import (
	"context"
	"time"

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
		Client:   c.client,
		Handler:  c.handleMessage,
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

func (r reclaimSummaryRecorder) RecordError(message string) {
	if r.state == nil {
		return
	}
	r.state.RecordError(message)
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
