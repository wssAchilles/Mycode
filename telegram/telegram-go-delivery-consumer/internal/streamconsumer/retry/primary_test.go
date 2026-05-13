package retry

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

func TestBuildPrimaryFanoutEnvelopeSetsAttemptAndEventID(t *testing.T) {
	envelope := contracts.DeliveryEventEnvelope{
		SpecVersion:  "chat.delivery.v1",
		Producer:     "node-backend",
		EventID:      "evt-1",
		Topic:        "fanout_requested",
		EmittedAt:    "2026-04-15T00:00:00Z",
		PartitionKey: "chat-1",
	}
	payload := contracts.FanoutRequestedPayload{
		MessageID:    "msg-1",
		ChatID:       "chat-1",
		RecipientIDs: []string{"u1"},
		OutboxID:     "outbox-1",
	}

	retryEnvelope, err := BuildPrimaryFanoutEnvelope(
		envelope,
		payload,
		2,
		time.Date(2026, 4, 15, 1, 2, 3, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("build retry envelope failed: %v", err)
	}
	if retryEnvelope.EventID != "evt-1:retry:2" {
		t.Fatalf("unexpected retry event id: %s", retryEnvelope.EventID)
	}

	var decoded contracts.DeliveryEventEnvelope
	if err := json.Unmarshal([]byte(retryEnvelope.RawEvent), &decoded); err != nil {
		t.Fatalf("decode retry envelope failed: %v", err)
	}
	var decodedPayload contracts.FanoutRequestedPayload
	if err := json.Unmarshal(decoded.Payload, &decodedPayload); err != nil {
		t.Fatalf("decode retry payload failed: %v", err)
	}
	if decoded.EventID != retryEnvelope.EventID || decodedPayload.PrimaryAttemptCount != 2 {
		t.Fatalf("unexpected retry envelope: %#v payload=%#v", decoded, decodedPayload)
	}
}
