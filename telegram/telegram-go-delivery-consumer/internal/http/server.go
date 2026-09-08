package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	Ready(ctx context.Context) error
}

// ConsumerStateProvider exposes the consumer's lifecycle state for the /ops endpoint.
type ConsumerStateProvider interface {
	Snapshot() map[string]any
}

func New(
	bindAddr string,
	cfg config.Config,
	state *summary.Summary,
	replay replayOperator,
	logger *log.Logger,
	consumerState ConsumerStateProvider,
) *stdhttp.Server {
	mux := stdhttp.NewServeMux()
	mux.HandleFunc("/health", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if cfg.PlatformReplayWorkerEnabled {
			if replay == nil {
				writeJSON(w, stdhttp.StatusServiceUnavailable, map[string]any{"ok": false, "error": "platform_replay_worker_unavailable"})
				return
			}
			if err := replay.Ready(r.Context()); err != nil {
				writeJSON(w, stdhttp.StatusServiceUnavailable, map[string]any{"ok": false, "error": err.Error()})
				return
			}
		}
		writeJSON(w, stdhttp.StatusOK, map[string]any{
			"ok":            true,
			"service":       "telegram-go-delivery-consumer",
			"dryRun":        cfg.DryRun,
			"executionMode": cfg.ExecutionMode,
		})
	})
	mux.HandleFunc("/ops/summary", opshandlers.Summary(cfg, state))
	mux.HandleFunc("/ops/platform/replay/summary", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if !cfg.PlatformReplayWorkerEnabled || replay == nil {
			mode := "disabled"
			if cfg.PlatformReplayWorkerEnabled {
				mode = "continuous"
			}
			writeJSON(w, stdhttp.StatusOK, platformreplay.Summary{
				Enabled:      cfg.PlatformReplayWorkerEnabled,
				Available:    false,
				StreamKey:    cfg.PlatformReplayStreamKey,
				CompletedKey: platformreplay.CompletedKey(cfg.PlatformReplayStreamKey),
				Runtime: platformreplay.SummaryRuntime{
					Owner: "go",
					Mode:  mode,
				},
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
		if cfg.InternalToken == "" || r.Header.Get("X-Internal-Token") != cfg.InternalToken {
			writeJSON(w, stdhttp.StatusForbidden, map[string]any{"error": "forbidden"})
			return
		}
		if r.Method != stdhttp.MethodPost {
			writeJSON(w, stdhttp.StatusMethodNotAllowed, map[string]any{
				"error": "method_not_allowed",
			})
			return
		}
		if !cfg.PlatformReplayWorkerEnabled {
			writeJSON(w, stdhttp.StatusServiceUnavailable, map[string]any{
				"error": "platform_replay_worker_disabled",
			})
			return
		}
		if replay == nil {
			writeJSON(w, stdhttp.StatusServiceUnavailable, map[string]any{
				"error": "platform_replay_worker_unavailable",
			})
			return
		}

		request, err := decodeReplayDrainRequest(r.Body)
		if err != nil {
			writeJSON(w, stdhttp.StatusBadRequest, map[string]any{
				"error": err.Error(),
			})
			return
		}

		result, err := replay.Drain(r.Context(), request)
		if err != nil {
			status := stdhttp.StatusInternalServerError
			if errors.Is(err, platformreplay.ErrInvalidReplayLimit) {
				status = stdhttp.StatusBadRequest
			} else if errors.Is(err, platformreplay.ErrWorkerUnavailable) || errors.Is(err, platformreplay.ErrRedisUnavailable) {
				status = stdhttp.StatusServiceUnavailable
			}
			writeJSON(w, status, map[string]any{
				"error": err.Error(),
			})
			return
		}
		writeJSON(w, stdhttp.StatusAccepted, result)
	})
	mux.HandleFunc("/ops/platform/probe", opshandlers.PlatformProbe(cfg, state, replay))
	mux.HandleFunc("/ops/consumer", func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
		if consumerState == nil {
			writeJSON(w, stdhttp.StatusOK, map[string]any{"available": false})
			return
		}
		writeJSON(w, stdhttp.StatusOK, consumerState.Snapshot())
	})

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

func decodeReplayDrainRequest(body io.Reader) (platformreplay.DrainRequest, error) {
	fields := map[string]json.RawMessage{}
	decoder := json.NewDecoder(body)
	if err := decoder.Decode(&fields); err != nil && !errors.Is(err, io.EOF) {
		return platformreplay.DrainRequest{}, errors.New("invalid_json_body")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return platformreplay.DrainRequest{}, errors.New("invalid_json_body")
	}
	if _, exists := fields["topic"]; exists {
		return platformreplay.DrainRequest{}, errors.New("legacy_replay_filters_unsupported")
	}
	if _, exists := fields["status"]; exists {
		return platformreplay.DrainRequest{}, errors.New("legacy_replay_filters_unsupported")
	}
	for field := range fields {
		if field != "limit" {
			return platformreplay.DrainRequest{}, fmt.Errorf("unsupported_field: %s", field)
		}
	}
	request := platformreplay.DrainRequest{}
	if raw, exists := fields["limit"]; exists {
		if err := json.Unmarshal(raw, &request.Limit); err != nil || request.Limit <= 0 {
			return platformreplay.DrainRequest{}, platformreplay.ErrInvalidReplayLimit
		}
	}
	return request, nil
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
