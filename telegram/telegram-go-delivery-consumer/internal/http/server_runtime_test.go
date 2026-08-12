package http

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type fakeReplayOperator struct {
	lastDrainRequest platformreplay.DrainRequest
	drainCalls       int
	drainErr         error
}

func (f *fakeReplayOperator) BuildSummary(_ context.Context) (platformreplay.Summary, error) {
	return platformreplay.Summary{
		Enabled:      true,
		Available:    true,
		StreamKey:    "platform:events:replay:v1",
		CompletedKey: "platform:events:replay:v1:completed",
		Runtime:      platformreplay.SummaryRuntime{Owner: "go"},
	}, nil
}

func (f *fakeReplayOperator) Ready(context.Context) error {
	return nil
}

func (f *fakeReplayOperator) Drain(
	_ context.Context,
	request platformreplay.DrainRequest,
) (platformreplay.DrainResult, error) {
	f.lastDrainRequest = request
	f.drainCalls++
	if request.Limit > 200 {
		return platformreplay.DrainResult{}, platformreplay.ErrInvalidReplayLimit
	}
	if f.drainErr != nil {
		return platformreplay.DrainResult{}, f.drainErr
	}
	return platformreplay.DrainResult{
		RunID: "run-1",
		Limit: request.Limit,
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
		PlatformReplayWorkerEnabled:  false,
		SyncWakeExecutionMode:        "publish",
		PresenceExecutionMode:        "publish",
		NotificationExecutionMode:    "publish",
		WakePubSubChannel:            "sync:update:wake:v1",
		PresenceOnlineChannel:        "user:online",
		PresenceOfflineChannel:       "user:offline",
		NotificationChannel:          "notification",
		PendingIdleDuration:          60 * time.Second,
		PendingClaimCount:            33,
		PendingClaimInterval:         30 * time.Second,
		PendingReclaimMaxBatches:     4,
		ReclaimCursorMode:            "resume",
		ReservationConcurrency:       8,
		MongoInQueryChunkSize:        1000,
		MongoEnsureIndexes:           true,
		PprofBindAddr:                "127.0.0.1:6060",
	}, state, &fakeReplayOperator{}, log.New(io.Discard, "", 0), nil)

	req := httptest.NewRequest("GET", "/ops/summary", nil)
	recorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(recorder, req)

	if recorder.Code != 200 {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload struct {
		Runtime      map[string]any `json:"runtime"`
		ControlPlane map[string]any `json:"controlPlane"`
		RuntimeStats map[string]any `json:"runtimeStats"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode summary payload: %v", err)
	}

	if payload.Runtime["takeoverStage"] != "full_primary" {
		t.Fatalf("expected full_primary takeover stage, got %#v", payload.Runtime["takeoverStage"])
	}
	if payload.RuntimeStats["goroutines"] == nil || payload.RuntimeStats["heapSysBytes"] == nil {
		t.Fatalf("expected runtime stats in ops summary, got %#v", payload.RuntimeStats)
	}
	if payload.ControlPlane["contractVersion"] != "delivery_consumer_ops_summary_v2" {
		t.Fatalf("unexpected control plane contract version: %#v", payload.ControlPlane)
	}
	reclaim, ok := payload.ControlPlane["reclaim"].(map[string]any)
	if !ok || reclaim["pendingReclaimMaxBatches"] != float64(4) {
		t.Fatalf("unexpected reclaim control plane summary: %#v", payload.ControlPlane)
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
	if _, exists := payload.Runtime["platformReplayScanCount"]; exists {
		t.Fatalf("legacy replay scan count leaked into runtime output: %#v", payload.Runtime)
	}
	if payload.Runtime["platformReplayWorkerEnabled"] != false {
		t.Fatalf("unexpected replay worker authorization: %#v", payload.Runtime)
	}
	if payload.Runtime["pendingIdleMs"] != float64(60000) || payload.Runtime["pendingClaimCount"] != float64(33) || payload.Runtime["pendingClaimIntervalMs"] != float64(30000) {
		t.Fatalf("unexpected pending reclaim config: %#v", payload.Runtime)
	}
	if payload.Runtime["pendingReclaimMaxBatches"] != float64(4) || payload.Runtime["reservationConcurrency"] != float64(8) || payload.Runtime["mongoInQueryChunkSize"] != float64(1000) {
		t.Fatalf("unexpected throughput runtime config: %#v", payload.Runtime)
	}
	if payload.Runtime["reclaimCursorMode"] != "resume" || payload.Runtime["mongoEnsureIndexes"] != true {
		t.Fatalf("unexpected extended throughput config: %#v", payload.Runtime)
	}
	if payload.Runtime["pprofEnabled"] != true || payload.Runtime["pprofLoopbackOnly"] != true {
		t.Fatalf("unexpected pprof runtime config: %#v", payload.Runtime)
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

func TestPlatformReplayDrainV2AcceptsOnlyOptionalPositiveLimit(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	replay := &fakeReplayOperator{}
	server := New("127.0.0.1:4100", config.Config{
		PlatformReplayStreamKey:     "platform:events:replay:v1",
		PlatformReplayWorkerEnabled: true,
		InternalToken:               "secret",
	}, state, replay, log.New(io.Discard, "", 0), nil)

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
	if !summaryPayload.Available {
		t.Fatalf("unexpected replay summary payload: %#v", summaryPayload)
	}

	for _, test := range []struct {
		name       string
		body       string
		token      string
		wantStatus int
		wantLimit  int
		wantDrain  bool
	}{
		{name: "empty", body: `{}`, token: "secret", wantStatus: 202, wantDrain: true},
		{name: "positive limit", body: `{"limit":5}`, token: "secret", wantStatus: 202, wantLimit: 5, wantDrain: true},
		{name: "limit above maximum", body: `{"limit":201}`, token: "secret", wantStatus: 400, wantDrain: true},
		{name: "legacy topic", body: `{"topic":"presence_fanout_requested"}`, token: "secret", wantStatus: 400},
		{name: "legacy status", body: `{"status":"failed"}`, token: "secret", wantStatus: 400},
		{name: "zero limit", body: `{"limit":0}`, token: "secret", wantStatus: 400},
		{name: "negative limit", body: `{"limit":-1}`, token: "secret", wantStatus: 400},
		{name: "unknown field", body: `{"force":true}`, token: "secret", wantStatus: 400},
		{name: "missing token", body: `{}`, wantStatus: 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			before := replay.drainCalls
			request := httptest.NewRequest("POST", "/ops/platform/replay/drain", strings.NewReader(test.body))
			request.Header.Set("X-Internal-Token", test.token)
			recorder := httptest.NewRecorder()
			server.Handler.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("expected %d, got %d: %s", test.wantStatus, recorder.Code, recorder.Body.String())
			}
			called := replay.drainCalls == before+1
			if called != test.wantDrain {
				t.Fatalf("worker call mismatch: called=%t want=%t", called, test.wantDrain)
			}
			if test.wantStatus != 202 {
				return
			}
			if replay.lastDrainRequest.Limit != test.wantLimit {
				t.Fatalf("unexpected forwarded limit: %#v", replay.lastDrainRequest)
			}
			var payload platformreplay.DrainResult
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || payload.RunID == "" {
				t.Fatalf("expected accepted run id, got %#v (%v)", payload, err)
			}
		})
	}
}

func TestPlatformReplayDrainFailsClosedWhenWorkerOrRedisUnavailable(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	for _, test := range []struct {
		name          string
		internalToken string
		replayEnabled bool
		replay        *fakeReplayOperator
		wantStatus    int
	}{
		{name: "internal token not configured", replayEnabled: true, replay: &fakeReplayOperator{}, wantStatus: 403},
		{name: "worker unavailable", internalToken: "secret", replayEnabled: true, wantStatus: 503},
		{name: "redis unavailable", internalToken: "secret", replayEnabled: true, replay: &fakeReplayOperator{drainErr: platformreplay.ErrRedisUnavailable}, wantStatus: 503},
	} {
		t.Run(test.name, func(t *testing.T) {
			var replay replayOperator
			if test.replay != nil {
				replay = test.replay
			}
			server := New("127.0.0.1:4100", config.Config{
				InternalToken:               test.internalToken,
				PlatformReplayWorkerEnabled: test.replayEnabled,
			}, state, replay, log.New(io.Discard, "", 0), nil)
			request := httptest.NewRequest("POST", "/ops/platform/replay/drain", strings.NewReader(`{}`))
			request.Header.Set("X-Internal-Token", "secret")
			recorder := httptest.NewRecorder()
			server.Handler.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("expected fail-closed %d, got %d: %s", test.wantStatus, recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestReplayWorkerAuthorizationPreservesHealthAndExposesDisabledState(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "shadow", false)
	disabled := New("127.0.0.1:4100", config.Config{
		InternalToken:           "secret",
		PlatformReplayStreamKey: "platform:events:replay:v1",
	}, state, nil, log.New(io.Discard, "", 0), nil)

	healthRequest := httptest.NewRequest("GET", "/health", nil)
	healthRecorder := httptest.NewRecorder()
	disabled.Handler.ServeHTTP(healthRecorder, healthRequest)
	if healthRecorder.Code != 200 {
		t.Fatalf("disabled replay worker made service unhealthy: %d", healthRecorder.Code)
	}

	summaryRequest := httptest.NewRequest("GET", "/ops/platform/replay/summary", nil)
	summaryRecorder := httptest.NewRecorder()
	disabled.Handler.ServeHTTP(summaryRecorder, summaryRequest)
	var replaySummary platformreplay.Summary
	if err := json.Unmarshal(summaryRecorder.Body.Bytes(), &replaySummary); err != nil {
		t.Fatalf("decode disabled replay summary: %v", err)
	}
	if replaySummary.Enabled || replaySummary.Available {
		t.Fatalf("disabled replay summary was not truthful: %#v", replaySummary)
	}

	probeRequest := httptest.NewRequest("GET", "/ops/platform/probe", nil)
	probeRequest.Header.Set("X-Internal-Token", "secret")
	probeRecorder := httptest.NewRecorder()
	disabled.Handler.ServeHTTP(probeRecorder, probeRequest)
	var probe struct {
		Replay map[string]any `json:"replay"`
	}
	if err := json.Unmarshal(probeRecorder.Body.Bytes(), &probe); err != nil {
		t.Fatalf("decode disabled replay probe: %v", err)
	}
	if probe.Replay["enabled"] != false || probe.Replay["available"] != false {
		t.Fatalf("disabled replay probe was not truthful: %#v", probe.Replay)
	}

	drainRequest := httptest.NewRequest("POST", "/ops/platform/replay/drain", strings.NewReader(`{}`))
	drainRequest.Header.Set("X-Internal-Token", "secret")
	drainRecorder := httptest.NewRecorder()
	disabled.Handler.ServeHTTP(drainRecorder, drainRequest)
	if drainRecorder.Code != 503 {
		t.Fatalf("disabled replay drain must fail closed, got %d", drainRecorder.Code)
	}

	enabled := New("127.0.0.1:4100", config.Config{PlatformReplayWorkerEnabled: true}, state, nil, log.New(io.Discard, "", 0), nil)
	enabledHealth := httptest.NewRecorder()
	enabled.Handler.ServeHTTP(enabledHealth, httptest.NewRequest("GET", "/health", nil))
	if enabledHealth.Code != 503 {
		t.Fatalf("enabled replay without worker must be unhealthy, got %d", enabledHealth.Code)
	}
}

func TestPlatformProbeRequiresInternalTokenAndReportsRuntime(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	replay := &fakeReplayOperator{}
	unconfiguredServer := New("127.0.0.1:4100", config.Config{}, state, replay, log.New(io.Discard, "", 0), nil)
	unconfiguredRequest := httptest.NewRequest("GET", "/ops/platform/probe", nil)
	unconfiguredRecorder := httptest.NewRecorder()
	unconfiguredServer.Handler.ServeHTTP(unconfiguredRecorder, unconfiguredRequest)
	if unconfiguredRecorder.Code != 403 {
		t.Fatalf("expected forbidden probe when internal token is unconfigured, got %d", unconfiguredRecorder.Code)
	}

	server := New("127.0.0.1:4100", config.Config{
		InternalToken:               "secret",
		PlatformReplayWorkerEnabled: true,
		ExecutionMode:               "primary",
		StreamKey:                   "chat:delivery:bus:v1",
		PlatformStreamKey:           "platform:events:v1",
		PlatformReplayStreamKey:     "platform:events:replay:v1",
		PendingReclaimMaxBatches:    4,
		PendingClaimCount:           32,
		PendingClaimInterval:        30 * time.Second,
		ReservationConcurrency:      8,
		MongoInQueryChunkSize:       1000,
		SyncWakeExecutionMode:       "publish",
		PresenceExecutionMode:       "publish",
		NotificationExecutionMode:   "publish",
	}, state, replay, log.New(io.Discard, "", 0), nil)

	forbiddenRequest := httptest.NewRequest("GET", "/ops/platform/probe", nil)
	forbiddenRecorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(forbiddenRecorder, forbiddenRequest)
	if forbiddenRecorder.Code != 403 {
		t.Fatalf("expected forbidden probe without internal token, got %d", forbiddenRecorder.Code)
	}

	probeRequest := httptest.NewRequest("GET", "/ops/platform/probe", nil)
	probeRequest.Header.Set("X-Internal-Token", "secret")
	probeRecorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(probeRecorder, probeRequest)
	if probeRecorder.Code != 200 {
		t.Fatalf("expected probe 200, got %d", probeRecorder.Code)
	}

	var payload struct {
		OK                  bool           `json:"ok"`
		Service             string         `json:"service"`
		ContractVersion     string         `json:"contractVersion"`
		CheckedCapabilities []string       `json:"checkedCapabilities"`
		Consumer            map[string]any `json:"consumer"`
		Replay              map[string]any `json:"replay"`
		Runtime             map[string]any `json:"runtime"`
		RuntimeStat         map[string]any `json:"runtimeStats"`
	}
	if err := json.Unmarshal(probeRecorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode platform probe payload: %v", err)
	}
	if !payload.OK || payload.Service != "telegram-go-delivery-consumer" {
		t.Fatalf("unexpected probe identity: %#v", payload)
	}
	if payload.ContractVersion != "delivery_consumer_platform_probe_v1" {
		t.Fatalf("unexpected probe contract version: %#v", payload)
	}
	if len(payload.CheckedCapabilities) == 0 {
		t.Fatalf("expected checked capabilities in probe: %#v", payload)
	}
	if payload.Consumer["streamKey"] != "chat:delivery:bus:v1" {
		t.Fatalf("unexpected consumer stream key: %#v", payload.Consumer)
	}
	if payload.Runtime["pendingReclaimMaxBatches"] != float64(4) || payload.Runtime["reservationConcurrency"] != float64(8) {
		t.Fatalf("unexpected probe runtime: %#v", payload.Runtime)
	}
	if payload.Replay["available"] != true {
		t.Fatalf("expected replay summary in probe, got %#v", payload.Replay)
	}
	if payload.RuntimeStat["goroutines"] == nil {
		t.Fatalf("expected runtime stats in probe, got %#v", payload.RuntimeStat)
	}
}
