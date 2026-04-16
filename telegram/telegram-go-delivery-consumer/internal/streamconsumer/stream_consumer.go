package streamconsumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/canary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/shadow"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type StreamClient interface {
	XGroupCreateMkStream(ctx context.Context, stream string, group string, start string) *redis.StatusCmd
	XReadGroup(ctx context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd
	XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
}

type StreamConsumer struct {
	client      StreamClient
	cfg         config.Config
	state       *summary.Summary
	logger      *log.Logger
	shadow      *shadow.Tracker
	canary      *canary.Writer
	deliveryDLQ *dlq.Writer
	platformDLQ *dlq.Writer
	primary     primary.Executor
	dispatcher  *platform.Dispatcher
}

type Dependencies struct {
	PrimaryExecutor primary.Executor
	Dispatcher      *platform.Dispatcher
}

func New(client StreamClient, cfg config.Config, state *summary.Summary, logger *log.Logger) *StreamConsumer {
	return NewWithDeps(client, cfg, state, logger, Dependencies{})
}

func NewWithDeps(
	client StreamClient,
	cfg config.Config,
	state *summary.Summary,
	logger *log.Logger,
	deps Dependencies,
) *StreamConsumer {
	return &StreamConsumer{
		client:      client,
		cfg:         cfg,
		state:       state,
		logger:      logger,
		shadow:      shadow.New(),
		canary:      canary.New(client, cfg.CanaryStreamKey),
		deliveryDLQ: dlq.New(client, cfg.DLQStreamKey),
		platformDLQ: dlq.New(client, cfg.PlatformDLQStreamKey),
		primary:     deps.PrimaryExecutor,
		dispatcher:  deps.Dispatcher,
	}
}

func (c *StreamConsumer) Run(ctx context.Context) error {
	if err := c.ensureGroup(ctx); err != nil {
		return err
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := c.ConsumeOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			c.state.RecordError(err.Error())
			c.logger.Printf("consume iteration failed: %v", err)
		}
	}
}

func (c *StreamConsumer) ConsumeOnce(ctx context.Context) error {
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

	for _, stream := range streams {
		for _, message := range stream.Messages {
			if err := c.handleMessage(ctx, stream.Stream, message); err != nil {
				c.state.RecordError(err.Error())
				c.logger.Printf("handle message %s failed: %v", message.ID, err)
			}
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
	if streamKey == c.cfg.PlatformStreamKey {
		return c.handlePlatformMessage(ctx, message)
	}
	envelope, err := contracts.DecodeEnvelope(message)
	if err != nil {
		return c.handlePoisonMessage(ctx, streamKey, message, err)
	}

	if err := c.handleEnvelope(ctx, message, envelope); err != nil {
		return c.handlePoisonMessage(ctx, streamKey, message, err)
	}

	c.state.RecordConsumed(streamKey, envelope.Topic, message.ID, envelope.EmittedAt)
	if err := c.client.XAck(ctx, streamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return fmt.Errorf("ack stream message: %w", err)
	}
	return nil
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
		return fmt.Errorf("ack platform stream message: %w", err)
	}
	return nil
}

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

func (c *StreamConsumer) handlePlatformEnvelope(
	ctx context.Context,
	message redis.XMessage,
	envelope contracts.PlatformEventEnvelope,
) error {
	switch envelope.Topic {
	case "sync_wake_requested":
		payload, err := contracts.DecodeSyncWakeRequestedPayload(envelope)
		if err != nil {
			return err
		}
		if c.dispatcher == nil {
			return fmt.Errorf("platform dispatcher unavailable")
		}
		result, err := c.dispatcher.DispatchSyncWake(ctx, payload)
		c.state.RecordPlatformExecution(envelope.Topic, result.Executed, result.Shadowed, result.Channel, result.Reason)
		return err
	case "presence_fanout_requested":
		payload, err := contracts.DecodePresenceFanoutRequestedPayload(envelope)
		if err != nil {
			return err
		}
		if c.dispatcher == nil {
			return fmt.Errorf("platform dispatcher unavailable")
		}
		result, err := c.dispatcher.DispatchPresenceFanout(ctx, payload)
		c.state.RecordPlatformExecution(envelope.Topic, result.Executed, result.Shadowed, result.Channel, result.Reason)
		return err
	case "notification_dispatch_requested":
		payload, err := contracts.DecodeNotificationDispatchRequestedPayload(envelope)
		if err != nil {
			return err
		}
		if c.dispatcher == nil {
			return fmt.Errorf("platform dispatcher unavailable")
		}
		result, err := c.dispatcher.DispatchNotification(ctx, payload)
		c.state.RecordPlatformExecution(envelope.Topic, result.Executed, result.Shadowed, result.Channel, result.Reason)
		return err
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

func (c *StreamConsumer) streamKeys() []string {
	keys := []string{c.cfg.StreamKey}
	if c.cfg.PlatformStreamKey != "" && c.cfg.PlatformStreamKey != c.cfg.StreamKey {
		keys = append(keys, c.cfg.PlatformStreamKey)
	}
	return keys
}
