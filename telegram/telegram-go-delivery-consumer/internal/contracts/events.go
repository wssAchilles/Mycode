package contracts

import (
	"encoding/json"
	"errors"
	"fmt"

	redis "github.com/redis/go-redis/v9"
)

var ErrMissingEnvelope = errors.New("missing event envelope")

type DeliveryEventEnvelope struct {
	SpecVersion  string          `json:"specVersion"`
	Producer     string          `json:"producer"`
	EventID      string          `json:"eventId"`
	Topic        string          `json:"topic"`
	EmittedAt    string          `json:"emittedAt"`
	PartitionKey string          `json:"partitionKey"`
	Payload      json.RawMessage `json:"payload"`
}

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
