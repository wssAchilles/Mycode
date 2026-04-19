package platform

import (
	"context"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/notification"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/presence"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/syncwake"
)

type Transport interface {
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
}

type topicHandler interface {
	Dispatch(ctx context.Context, envelope buscontracts.PlatformEventEnvelope) (platformcontracts.DispatchResult, error)
}

type Dispatcher struct {
	syncWake     topicHandler
	presence     topicHandler
	notification topicHandler
	replay       *replay.Writer
}

func NewDispatcher(client Transport, cfg config.Config) *Dispatcher {
	return &Dispatcher{
		syncWake:     syncwake.NewHandler(client, cfg),
		presence:     presence.NewHandler(client, cfg),
		notification: notification.NewHandler(client, cfg),
		replay:       replay.New(client, cfg.PlatformReplayStreamKey),
	}
}

func NewReplayOperator(client replay.OperatorClient, cfg config.Config, dispatcher *Dispatcher) *replay.Operator {
	if dispatcher == nil {
		return nil
	}
	return replay.NewOperator(client, cfg.PlatformReplayStreamKey, dispatcher)
}

func (d *Dispatcher) Dispatch(
	ctx context.Context,
	envelope buscontracts.PlatformEventEnvelope,
) (platformcontracts.DispatchResult, error) {
	result := platformcontracts.DispatchResult{
		Topic:        envelope.Topic,
		PartitionKey: envelope.PartitionKey,
		Attempt:      1,
		LagMillis:    envelopeLagMillis(envelope.EmittedAt),
	}
	handler := d.resolveHandler(envelope.Topic)
	if handler == nil {
		result.Fallback = true
		result.Reason = "platform_topic_unsupported"
		return d.queueReplay(ctx, envelope, result, nil)
	}

	dispatchResult, dispatchErr := handler.Dispatch(ctx, envelope)
	dispatchResult.Topic = envelope.Topic
	dispatchResult.LagMillis = result.LagMillis
	if dispatchErr != nil && !needsReplay(dispatchResult) && !dispatchResult.Failed {
		return dispatchResult, dispatchErr
	}
	if dispatchErr != nil {
		dispatchResult.Failed = true
		if dispatchResult.Reason == "" {
			dispatchResult.Reason = "platform_dispatch_failed"
		}
	}

	return d.queueReplay(ctx, envelope, dispatchResult, dispatchErr)
}

func (d *Dispatcher) DispatchReplay(
	ctx context.Context,
	envelope buscontracts.PlatformEventEnvelope,
	attempt int,
) (platformcontracts.DispatchResult, error) {
	result := platformcontracts.DispatchResult{
		Topic:        envelope.Topic,
		PartitionKey: envelope.PartitionKey,
		Attempt:      attempt,
		ReplayKind:   platformcontracts.ReplayKindManualDrain,
		LagMillis:    envelopeLagMillis(envelope.EmittedAt),
	}
	handler := d.resolveHandler(envelope.Topic)
	if handler == nil {
		result.Failed = true
		result.Reason = "platform_topic_unsupported"
		result.Status = platformcontracts.ReplayStatusReplayed
		return result, nil
	}

	dispatchResult, dispatchErr := handler.Dispatch(ctx, envelope)
	dispatchResult.Topic = envelope.Topic
	dispatchResult.PartitionKey = envelope.PartitionKey
	dispatchResult.Attempt = attempt
	dispatchResult.ReplayKind = platformcontracts.ReplayKindManualDrain
	dispatchResult.LagMillis = result.LagMillis
	if dispatchErr != nil {
		dispatchResult.Failed = true
		if dispatchResult.Reason == "" {
			dispatchResult.Reason = "platform_dispatch_failed"
		}
		dispatchResult.Status = platformcontracts.ReplayStatusReplayed
		return dispatchResult, nil
	}
	if needsReplay(dispatchResult) {
		dispatchResult.Status = platformcontracts.ReplayStatusReplayed
		return dispatchResult, nil
	}
	dispatchResult.Status = platformcontracts.ReplayStatusCompleted
	return dispatchResult, nil
}

func (d *Dispatcher) resolveHandler(topic string) topicHandler {
	switch topic {
	case "sync_wake_requested":
		return d.syncWake
	case "presence_fanout_requested":
		return d.presence
	case "notification_dispatch_requested":
		return d.notification
	default:
		return nil
	}
}

func (d *Dispatcher) queueReplay(
	ctx context.Context,
	envelope buscontracts.PlatformEventEnvelope,
	result platformcontracts.DispatchResult,
	dispatchErr error,
) (platformcontracts.DispatchResult, error) {
	if !needsReplay(result) {
		result.Status = platformcontracts.ReplayStatusCompleted
		return result, dispatchErr
	}
	if d.replay == nil {
		if dispatchErr != nil {
			return result, dispatchErr
		}
		return result, fmt.Errorf("platform replay writer unavailable")
	}
	result.Status = platformcontracts.ReplayStatusForResult(result)
	if result.Attempt <= 0 {
		result.Attempt = 1
	}
	if result.ReplayKind == "" {
		result.ReplayKind = platformcontracts.ReplayKindAutomaticFallback
	}
	record, err := d.replay.Write(ctx, envelope, result)
	if err != nil {
		if dispatchErr != nil {
			return result, fmt.Errorf("%w; replay failed: %v", dispatchErr, err)
		}
		return result, err
	}
	result.Replayed = true
	result.ReplayStream = record.Stream
	result.ReplayID = record.ID
	if dispatchErr != nil {
		result.Fallback = true
		return result, nil
	}
	return result, nil
}

func needsReplay(result platformcontracts.DispatchResult) bool {
	return result.Shadowed || result.Fallback || result.Failed
}

func envelopeLagMillis(emittedAt string) int64 {
	if emittedAt == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339Nano, emittedAt)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, emittedAt)
		if err != nil {
			return 0
		}
	}
	lag := time.Since(parsed)
	if lag < 0 {
		return 0
	}
	return lag.Milliseconds()
}
