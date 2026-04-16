package http

import (
	"encoding/json"
	"io"
	"log"
	"net/http/httptest"
	"testing"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func TestOpsSummaryReportsFullPrimarySegmentStages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	server := New("127.0.0.1:4100", config.Config{
		ExecutionMode:                "primary",
		GoPrimaryReady:               true,
		PrimaryPrivateEnabled:        true,
		PrimaryGroupEnabled:          true,
		PrimaryPrivateRolloutPercent: 100,
		PrimaryGroupRolloutPercent:   100,
		PrimaryMaxRecipients:         2,
		PrimaryGroupMaxRecipients:    32,
		ConsumerGroup:                "go-primary",
		StreamKey:                    "chat:delivery:bus:v1",
	}, state, log.New(io.Discard, "", 0))

	req := httptest.NewRequest("GET", "/ops/summary", nil)
	recorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(recorder, req)

	if recorder.Code != 200 {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload struct {
		Runtime map[string]any `json:"runtime"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode summary payload: %v", err)
	}

	if payload.Runtime["takeoverStage"] != "full_primary" {
		t.Fatalf("expected full_primary takeover stage, got %#v", payload.Runtime["takeoverStage"])
	}
	if payload.Runtime["fallbackStrategy"] != "fallback_only" {
		t.Fatalf("expected fallback_only strategy, got %#v", payload.Runtime["fallbackStrategy"])
	}
	segmentStages, ok := payload.Runtime["segmentStages"].(map[string]any)
	if !ok {
		t.Fatalf("expected segment stages map, got %#v", payload.Runtime["segmentStages"])
	}
	if segmentStages["private"] != "go_primary" || segmentStages["group"] != "go_primary" {
		t.Fatalf("unexpected segment stages: %#v", segmentStages)
	}
}
