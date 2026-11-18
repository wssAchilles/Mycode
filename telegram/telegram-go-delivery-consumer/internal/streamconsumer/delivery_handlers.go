package streamconsumer

import (
	"context"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/canary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/common"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/shadow"
	streamdelivery "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/delivery"
	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
	streamretry "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/retry"
)

func (c *StreamConsumer) handleEnvelope(
	ctx context.Context,
	message redis.XMessage,
	envelope contracts.DeliveryEventEnvelope,
) error {
	switch envelope.Topic {
	case "fanout_requested":
		return c.handleFanoutRequested(ctx, message, envelope)
	case "fanout_replay_queued":
		return c.handleReplayQueued(envelope)
	case "fanout_projection_completed":
		return c.handleProjectionCompleted(ctx, message, envelope)
	case "fanout_projection_failed":
		return c.handleProjectionFailed(envelope)
	default:
		return nil
	}
}

func (c *StreamConsumer) handleFanoutRequested(
	ctx context.Context,
	message redis.XMessage,
	envelope contracts.DeliveryEventEnvelope,
) error {
	if c.cfg.ExecutionMode == "dry-run" {
		return nil
	}

	payload, err := contracts.DecodeFanoutRequestedPayload(envelope)
	if err != nil {
		return err
	}
	if c.cfg.ExecutionMode == "primary" {
		return c.handlePrimaryFanout(ctx, message, envelope, payload)
	}
	tracks := streamdelivery.BuildFanoutShadowTracks(payload, c.cfg.MaxRecipientsPerChunk)
	for _, track := range tracks {
		c.shadow.Track(track)
	}
	c.state.RecordShadowPlanned(len(tracks), c.shadow.Pending())
	return nil
}

const defaultHardRecipientLimit = 10000

func primaryHardRecipientLimit(cfg config.Config) int {
	limit := cfg.MaxRecipientsPerChunk * 10
	if limit < defaultHardRecipientLimit {
		return defaultHardRecipientLimit
	}
	return limit
}

func isNodeDelegatedPrimaryDispatch(dispatchMode string) bool {
	return dispatchMode == "go_primary" || dispatchMode == "go_group_canary"
}

func resolveStreamMaxLen(threshold int64) int64 {
	if threshold > 0 {
		return threshold
	}
	return 100000
}

func (c *StreamConsumer) handlePrimaryFanout(
	ctx context.Context,
	message redis.XMessage,
	envelope contracts.DeliveryEventEnvelope,
	payload contracts.FanoutRequestedPayload,
) error {
	primaryPayload := primary.FromEnvelope(message.ID, envelope, payload)
	eligibility := primary.CheckEligibility(c.cfg, primaryPayload)
	if !eligibility.Eligible {
		// 当 Node 已指定事件由 Go 主投递时，防止双端软门控阈值漂移导致直接 XACK 黑洞蒸发消息
		if c.cfg.ExecutionMode == "primary" && c.cfg.GoPrimaryReady && isNodeDelegatedPrimaryDispatch(primaryPayload.DispatchMode) {
			recipientCount := len(common.DedupeRecipients(primaryPayload.RecipientIDs))
			hardLimit := primaryHardRecipientLimit(c.cfg)
			if (eligibility.Reason == "recipient_limit_exceeded" || eligibility.Reason == "segment_not_enabled") && recipientCount <= hardLimit {
				c.logger.Printf(
					"warn: primary gate drift detected for event=%s outbox=%s reason=%s recipients=%d; executing primary projection to prevent message loss",
					envelope.EventID,
					primaryPayload.OutboxID,
					eligibility.Reason,
					recipientCount,
				)
				eligibility = primary.Eligibility{
					Eligible: true,
					Reason:   "eligible_drift_override",
					Segment:  eligibility.Segment,
				}
			} else if eligibility.Reason == "recipient_limit_exceeded" && recipientCount > hardLimit {
				reason := fmt.Sprintf("recipient_hard_limit_exceeded:%d>%d", recipientCount, hardLimit)
				c.state.RecordPrimarySkipped(envelope.EventID, "recipient_hard_limit_exceeded")
				if recorder, ok := c.primary.(primary.FailureRecorder); ok {
					if recordErr := recorder.RecordFailure(ctx, primaryPayload, reason, true); recordErr != nil {
						c.logger.Printf("record hard-limit primary failure failed: %v", recordErr)
					}
				}
				return fmt.Errorf("primary fanout %s", reason)
			}
		}
	}
	if !eligibility.Eligible {
		c.state.RecordPrimarySkipped(envelope.EventID, eligibility.Reason)
		// 对回退至 Node 队列执行的大群消息同步登记 Shadow 轨迹，确保后续 Canary 对账不失明
		if eligibility.Reason == "dispatch_mode_not_primary" {
			tracks := streamdelivery.BuildFanoutShadowTracks(payload, c.cfg.MaxRecipientsPerChunk)
			for _, track := range tracks {
				c.shadow.Track(track)
			}
			c.state.RecordShadowPlanned(len(tracks), c.shadow.Pending())
		}
		return nil
	}
	if c.primary == nil {
		return fmt.Errorf("primary executor unavailable")
	}
	result, err := c.primary.ExecuteFanout(ctx, primaryPayload)
	if err == nil {
		c.state.RecordPrimaryExecution(true, eligibility.Segment, envelope.EventID, result.OutboxID, result.RecipientCount, "")
		c.state.RecordPrimaryCompletedChunkSkips(result.CompletedChunkSkips)
		return nil
	}

	c.state.RecordPrimaryExecution(false, eligibility.Segment, envelope.EventID, primaryPayload.OutboxID, 0, err.Error())
	decision := streamdelivery.DecidePrimaryFailure(err, primaryPayload.AttemptCount, c.cfg.PrimaryMaxAttempts)
	c.state.RecordPrimaryMongoFailureCategory(string(decision.Category))
	if decision.Handled {
		if recorder, ok := c.primary.(primary.FailureRecorder); ok {
			if recordErr := recorder.RecordFailure(ctx, primaryPayload, err.Error(), false); recordErr != nil {
				c.logger.Printf("record handled primary failure failed: %v", recordErr)
			}
		}
		return nil
	}
	if decision.QueueRetry {
		c.state.RecordPrimaryFailureRecorded(false)
		if recorder, ok := c.primary.(primary.FailureRecorder); ok {
			if recordErr := recorder.RecordFailure(ctx, primaryPayload, err.Error(), false); recordErr != nil {
				c.logger.Printf("record retryable primary failure failed: %v", recordErr)
			}
		}
		if retryErr := c.retryPrimaryFanout(ctx, envelope, payload, primaryPayload.AttemptCount+1); retryErr != nil {
			return retryErr
		}
		c.state.RecordPrimaryRetryQueued(envelope.EventID)
		return nil
	}
	c.state.RecordPrimaryFailureRecorded(decision.Terminal)
	if recorder, ok := c.primary.(primary.FailureRecorder); ok {
		if recordErr := recorder.RecordFailure(ctx, primaryPayload, err.Error(), decision.Terminal); recordErr != nil {
			c.logger.Printf("record primary failure failed: %v", recordErr)
		}
	}
	return err
}

func (c *StreamConsumer) retryPrimaryFanout(
	ctx context.Context,
	envelope contracts.DeliveryEventEnvelope,
	payload contracts.FanoutRequestedPayload,
	nextAttempt int,
) error {
	retryEnvelope, err := streamretry.BuildPrimaryFanoutEnvelope(envelope, payload, nextAttempt, time.Now())
	if err != nil {
		return err
	}
	_, err = c.client.XAdd(ctx, &redis.XAddArgs{
		Stream: c.cfg.StreamKey,
		MaxLen: resolveStreamMaxLen(c.cfg.StreamTrimThreshold),
		Approx: true,
		Values: map[string]interface{}{
			"event": retryEnvelope.RawEvent,
		},
	}).Result()
	if err != nil {
		return fmt.Errorf("enqueue primary retry: %w", err)
	}
	return nil
}

func (c *StreamConsumer) handleReplayQueued(
	envelope contracts.DeliveryEventEnvelope,
) error {
	if c.cfg.ExecutionMode == "dry-run" {
		return nil
	}

	payload, err := contracts.DecodeReplayQueuedPayload(envelope)
	if err != nil {
		return err
	}
	tracks := streamdelivery.BuildReplayShadowTracks(payload)
	for _, track := range tracks {
		c.shadow.Track(track)
	}
	c.state.RecordShadowPlanned(len(tracks), c.shadow.Pending())
	return nil
}

func (c *StreamConsumer) handleProjectionCompleted(
	ctx context.Context,
	message redis.XMessage,
	envelope contracts.DeliveryEventEnvelope,
) error {
	if c.cfg.ExecutionMode == "dry-run" {
		return nil
	}

	payload, err := contracts.DecodeProjectionPayload(envelope)
	if err != nil {
		return err
	}
	if payload.Projection == nil {
		return fmt.Errorf("projection payload missing projection result")
	}

	result := c.shadow.Compare(shadow.ProjectionResult{
		MessageID:      payload.MessageID,
		OutboxID:       payload.OutboxID,
		ChunkIndex:     payload.ChunkIndex,
		RecipientCount: payload.Projection.RecipientCount,
		ChunkCount:     payload.Projection.ChunkCount,
	})
	if result.Compared {
		c.state.RecordShadowCompared(result.Matched, result.Reason, c.shadow.Pending())
		if c.cfg.ExecutionMode == "canary" || c.cfg.ExecutionMode == "primary" {
			eventID, err := c.canary.WriteProjectionBookkeeping(ctx, canary.ProjectionBookkeepingRecord{
				SourceMessageID: message.ID,
				Envelope:        envelope,
				Payload:         payload,
				Matched:         result.Matched,
				Reason:          result.Reason,
			})
			if err != nil {
				return err
			}
			c.state.RecordCanaryExecution(result.Matched, eventID, result.Reason)
		}
	}
	return nil
}

func (c *StreamConsumer) handleProjectionFailed(
	envelope contracts.DeliveryEventEnvelope,
) error {
	if c.cfg.ExecutionMode == "dry-run" {
		return nil
	}

	payload, err := contracts.DecodeProjectionPayload(envelope)
	if err != nil {
		return err
	}
	result := c.shadow.Fail(shadow.ProjectionResult{
		MessageID:  payload.MessageID,
		OutboxID:   payload.OutboxID,
		ChunkIndex: payload.ChunkIndex,
	}, payload.ErrorMessage)
	if result.Compared {
		c.state.RecordShadowCompared(false, result.Reason, c.shadow.Pending())
	}
	return nil
}

func (c *StreamConsumer) handlePoisonMessage(
	ctx context.Context,
	streamKey string,
	message redis.XMessage,
	cause error,
) (MessageResult, error) {
	reason := cause.Error()
	writer := c.deliveryDLQ
	if streamKey == c.cfg.PlatformStreamKey {
		writer = c.platformDLQ
	}
	// 死信写入失败时严禁调用 XAck，直接返回类型化 DLQWriteError 使原消息保留在 PEL 等待后续恢复
	if err := writer.Write(ctx, message, reason); err != nil {
		c.logger.Printf("DLQ write failed for message %s: %v (original error: %s)", message.ID, err, reason)
		return MessageResult{Disposition: DispositionNoAck}, NewDLQWriteError(streamKey, message.ID, err, cause)
	}
	c.state.RecordDeadLetter(reason)
	c.state.RecordError(reason)
	if err := c.client.XAck(ctx, streamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return MessageResult{}, reclaimstate.NewAckError(streamKey, message.ID, err)
	}
	return MessageResult{Disposition: DispositionNoAck}, nil
}
