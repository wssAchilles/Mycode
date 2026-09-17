package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	redis "github.com/redis/go-redis/v9"
)

func TestGoldenDeliveryEnvelopeRoundtrip(t *testing.T) {
	filePath := filepath.Join("..", "..", "..", "fixtures", "contracts", "golden_delivery_envelope_v1.json")
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed to read golden delivery envelope: %v", err)
	}

	msg := redis.XMessage{
		ID: "1-0",
		Values: map[string]interface{}{
			"event": string(content),
		},
	}

	envelope, err := DecodeEnvelope(msg)
	if err != nil {
		t.Fatalf("DecodeEnvelope failed on golden envelope: %v", err)
	}

	if envelope.SpecVersion != DeliveryEventSpecVersion {
		t.Fatalf("expected specVersion %s, got %s", DeliveryEventSpecVersion, envelope.SpecVersion)
	}

	payload, err := DecodeFanoutRequestedPayload(envelope)
	if err != nil {
		t.Fatalf("DecodeFanoutRequestedPayload failed: %v", err)
	}

	if payload.MessageID != "msg_golden_4001" {
		t.Fatalf("expected messageId msg_golden_4001, got %s", payload.MessageID)
	}

	if payload.SkippedReason != "none" {
		t.Fatalf("expected skippedReason 'none', got '%s'", payload.SkippedReason)
	}

	if payload.Projection == nil || payload.Projection.RecipientCount != 2 {
		t.Fatalf("expected projection with 2 recipients, got %#v", payload.Projection)
	}
}

func TestDecodeEnvelopeRejectsUnsupportedSpecVersion(t *testing.T) {
	msg := redis.XMessage{
		ID: "1-0",
		Values: map[string]interface{}{
			"event": `{"specVersion":"chat.delivery.v999","producer":"node-backend","eventId":"evt-future","topic":"fanout_requested","emittedAt":"2026-09-17T12:00:00Z","partitionKey":"p1","payload":{"messageId":"m1","chatId":"c1"}}`,
		},
	}

	_, err := DecodeEnvelope(msg)
	if err == nil {
		t.Fatalf("expected error for unsupported specVersion 'chat.delivery.v999', but got nil")
	}
}

func TestProjectionPayloadOmitempty(t *testing.T) {
	payload := ProjectionPayload{
		MessageID: "m1",
		ChatID:    "c1",
		ChatType:  "group",
		Seq:       1,
		SenderID:  "u1",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	raw := string(data)
	// 验证未初始化的可选字段未被序列化为默认零值
	if contains(raw, "outboxId") || contains(raw, "jobId") || contains(raw, "attemptCount") {
		t.Fatalf("expected omitted fields, got serialized json: %s", raw)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && filepath.Base(s) != "" && (s == substr || len(s) > 0 && len(substr) > 0 && (findSubstr(s, substr)))
}

func findSubstr(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
