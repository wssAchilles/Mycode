package syncwake

import (
	"context"
	"encoding/json"
	"fmt"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
)

type Publisher interface {
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
}

type Handler struct {
	publisher Publisher
	cfg       config.Config
}

func NewHandler(publisher Publisher, cfg config.Config) *Handler {
	return &Handler{
		publisher: publisher,
		cfg:       cfg,
	}
}

func (h *Handler) Dispatch(
	ctx context.Context,
	envelope buscontracts.PlatformEventEnvelope,
) (platformcontracts.DispatchResult, error) {
	payload, err := buscontracts.DecodeSyncWakeRequestedPayload(envelope)
	if err != nil {
		return platformcontracts.DispatchResult{}, err
	}

	channel := payload.WakeChannel
	if channel == "" {
		channel = h.cfg.WakePubSubChannel
	}
	if channel == "" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Fallback: true,
			Reason:   "wake_channel_missing",
		}, nil
	}
	if h.cfg.SyncWakeExecutionMode != "publish" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Channel:  channel,
			Shadowed: true,
			Reason:   "sync_wake_shadow_mode",
		}, nil
	}
	if h.publisher == nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: channel,
			Failed:  true,
			Reason:  "platform_publisher_unavailable",
		}, fmt.Errorf("platform publisher unavailable")
	}

	body, err := json.Marshal(map[string]interface{}{
		"userId":   payload.UserID,
		"updateId": payload.UpdateID,
	})
	if err != nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: channel,
			Failed:  true,
			Reason:  "sync_wake_marshal_failed",
		}, fmt.Errorf("marshal sync wake payload: %w", err)
	}
	if err := h.publisher.Publish(ctx, channel, string(body)).Err(); err != nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: channel,
			Failed:  true,
			Reason:  "sync_wake_publish_failed",
		}, fmt.Errorf("publish sync wake payload: %w", err)
	}

	return platformcontracts.DispatchResult{
		Topic:    envelope.Topic,
		Executed: true,
		Channel:  channel,
	}, nil
}
