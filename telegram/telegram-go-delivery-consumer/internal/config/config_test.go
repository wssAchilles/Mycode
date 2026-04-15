package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadUsesDeliverySpecificEnv(t *testing.T) {
	t.Setenv("DELIVERY_CONSUMER_BIND_ADDR", "0.0.0.0:5100")
	t.Setenv("DELIVERY_CONSUMER_REDIS_URL", "redis://user:pass@redis.internal:6380/2")
	t.Setenv("DELIVERY_CONSUMER_STREAM_KEY", "chat:delivery:test")
	t.Setenv("DELIVERY_CONSUMER_GROUP", "go-phase6")
	t.Setenv("DELIVERY_CONSUMER_CONSUMER_NAME", "worker-a")
	t.Setenv("DELIVERY_CONSUMER_EXECUTION_MODE", "shadow")
	t.Setenv("DELIVERY_CONSUMER_DLQ_STREAM_KEY", "chat:delivery:test:dlq")
	t.Setenv("DELIVERY_CONSUMER_MAX_RECIPIENTS_PER_CHUNK", "188")
	t.Setenv("DELIVERY_CONSUMER_BLOCK_MS", "900")
	t.Setenv("DELIVERY_CONSUMER_READ_COUNT", "33")

	cfg := Load()

	if cfg.BindAddr != "0.0.0.0:5100" {
		t.Fatalf("expected bind addr override, got %s", cfg.BindAddr)
	}
	if cfg.RedisURL != "redis://user:pass@redis.internal:6380/2" {
		t.Fatalf("unexpected redis url: %s", cfg.RedisURL)
	}
	if cfg.BlockDuration != 900*time.Millisecond {
		t.Fatalf("unexpected block duration: %v", cfg.BlockDuration)
	}
	if cfg.ReadCount != 33 {
		t.Fatalf("unexpected read count: %d", cfg.ReadCount)
	}
	if cfg.ExecutionMode != "shadow" {
		t.Fatalf("expected shadow execution mode, got %s", cfg.ExecutionMode)
	}
	if cfg.DLQStreamKey != "chat:delivery:test:dlq" {
		t.Fatalf("unexpected dlq stream key: %s", cfg.DLQStreamKey)
	}
	if cfg.MaxRecipientsPerChunk != 188 {
		t.Fatalf("unexpected max recipients per chunk: %d", cfg.MaxRecipientsPerChunk)
	}
	if cfg.DryRun {
		t.Fatalf("expected dry-run false")
	}
	if RedisAddress(cfg.RedisURL) != "redis.internal:6380" {
		t.Fatalf("unexpected redis address")
	}
	if RedisPassword(cfg.RedisURL) != "pass" {
		t.Fatalf("unexpected redis password")
	}
	if RedisDB(cfg.RedisURL) != 2 {
		t.Fatalf("unexpected redis db")
	}
}

func TestLoadFallsBackToDefaults(t *testing.T) {
	for _, key := range []string{
		"DELIVERY_CONSUMER_BIND_ADDR",
		"DELIVERY_CONSUMER_REDIS_URL",
		"REDIS_URL",
		"DELIVERY_CONSUMER_STREAM_KEY",
		"DELIVERY_CONSUMER_GROUP",
		"DELIVERY_CONSUMER_CONSUMER_NAME",
		"DELIVERY_CONSUMER_EXECUTION_MODE",
		"DELIVERY_CONSUMER_DLQ_STREAM_KEY",
		"DELIVERY_CONSUMER_MAX_RECIPIENTS_PER_CHUNK",
		"DELIVERY_CONSUMER_BLOCK_MS",
		"DELIVERY_CONSUMER_READ_COUNT",
		"DELIVERY_CONSUMER_DRY_RUN",
	} {
		_ = os.Unsetenv(key)
	}

	cfg := Load()
	if cfg.BindAddr != defaultBindAddr {
		t.Fatalf("expected default bind addr, got %s", cfg.BindAddr)
	}
	if cfg.StreamKey != defaultStreamKey {
		t.Fatalf("expected default stream key, got %s", cfg.StreamKey)
	}
	if cfg.DLQStreamKey != defaultDLQStreamKey {
		t.Fatalf("expected default dlq stream key, got %s", cfg.DLQStreamKey)
	}
	if cfg.ConsumerGroup != defaultConsumerGroup {
		t.Fatalf("expected default group, got %s", cfg.ConsumerGroup)
	}
	if cfg.ExecutionMode != "dry-run" {
		t.Fatalf("expected default execution mode to follow dry-run compatibility, got %s", cfg.ExecutionMode)
	}
	if cfg.BlockDuration != time.Duration(defaultBlockMS)*time.Millisecond {
		t.Fatalf("unexpected default block duration")
	}
	if cfg.MaxRecipientsPerChunk != defaultChunkMax {
		t.Fatalf("unexpected default chunk max")
	}
	if !cfg.DryRun {
		t.Fatalf("expected dry-run default true")
	}
}
