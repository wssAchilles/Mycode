package notification

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
	payload, err := buscontracts.DecodeNotificationDispatchRequestedPayload(envelope)
	if err != nil {
		return platformcontracts.DispatchResult{}, err
	}
	if h.cfg.NotificationChannel == "" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Fallback: true,
			Reason:   "notification_channel_missing",
		}, nil
	}
	if h.cfg.NotificationExecutionMode != "publish" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Channel:  h.cfg.NotificationChannel,
			Shadowed: true,
			Reason:   "notification_shadow_mode",
		}, nil
	}
	if h.publisher == nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: h.cfg.NotificationChannel,
			Failed:  true,
			Reason:  "platform_publisher_unavailable",
		}, fmt.Errorf("platform publisher unavailable")
	}

	encoded, err := json.Marshal(map[string]interface{}{
		"userId": payload.UserID,
		"type":   payload.Type,
		"title":  payload.Title,
		"body":   payload.Body,
		"data":   payload.Data,
	})
	if err != nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: h.cfg.NotificationChannel,
			Failed:  true,
			Reason:  "notification_marshal_failed",
		}, fmt.Errorf("marshal notification payload: %w", err)
	}
	if err := h.publisher.Publish(ctx, h.cfg.NotificationChannel, string(encoded)).Err(); err != nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: h.cfg.NotificationChannel,
			Failed:  true,
			Reason:  "notification_publish_failed",
		}, fmt.Errorf("publish notification payload: %w", err)
	}

	return platformcontracts.DispatchResult{
		Topic:    envelope.Topic,
		Executed: true,
		Channel:  h.cfg.NotificationChannel,
	}, nil
}
