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

type FanoutRequestedPayload struct {
	MessageID      string   `json:"messageId"`
	ChatID         string   `json:"chatId"`
	ChatType       string   `json:"chatType"`
	Seq            int64    `json:"seq"`
	SenderID       string   `json:"senderId"`
	RecipientIDs   []string `json:"recipientIds"`
	RecipientCount int      `json:"recipientCount"`
	Topology       string   `json:"topology"`
	OutboxID       string   `json:"outboxId"`
	DispatchMode   string   `json:"dispatchMode"`
	JobIDs         []string `json:"jobIds"`
}

type ProjectionMetrics struct {
	RecipientCount int `json:"recipientCount"`
	ChunkCount     int `json:"chunkCount"`
}

type ProjectionPayload struct {
	MessageID           string             `json:"messageId"`
	ChatID              string             `json:"chatId"`
	ChatType            string             `json:"chatType"`
	Seq                 int64              `json:"seq"`
	SenderID            string             `json:"senderId"`
	RecipientIDs        []string           `json:"recipientIds"`
	RecipientCount      int                `json:"recipientCount"`
	Topology            string             `json:"topology"`
	OutboxID            string             `json:"outboxId"`
	ChunkIndex          int                `json:"chunkIndex"`
	ChunkCount          int                `json:"chunkCount"`
	TotalRecipientCount int                `json:"totalRecipientCount"`
	JobID               string             `json:"jobId"`
	AttemptCount        int                `json:"attemptCount"`
	ReplayCount         int                `json:"replayCount"`
	Projection          *ProjectionMetrics `json:"projection,omitempty"`
	ErrorMessage        string             `json:"errorMessage,omitempty"`
	Terminal            bool               `json:"terminal,omitempty"`
}

type ReplayChunk struct {
	ChunkIndex          int `json:"chunkIndex"`
	RecipientCount      int `json:"recipientCount"`
	ChunkCount          int `json:"chunkCount"`
	TotalRecipientCount int `json:"totalRecipientCount"`
}

type ReplayQueuedPayload struct {
	OutboxID           string        `json:"outboxId"`
	MessageID          string        `json:"messageId"`
	ChatID             string        `json:"chatId"`
	ChatType           string        `json:"chatType"`
	Seq                int64         `json:"seq"`
	ReplayedChunkCount int           `json:"replayedChunkCount"`
	ReplayCount        int           `json:"replayCount"`
	QueuedJobIDs       []string      `json:"queuedJobIds"`
	Chunks             []ReplayChunk `json:"chunks"`
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
