package contracts

import (
	"testing"

	redis "github.com/redis/go-redis/v9"
)

func TestDecodeEnvelope(t *testing.T) {
	message := redis.XMessage{
		ID: "1-0",
		Values: map[string]interface{}{
			"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-1","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"p:user-1:user-2","payload":{"messageId":"msg-1"}}`,
		},
	}

	envelope, err := DecodeEnvelope(message)
	if err != nil {
		t.Fatalf("expected envelope decode success, got %v", err)
	}
	if envelope.Topic != "message_written" {
		t.Fatalf("unexpected topic: %s", envelope.Topic)
	}
	if envelope.EventID != "evt-1" {
		t.Fatalf("unexpected event id: %s", envelope.EventID)
	}
}

func TestDecodeEnvelopeRequiresEventField(t *testing.T) {
	_, err := DecodeEnvelope(redis.XMessage{
		ID:     "1-0",
		Values: map[string]interface{}{},
	})
	if err == nil {
		t.Fatalf("expected decode failure for missing event field")
	}
}
