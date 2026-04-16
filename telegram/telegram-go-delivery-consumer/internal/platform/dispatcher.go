package platform

import (
	"context"
	"encoding/json"
	"fmt"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

type Publisher interface {
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
}

type Dispatcher struct {
	publisher Publisher
	cfg       config.Config
}

type DispatchResult struct {
	Executed bool
	Shadowed bool
	Channel  string
	Reason   string
}

func NewDispatcher(publisher Publisher, cfg config.Config) *Dispatcher {
	return &Dispatcher{
		publisher: publisher,
		cfg:       cfg,
	}
}

func (d *Dispatcher) DispatchSyncWake(ctx context.Context, payload contracts.SyncWakeRequestedPayload) (DispatchResult, error) {
	channel := payload.WakeChannel
	if channel == "" {
		channel = d.cfg.WakePubSubChannel
	}
	if channel == "" {
		return DispatchResult{Shadowed: true, Reason: "wake_channel_missing"}, nil
	}
	return d.publishJSON(ctx, channel, map[string]interface{}{
		"userId":   payload.UserID,
		"updateId": payload.UpdateID,
	}, d.cfg.SyncWakeExecutionMode)
}

func (d *Dispatcher) DispatchPresenceFanout(ctx context.Context, payload contracts.PresenceFanoutRequestedPayload) (DispatchResult, error) {
	if d.cfg.PresenceExecutionMode != "publish" {
		return DispatchResult{Shadowed: true, Reason: "presence_shadow_mode"}, nil
	}
	if payload.Target != "broadcast" {
		return DispatchResult{Shadowed: true, Reason: "presence_target_unsupported"}, nil
	}

	channel := d.cfg.PresenceOnlineChannel
	if payload.Status == "offline" {
		channel = d.cfg.PresenceOfflineChannel
	}
	if channel == "" {
		return DispatchResult{Shadowed: true, Reason: "presence_channel_missing"}, nil
	}

	body := map[string]interface{}{
		"userId": payload.UserID,
		"status": payload.Status,
	}
	if payload.LastSeen != nil && *payload.LastSeen != "" {
		body["lastSeen"] = *payload.LastSeen
	}

	return d.publishJSON(ctx, channel, body, "publish")
}

func (d *Dispatcher) DispatchNotification(ctx context.Context, payload contracts.NotificationDispatchRequestedPayload) (DispatchResult, error) {
	if d.cfg.NotificationExecutionMode != "publish" {
		return DispatchResult{Shadowed: true, Reason: "notification_shadow_mode"}, nil
	}
	if d.cfg.NotificationChannel == "" {
		return DispatchResult{Shadowed: true, Reason: "notification_channel_missing"}, nil
	}

	return d.publishJSON(ctx, d.cfg.NotificationChannel, map[string]interface{}{
		"userId": payload.UserID,
		"type":   payload.Type,
		"title":  payload.Title,
		"body":   payload.Body,
		"data":   payload.Data,
	}, "publish")
}

func (d *Dispatcher) publishJSON(ctx context.Context, channel string, payload map[string]interface{}, mode string) (DispatchResult, error) {
	if mode != "publish" {
		return DispatchResult{Shadowed: true, Channel: channel, Reason: "shadow_mode"}, nil
	}
	if d.publisher == nil {
		return DispatchResult{}, fmt.Errorf("platform publisher unavailable")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return DispatchResult{}, fmt.Errorf("marshal platform payload: %w", err)
	}
	if err := d.publisher.Publish(ctx, channel, string(body)).Err(); err != nil {
		return DispatchResult{}, fmt.Errorf("publish platform payload: %w", err)
	}
	return DispatchResult{
		Executed: true,
		Channel:  channel,
	}, nil
}
