package http

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	stdhttp "net/http"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	platformops "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/ops"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type replayOperator interface {
	BuildSummary(ctx context.Context) (platformreplay.Summary, error)
	Drain(ctx context.Context, request platformreplay.DrainRequest) (platformreplay.DrainResult, error)
}

func resolveTakeoverStage(cfg config.Config) string {
	if cfg.ExecutionMode != "primary" || !cfg.GoPrimaryReady {
		return cfg.ExecutionMode
	}
	if cfg.PrimaryPrivateEnabled && cfg.PrimaryGroupEnabled {
		if cfg.PrimaryGroupRolloutPercent >= 100 {
			return "full_primary"
		}
		return "group_canary"
	}
	if cfg.PrimaryPrivateEnabled {
		return "private_primary"
	}
	if cfg.PrimaryGroupEnabled {
		if cfg.PrimaryGroupRolloutPercent >= 100 {
			return "full_primary"
		}
		return "group_canary"
	}
	return cfg.ExecutionMode
}

func resolveSegmentStages(cfg config.Config) map[string]string {
	stage := resolveTakeoverStage(cfg)
	privateStage := "node_primary"
	groupStage := "node_primary"

	if cfg.PrimaryPrivateEnabled && (stage == "private_primary" || stage == "group_canary" || stage == "full_primary") {
		privateStage = "go_primary"
	}
	if cfg.PrimaryGroupEnabled {
		if stage == "group_canary" {
			groupStage = "go_group_canary"
		} else if stage == "full_primary" {
			groupStage = "go_primary"
		}
	}

	return map[string]string{
		"private": privateStage,
		"group":   groupStage,
	}
}

func resolveFallbackStrategy(cfg config.Config) string {
	if cfg.ExecutionMode == "primary" && cfg.GoPrimaryReady {
		return "fallback_only"
	}
	return "node_primary"
}

func New(
	bindAddr string,
	cfg config.Config,
	state *summary.Summary,
	replay replayOperator,
	logger *log.Logger,
) *stdhttp.Server {
	mux := stdhttp.NewServeMux()
	mux.HandleFunc("/health", func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
		writeJSON(w, stdhttp.StatusOK, map[string]any{
			"ok":            true,
			"service":       "telegram-go-delivery-consumer",
			"dryRun":        cfg.DryRun,
			"executionMode": cfg.ExecutionMode,
		})
	})
	mux.HandleFunc("/ops/summary", func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
		takeoverStage := resolveTakeoverStage(cfg)
		writeJSON(w, stdhttp.StatusOK, map[string]any{
			"summary": state.Snapshot(),
			"runtime": map[string]any{
				"executionMode":                             cfg.ExecutionMode,
				"takeoverStage":                             takeoverStage,
				"segmentStages":                             resolveSegmentStages(cfg),
				"fallbackStrategy":                          resolveFallbackStrategy(cfg),
				"goPrimaryReady":                            cfg.GoPrimaryReady,
				"nodeFallbackOnly":                          cfg.ExecutionMode == "primary" && cfg.GoPrimaryReady,
				"primaryMaxRecipients":                      cfg.PrimaryMaxRecipients,
				"primaryPrivateMaxRecipients":               cfg.PrimaryMaxRecipients,
				"primaryGroupMaxRecipients":                 cfg.PrimaryGroupMaxRecipients,
				"primaryMaxAttempts":                        cfg.PrimaryMaxAttempts,
				"primaryPrivateEnabled":                     cfg.PrimaryPrivateEnabled,
				"primaryGroupEnabled":                       cfg.PrimaryGroupEnabled,
				"primaryPrivateRolloutPercent":              cfg.PrimaryPrivateRolloutPercent,
				"primaryGroupRolloutPercent":                cfg.PrimaryGroupRolloutPercent,
				"streamKey":                                 cfg.StreamKey,
				"platformStreamKey":                         cfg.PlatformStreamKey,
				"platformDLQStreamKey":                      cfg.PlatformDLQStreamKey,
				"platformReplayStreamKey":                   cfg.PlatformReplayStreamKey,
				"platformReplayCompletedKey":                platformreplay.CompletedKey(cfg.PlatformReplayStreamKey),
				"platformReplaySingleTopicDrainConcurrency": platformreplay.SingleTopicDrainConcurrency,
				"platformReplayCrossTopicDrainConcurrency":  platformreplay.CrossTopicDrainConcurrency,
				"platformTopicModes":                        platformops.TopicModes(cfg),
				"platformTopics":                            platformops.TopicCatalog(cfg),
				"consumerGroup":                             cfg.ConsumerGroup,
				"syncWakeExecutionMode":                     cfg.SyncWakeExecutionMode,
				"presenceExecutionMode":                     cfg.PresenceExecutionMode,
				"notificationExecutionMode":                 cfg.NotificationExecutionMode,
				"wakePubSubChannel":                         cfg.WakePubSubChannel,
				"presenceOnlineChannel":                     cfg.PresenceOnlineChannel,
				"presenceOfflineChannel":                    cfg.PresenceOfflineChannel,
				"notificationChannel":                       cfg.NotificationChannel,
			},
		})
	})
	mux.HandleFunc("/ops/platform/replay/summary", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if replay == nil {
			writeJSON(w, stdhttp.StatusOK, platformreplay.Summary{
				Available:    false,
				StreamKey:    cfg.PlatformReplayStreamKey,
				CompletedKey: platformreplay.CompletedKey(cfg.PlatformReplayStreamKey),
				Runtime: platformreplay.SummaryRuntime{
					Owner:                       "go",
					SingleTopicDrainConcurrency: platformreplay.SingleTopicDrainConcurrency,
					CrossTopicDrainConcurrency:  platformreplay.CrossTopicDrainConcurrency,
				},
				Totals: platformreplay.SummaryTotals{
					StatusCounts: map[string]int{},
				},
				Topics: map[string]platformreplay.TopicSummary{},
			})
			return
		}

		payload, err := replay.BuildSummary(r.Context())
		if err != nil {
			writeJSON(w, stdhttp.StatusInternalServerError, map[string]any{
				"available": false,
				"streamKey": cfg.PlatformReplayStreamKey,
				"error":     err.Error(),
			})
			return
		}
		writeJSON(w, stdhttp.StatusOK, payload)
	})
	mux.HandleFunc("/ops/platform/replay/drain", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if r.Method != stdhttp.MethodPost {
			writeJSON(w, stdhttp.StatusMethodNotAllowed, map[string]any{
				"error": "method_not_allowed",
			})
			return
		}
		if replay == nil {
			writeJSON(w, stdhttp.StatusServiceUnavailable, map[string]any{
				"error": "platform_replay_operator_unavailable",
			})
			return
		}

		var request platformreplay.DrainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, stdhttp.StatusBadRequest, map[string]any{
				"error": "invalid_json_body",
			})
			return
		}

		result, err := replay.Drain(r.Context(), request)
		if err != nil {
			status := stdhttp.StatusInternalServerError
			if errors.Is(err, platformreplay.ErrUnsupportedReplayStatus) {
				status = stdhttp.StatusBadRequest
			}
			writeJSON(w, status, map[string]any{
				"error": err.Error(),
			})
			return
		}
		writeJSON(w, stdhttp.StatusOK, result)
	})

	return &stdhttp.Server{
		Addr:    bindAddr,
		Handler: requestLogger(mux, logger),
	}
}

func requestLogger(next stdhttp.Handler, logger *log.Logger) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		logger.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w stdhttp.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
