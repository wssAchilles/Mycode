package contracts

import (
	"encoding/json"
	"errors"
	"fmt"

	redis "github.com/redis/go-redis/v9"
)

var ErrMissingEnvelope = errors.New("missing event envelope")

func DecodeEnvelope(message redis.XMessage) (DeliveryEventEnvelope, error) {
	rawEnvelope, ok := readStringField(message.Values, "event")
	if !ok || rawEnvelope == "" {
		return DeliveryEventEnvelope{}, ErrMissingEnvelope
	}

	var envelope DeliveryEventEnvelope
	if err := json.Unmarshal([]byte(rawEnvelope), &envelope); err != nil {
		return DeliveryEventEnvelope{}, fmt.Errorf("decode event envelope: %w", err)
	}
	if envelope.Topic == "" || envelope.EventID == "" {
		return DeliveryEventEnvelope{}, fmt.Errorf("invalid event envelope: topic/eventId required")
	}
	return envelope, nil
}

func DecodePlatformEnvelope(message redis.XMessage) (PlatformEventEnvelope, error) {
	rawEnvelope, ok := readStringField(message.Values, "event")
	if !ok || rawEnvelope == "" {
		return PlatformEventEnvelope{}, ErrMissingEnvelope
	}

	var envelope PlatformEventEnvelope
	if err := json.Unmarshal([]byte(rawEnvelope), &envelope); err != nil {
		return PlatformEventEnvelope{}, fmt.Errorf("decode platform event envelope: %w", err)
	}
	if envelope.Topic == "" || envelope.EventID == "" {
		return PlatformEventEnvelope{}, fmt.Errorf("invalid platform event envelope: topic/eventId required")
	}
	return envelope, nil
}

func DecodeFanoutRequestedPayload(envelope DeliveryEventEnvelope) (FanoutRequestedPayload, error) {
	var payload FanoutRequestedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return FanoutRequestedPayload{}, fmt.Errorf("decode fanout requested payload: %w", err)
	}
	if payload.MessageID == "" || payload.ChatID == "" {
		return FanoutRequestedPayload{}, fmt.Errorf("invalid fanout requested payload: messageId/chatId required")
	}
	return payload, nil
}

func DecodeProjectionPayload(envelope DeliveryEventEnvelope) (ProjectionPayload, error) {
	var payload ProjectionPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return ProjectionPayload{}, fmt.Errorf("decode projection payload: %w", err)
	}
	if payload.MessageID == "" || payload.ChatID == "" {
		return ProjectionPayload{}, fmt.Errorf("invalid projection payload: messageId/chatId required")
	}
	return payload, nil
}

func DecodeReplayQueuedPayload(envelope DeliveryEventEnvelope) (ReplayQueuedPayload, error) {
	var payload ReplayQueuedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return ReplayQueuedPayload{}, fmt.Errorf("decode replay queued payload: %w", err)
	}
	if payload.MessageID == "" || payload.OutboxID == "" {
		return ReplayQueuedPayload{}, fmt.Errorf("invalid replay queued payload: messageId/outboxId required")
	}
	return payload, nil
}

func DecodeSyncWakeRequestedPayload(envelope PlatformEventEnvelope) (SyncWakeRequestedPayload, error) {
	var payload SyncWakeRequestedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return SyncWakeRequestedPayload{}, fmt.Errorf("decode sync wake requested payload: %w", err)
	}
	if payload.UserID == "" || payload.UpdateID <= 0 {
		return SyncWakeRequestedPayload{}, fmt.Errorf("invalid sync wake requested payload: userId/updateId required")
	}
	return payload, nil
}

func DecodePresenceFanoutRequestedPayload(envelope PlatformEventEnvelope) (PresenceFanoutRequestedPayload, error) {
	var payload PresenceFanoutRequestedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return PresenceFanoutRequestedPayload{}, fmt.Errorf("decode presence fanout requested payload: %w", err)
	}
	if payload.UserID == "" || payload.Status == "" || payload.Target == "" {
		return PresenceFanoutRequestedPayload{}, fmt.Errorf("invalid presence fanout requested payload: userId/status/target required")
	}
	return payload, nil
}

func DecodeNotificationDispatchRequestedPayload(envelope PlatformEventEnvelope) (NotificationDispatchRequestedPayload, error) {
	var payload NotificationDispatchRequestedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return NotificationDispatchRequestedPayload{}, fmt.Errorf("decode notification dispatch requested payload: %w", err)
	}
	if payload.UserID == "" || payload.Type == "" || payload.Title == "" || payload.Body == "" {
		return NotificationDispatchRequestedPayload{}, fmt.Errorf("invalid notification dispatch requested payload: userId/type/title/body required")
	}
	return payload, nil
}

func RawEvent(message redis.XMessage) (string, bool) {
	return readStringField(message.Values, "event")
}

func readStringField(values map[string]interface{}, key string) (string, bool) {
	raw, exists := values[key]
	if !exists || raw == nil {
		return "", false
	}
	switch typed := raw.(type) {
	case string:
		return typed, true
	case []byte:
		return string(typed), true
	default:
		return fmt.Sprint(typed), true
	}
}
