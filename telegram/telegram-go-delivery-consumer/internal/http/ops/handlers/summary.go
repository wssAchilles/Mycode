package handlers

import (
	stdhttp "net/http"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/http/ops/builders"
	runtimesnapshot "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/observability/runtime"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func Summary(cfg config.Config, state *summary.Summary) stdhttp.HandlerFunc {
	return func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
		snapshot := state.Snapshot()
		writeJSON(w, stdhttp.StatusOK, map[string]any{
			"summary":      snapshot,
			"controlPlane": builders.BuildControlPlane(cfg, snapshot),
			"runtime":      builders.BuildRuntime(cfg),
			"runtimeStats": runtimesnapshot.Collect(),
		})
	}
}
