package streamconsumer

import (
	"encoding/json"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

func messageLaneKey(streamKey string, message redis.XMessage) string {
	if streamKey == "" {
		streamKey = "_"
	}

	if key := keyFromEnvelope(message); key != "" {
		return streamKey + ":" + key
	}
	return streamKey + ":" + message.ID
}

func keyFromEnvelope(message redis.XMessage) string {
	rawEvent, ok := contracts.RawEvent(message)
	if !ok || rawEvent == "" {
		return ""
	}

	var envelope struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal([]byte(rawEvent), &envelope); err != nil {
		return ""
	}

	var payload map[string]any
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return ""
	}

	for _, field := range []string{"chatId", "chat_id", "userId", "user_id", "outboxId", "outbox_id", "messageId", "message_id"} {
		if value := payloadString(payload[field]); value != "" {
			return value
		}
	}

	return ""
}

func payloadString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
