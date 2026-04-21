package http

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type fakeReplayOperator struct {
	lastDrainRequest platformreplay.DrainRequest
}

func (f *fakeReplayOperator) BuildSummary(_ context.Context) (platformreplay.Summary, error) {
	return platformreplay.Summary{
		Available:    true,
		StreamKey:    "platform:events:replay:v1",
		CompletedKey: "platform:events:replay:v1:completed",
		Runtime: platformreplay.SummaryRuntime{
			Owner:                       "go",
			SingleTopicDrainConcurrency: 1,
			CrossTopicDrainConcurrency:  3,
		},
		Totals: platformreplay.SummaryTotals{
			Backlog:       2,
			CompletedKeys: 1,
			StatusCounts: map[string]int{
				"failed": 1,
			},
		},
		Topics: map[string]platformreplay.TopicSummary{
			"presence_fanout_requested": {
				Backlog: 1,
				StatusCounts: map[string]int{
					"failed": 1,
				},
			},
		},
	}, nil
}

func (f *fakeReplayOperator) Drain(
	_ context.Context,
	request platformreplay.DrainRequest,
) (platformreplay.DrainResult, error) {
	f.lastDrainRequest = request
	return platformreplay.DrainResult{
		StreamKey:       "platform:events:replay:v1",
		CompletedKey:    "platform:events:replay:v1:completed",
		RequestedTopic:  request.Topic,
		RequestedStatus: request.Status,
		Limit:           request.Limit,
		Attempted:       1,
		Completed:       1,
		Topics: map[string]platformreplay.DrainTopicStats{
			request.Topic: {
				Attempted: 1,
				Completed: 1,
			},
		},
	}, nil
}

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
		ProjectionChunkSize:          512,
		ConsumerGroup:                "go-primary",
		StreamKey:                    "chat:delivery:bus:v1",
		MemberStateCollection:        "memberstates",
		UpdateCounterCollection:      "updatecounters",
		UpdateLogCollection:          "updatelogs",
		PlatformStreamKey:            "platform:events:v1",
		PlatformDLQStreamKey:         "platform:events:dlq:v1",
		PlatformReplayStreamKey:      "platform:events:replay:v1",
		SyncWakeExecutionMode:        "publish",
		PresenceExecutionMode:        "publish",
		NotificationExecutionMode:    "publish",
		WakePubSubChannel:            "sync:update:wake:v1",
		PresenceOnlineChannel:        "user:online",
		PresenceOfflineChannel:       "user:offline",
		NotificationChannel:          "notification",
	}, state, &fakeReplayOperator{}, log.New(io.Discard, "", 0))

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
	if payload.Runtime["platformStreamKey"] != "platform:events:v1" {
		t.Fatalf("unexpected platform stream key: %#v", payload.Runtime["platformStreamKey"])
	}
	if payload.Runtime["projectionChunkSize"] != float64(512) {
		t.Fatalf("unexpected projection chunk size: %#v", payload.Runtime["projectionChunkSize"])
	}
	if payload.Runtime["updateLogCollection"] != "updatelogs" {
		t.Fatalf("unexpected update log collection: %#v", payload.Runtime["updateLogCollection"])
	}
	if payload.Runtime["platformReplayStreamKey"] != "platform:events:replay:v1" {
		t.Fatalf("unexpected platform replay stream key: %#v", payload.Runtime["platformReplayStreamKey"])
	}
	if payload.Runtime["platformReplayCompletedKey"] != "platform:events:replay:v1:completed" {
		t.Fatalf("unexpected platform replay completed key: %#v", payload.Runtime["platformReplayCompletedKey"])
	}
	if payload.Runtime["syncWakeExecutionMode"] != "publish" {
		t.Fatalf("unexpected sync wake mode: %#v", payload.Runtime["syncWakeExecutionMode"])
	}
	platformTopicModes, ok := payload.Runtime["platformTopicModes"].(map[string]any)
	if !ok {
		t.Fatalf("expected platformTopicModes map, got %#v", payload.Runtime["platformTopicModes"])
	}
	if platformTopicModes["presence_fanout_requested"] != "publish" {
		t.Fatalf("unexpected presence mode: %#v", platformTopicModes)
	}
}

func TestPlatformReplayEndpointsExposeSummaryAndDrain(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	replay := &fakeReplayOperator{}
	server := New("127.0.0.1:4100", config.Config{
		PlatformReplayStreamKey: "platform:events:replay:v1",
	}, state, replay, log.New(io.Discard, "", 0))

	summaryRequest := httptest.NewRequest("GET", "/ops/platform/replay/summary", nil)
	summaryRecorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(summaryRecorder, summaryRequest)
	if summaryRecorder.Code != 200 {
		t.Fatalf("expected replay summary 200, got %d", summaryRecorder.Code)
	}

	var summaryPayload platformreplay.Summary
	if err := json.Unmarshal(summaryRecorder.Body.Bytes(), &summaryPayload); err != nil {
		t.Fatalf("decode replay summary payload: %v", err)
	}
	if !summaryPayload.Available || summaryPayload.Totals.Backlog != 2 {
		t.Fatalf("unexpected replay summary payload: %#v", summaryPayload)
	}

	drainRequest := httptest.NewRequest(
		"POST",
		"/ops/platform/replay/drain",
		strings.NewReader(`{"topic":"presence_fanout_requested","status":"failed","limit":5}`),
	)
	drainRequest.Header.Set("Content-Type", "application/json")
	drainRecorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(drainRecorder, drainRequest)
	if drainRecorder.Code != 200 {
		t.Fatalf("expected replay drain 200, got %d", drainRecorder.Code)
	}
	if replay.lastDrainRequest.Topic != "presence_fanout_requested" || replay.lastDrainRequest.Status != "failed" {
		t.Fatalf("unexpected drain request forwarded to replay operator: %#v", replay.lastDrainRequest)
	}
}
