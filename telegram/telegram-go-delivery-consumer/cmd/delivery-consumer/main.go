package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	consumerhttp "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/http"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/observability/profiling"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/telemetry"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid configuration: %v", err)
	}
	logger := log.New(os.Stdout, "[delivery-consumer] ", log.LstdFlags|log.Lmsgprefix)
	state := summary.New(cfg.StreamKey, cfg.ConsumerGroup, cfg.ConsumerName, cfg.ExecutionMode, cfg.DryRun)
	state.SetPlatformStreamKey(cfg.PlatformStreamKey)
	state.SetPlatformReplayStreamKey(cfg.PlatformReplayStreamKey)
	client := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddress(cfg.RedisURL),
		Password: config.RedisPassword(cfg.RedisURL),
		DB:       config.RedisDB(cfg.RedisURL),
	})
	defer client.Close()

	otelShutdown, err := telemetry.Init(context.Background(), "delivery-consumer", cfg.OTelEndpoint)
	if err != nil {
		logger.Printf("OTel init failed (non-fatal): %v", err)
	}
	defer func() {
		if shutdownErr := otelShutdown(context.Background()); shutdownErr != nil {
			logger.Printf("OTel shutdown error: %v", shutdownErr)
		}
	}()

	var primaryExecutor primary.Executor
	var primaryCloser interface {
		Close(ctx context.Context) error
	}
	if cfg.ExecutionMode == "primary" && cfg.GoPrimaryReady {
		startupCtx, cancel := context.WithTimeout(context.Background(), cfg.BlockDuration)
		executor, err := primary.NewMongoExecutor(startupCtx, cfg, client, logger)
		cancel()
		if err != nil {
			logger.Fatalf("initialize primary executor: %v", err)
		}
		primaryExecutor = executor
		primaryCloser = executor
	}
	defer func() {
		if primaryCloser == nil {
			return
		}
		closeCtx, cancel := context.WithTimeout(context.Background(), cfg.BlockDuration)
		defer cancel()
		if err := primaryCloser.Close(closeCtx); err != nil {
			logger.Printf("primary executor close error: %v", err)
		}
	}()

	dispatcher := platform.NewDispatcher(client, cfg)
	replayOperator := platform.NewReplayOperator(client, cfg, dispatcher)
	profilingServer, err := profiling.NewServer(cfg.PprofBindAddr, logger)
	if err != nil {
		logger.Fatalf("initialize pprof server: %v", err)
	}
	consumer := streamconsumer.NewWithDeps(client, cfg, state, logger, streamconsumer.Dependencies{
		PrimaryExecutor: primaryExecutor,
		Dispatcher:      dispatcher,
	})
	httpServer := consumerhttp.New(cfg.BindAddr, cfg, state, replayOperator, logger, consumer)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := consumer.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Printf("stream consumer stopped with error: %v", err)
		}
	}()

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("http server stopped with error: %v", err)
		}
	}()

	if profilingServer.Enabled() {
		go func() {
			if err := profilingServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				logger.Printf("pprof server stopped with error: %v", err)
			}
		}()
	}

	<-ctx.Done()

	drainCtx, drainCancel := context.WithTimeout(context.Background(), cfg.BlockDuration)
	consumer.Drain(drainCtx)
	drainCancel()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.BlockDuration)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Printf("http shutdown error: %v", err)
	}
	if err := profilingServer.Shutdown(shutdownCtx); err != nil {
		logger.Printf("pprof shutdown error: %v", err)
	}
}
