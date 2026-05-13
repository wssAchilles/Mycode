package wake

import (
	"encoding/json"
	"testing"
)

func TestEncodeBuildsWakePayload(t *testing.T) {
	raw, err := Encode("u1", 42)
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}

	var payload Payload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("decode wake payload: %v", err)
	}
	if payload.UserID != "u1" || payload.UpdateID != 42 {
		t.Fatalf("unexpected wake payload: %#v", payload)
	}
}
