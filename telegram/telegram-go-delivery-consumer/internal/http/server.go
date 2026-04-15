package http

import (
	"encoding/json"
	"log"
	stdhttp "net/http"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func New(bindAddr string, cfg config.Config, state *summary.Summary, logger *log.Logger) *stdhttp.Server {
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
		writeJSON(w, stdhttp.StatusOK, map[string]any{
			"summary": state.Snapshot(),
		})
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
