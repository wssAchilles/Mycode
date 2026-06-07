package wake

import (
	"encoding/json"
	"testing"
)

func TestEncodeBatchPreservesUpdates(t *testing.T) {
	encoded, err := EncodeBatch([]Payload{
		{UserID: "u1", UpdateID: 11},
		{UserID: "u2", UpdateID: 12},
	})
	if err != nil {
		t.Fatalf("encode wake batch: %v", err)
	}

	var payload BatchPayload
	if err := json.Unmarshal([]byte(encoded), &payload); err != nil {
		t.Fatalf("decode wake batch: %v", err)
	}
	if len(payload.Updates) != 2 || payload.Updates[0].UserID != "u1" || payload.Updates[1].UpdateID != 12 {
		t.Fatalf("unexpected wake batch payload: %#v", payload)
	}
}
