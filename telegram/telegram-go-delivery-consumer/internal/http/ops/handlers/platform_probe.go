package handlers

import (
	"context"
	stdhttp "net/http"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/http/ops/builders"
	runtimesnapshot "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/observability/runtime"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type ReplaySummaryBuilder interface {
	BuildSummary(ctx context.Context) (platformreplay.Summary, error)
}

func PlatformProbe(cfg config.Config, state *summary.Summary, replay ReplaySummaryBuilder) stdhttp.HandlerFunc {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if cfg.InternalToken != "" && r.Header.Get("X-Internal-Token") != cfg.InternalToken {
			writeJSON(w, stdhttp.StatusForbidden, map[string]any{"error": "forbidden"})
			return
		}
		if r.Method != stdhttp.MethodGet {
			writeJSON(w, stdhttp.StatusMethodNotAllowed, map[string]any{
				"error": "method_not_allowed",
			})
			return
		}

		snapshot := state.Snapshot()
		var replayPayload any = map[string]any{
			"available": false,
			"streamKey": cfg.PlatformReplayStreamKey,
			"error":     "platform_replay_operator_unavailable",
		}
		if replay != nil {
			payload, err := replay.BuildSummary(r.Context())
			if err != nil {
				writeJSON(w, stdhttp.StatusInternalServerError, map[string]any{
					"ok":    false,
					"error": err.Error(),
				})
				return
			}
			replayPayload = payload
		}

		writeJSON(w, stdhttp.StatusOK, builders.BuildPlatformProbe(
			cfg,
			snapshot,
			replayPayload,
			runtimesnapshot.Collect(),
		))
	}
}
