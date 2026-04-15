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
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func main() {
	cfg := config.Load()
	logger := log.New(os.Stdout, "[delivery-consumer] ", log.LstdFlags|log.Lmsgprefix)
	state := summary.New(cfg.StreamKey, cfg.ConsumerGroup, cfg.ConsumerName, cfg.DryRun)
	client := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddress(cfg.RedisURL),
		Password: config.RedisPassword(cfg.RedisURL),
		DB:       config.RedisDB(cfg.RedisURL),
	})
	defer client.Close()

	consumer := streamconsumer.New(client, cfg, state, logger)
	httpServer := consumerhttp.New(cfg.BindAddr, cfg, state, logger)

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

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.BlockDuration)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Printf("http shutdown error: %v", err)
	}
}
