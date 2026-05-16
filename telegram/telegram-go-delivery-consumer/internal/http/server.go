package http

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	stdhttp "net/http"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	opshandlers "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/http/ops/handlers"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type replayOperator interface {
	BuildSummary(ctx context.Context) (platformreplay.Summary, error)
	Drain(ctx context.Context, request platformreplay.DrainRequest) (platformreplay.DrainResult, error)
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
	mux.HandleFunc("/ops/summary", opshandlers.Summary(cfg, state))
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
		if cfg.InternalToken != "" && r.Header.Get("X-Internal-Token") != cfg.InternalToken {
			writeJSON(w, stdhttp.StatusForbidden, map[string]any{"error": "forbidden"})
			return
		}
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
	mux.HandleFunc("/ops/platform/probe", opshandlers.PlatformProbe(cfg, state, replay))

	return &stdhttp.Server{
		Addr:              bindAddr,
		Handler:           requestLogger(mux, logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
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
