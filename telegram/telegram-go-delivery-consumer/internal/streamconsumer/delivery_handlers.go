package streamconsumer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/canary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/shadow"
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
	plan := planner.BuildShadowPlan(planner.FanoutRequest{
		MessageID:    payload.MessageID,
		ChatID:       payload.ChatID,
		OutboxID:     payload.OutboxID,
		RecipientIDs: payload.RecipientIDs,
	}, c.cfg.MaxRecipientsPerChunk)

	for _, chunk := range plan.Chunks {
		c.shadow.Track(shadow.TrackedPlan{
			MessageID:              plan.MessageID,
			OutboxID:               plan.OutboxID,
			ChunkIndex:             chunk.ChunkIndex,
			ExpectedRecipientCount: chunk.RecipientCount,
			ExpectedChunkCount:     plan.ChunkCount,
		})
	}
	c.state.RecordShadowPlanned(len(plan.Chunks), c.shadow.Pending())
	return nil
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
		c.state.RecordPrimarySkipped(envelope.EventID, eligibility.Reason)
		return nil
	}
	if c.primary == nil {
		return fmt.Errorf("primary executor unavailable")
	}
	result, err := c.primary.ExecuteFanout(ctx, primaryPayload)
	if err == nil {
		c.state.RecordPrimaryExecution(true, eligibility.Segment, envelope.EventID, result.OutboxID, result.RecipientCount, "")
		return nil
	}

	c.state.RecordPrimaryExecution(false, eligibility.Segment, envelope.EventID, primaryPayload.OutboxID, 0, err.Error())
	if primaryPayload.AttemptCount < c.cfg.PrimaryMaxAttempts {
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
	c.state.RecordPrimaryFailureRecorded(true)
	if recorder, ok := c.primary.(primary.FailureRecorder); ok {
		if recordErr := recorder.RecordFailure(ctx, primaryPayload, err.Error(), true); recordErr != nil {
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
	payload.PrimaryAttemptCount = nextAttempt
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode primary retry payload: %w", err)
	}
	retryEnvelope := envelope
	retryEnvelope.EventID = fmt.Sprintf("%s:retry:%d", envelope.EventID, nextAttempt)
	retryEnvelope.EmittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	retryEnvelope.Payload = rawPayload
	rawEnvelope, err := json.Marshal(retryEnvelope)
	if err != nil {
		return fmt.Errorf("encode primary retry envelope: %w", err)
	}
	_, err = c.client.XAdd(ctx, &redis.XAddArgs{
		Stream: c.cfg.StreamKey,
		Values: map[string]interface{}{
			"event": string(rawEnvelope),
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
	for _, chunk := range payload.Chunks {
		c.shadow.Track(shadow.TrackedPlan{
			MessageID:              payload.MessageID,
			OutboxID:               payload.OutboxID,
			ChunkIndex:             chunk.ChunkIndex,
			ExpectedRecipientCount: chunk.RecipientCount,
			ExpectedChunkCount:     chunk.ChunkCount,
		})
	}
	c.state.RecordShadowPlanned(len(payload.Chunks), c.shadow.Pending())
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
) error {
	reason := cause.Error()
	writer := c.deliveryDLQ
	if streamKey == c.cfg.PlatformStreamKey {
		writer = c.platformDLQ
	}
	if err := writer.Write(ctx, message, reason); err != nil {
		return err
	}
	c.state.RecordDeadLetter(reason)
	c.state.RecordError(reason)
	if err := c.client.XAck(ctx, streamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return fmt.Errorf("ack poisoned stream message: %w", err)
	}
	return nil
}
