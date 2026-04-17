package presence

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
	payload, err := buscontracts.DecodePresenceFanoutRequestedPayload(envelope)
	if err != nil {
		return platformcontracts.DispatchResult{}, err
	}
	if payload.Target != "broadcast" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Fallback: true,
			Reason:   "presence_target_unsupported",
		}, nil
	}

	channel := h.cfg.PresenceOnlineChannel
	if payload.Status == "offline" {
		channel = h.cfg.PresenceOfflineChannel
	}
	if channel == "" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Fallback: true,
			Reason:   "presence_channel_missing",
		}, nil
	}
	if h.cfg.PresenceExecutionMode != "publish" {
		return platformcontracts.DispatchResult{
			Topic:    envelope.Topic,
			Channel:  channel,
			Shadowed: true,
			Reason:   "presence_shadow_mode",
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

	body := map[string]interface{}{
		"userId": payload.UserID,
		"status": payload.Status,
	}
	if payload.LastSeen != nil && *payload.LastSeen != "" {
		body["lastSeen"] = *payload.LastSeen
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: channel,
			Failed:  true,
			Reason:  "presence_marshal_failed",
		}, fmt.Errorf("marshal presence payload: %w", err)
	}
	if err := h.publisher.Publish(ctx, channel, string(encoded)).Err(); err != nil {
		return platformcontracts.DispatchResult{
			Topic:   envelope.Topic,
			Channel: channel,
			Failed:  true,
			Reason:  "presence_publish_failed",
		}, fmt.Errorf("publish presence payload: %w", err)
	}

	return platformcontracts.DispatchResult{
		Topic:    envelope.Topic,
		Executed: true,
		Channel:  channel,
	}, nil
}
