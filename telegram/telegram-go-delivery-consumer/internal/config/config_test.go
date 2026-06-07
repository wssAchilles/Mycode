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
	t.Setenv("DELIVERY_CONSUMER_PLATFORM_STREAM_KEY", "platform:test")
	t.Setenv("DELIVERY_CONSUMER_PLATFORM_REPLAY_STREAM_KEY", "platform:test:replay")
	t.Setenv("DELIVERY_CONSUMER_GROUP", "go-phase6")
	t.Setenv("DELIVERY_CONSUMER_CONSUMER_NAME", "worker-a")
	t.Setenv("DELIVERY_CONSUMER_EXECUTION_MODE", "shadow")
	t.Setenv("DELIVERY_CONSUMER_DLQ_STREAM_KEY", "chat:delivery:test:dlq")
	t.Setenv("DELIVERY_CONSUMER_PLATFORM_DLQ_STREAM_KEY", "platform:test:dlq")
	t.Setenv("DELIVERY_CONSUMER_MAX_RECIPIENTS_PER_CHUNK", "188")
	t.Setenv("DELIVERY_CONSUMER_BLOCK_MS", "900")
	t.Setenv("DELIVERY_CONSUMER_READ_COUNT", "33")
	t.Setenv("DELIVERY_CONSUMER_PENDING_IDLE_MS", "70000")
	t.Setenv("DELIVERY_CONSUMER_PENDING_CLAIM_COUNT", "11")
	t.Setenv("DELIVERY_CONSUMER_PENDING_CLAIM_INTERVAL_MS", "45000")
	t.Setenv("DELIVERY_CONSUMER_PENDING_RECLAIM_MAX_BATCHES", "7")
	t.Setenv("DELIVERY_CONSUMER_RECLAIM_CURSOR_MODE", "restart")
	t.Setenv("DELIVERY_CONSUMER_RESERVATION_CONCURRENCY", "12")
	t.Setenv("DELIVERY_CONSUMER_RESERVATION_MODE", "block")
	t.Setenv("DELIVERY_CONSUMER_RESERVATION_BATCH_SIZE", "25")
	t.Setenv("DELIVERY_CONSUMER_MONGO_IN_QUERY_CHUNK_SIZE", "1500")
	t.Setenv("DELIVERY_CONSUMER_MONGO_ENSURE_INDEXES", "true")
	t.Setenv("DELIVERY_CONSUMER_WAKE_PUBLISH_MODE", "batch")
	t.Setenv("DELIVERY_CONSUMER_WAKE_BATCH_SIZE", "40")
	t.Setenv("DELIVERY_CONSUMER_PLATFORM_REPLAY_SCAN_COUNT", "6000")
	t.Setenv("DELIVERY_CONSUMER_PPROF_BIND_ADDR", "127.0.0.1:6060")
	t.Setenv("DELIVERY_CONSUMER_WORKER_COUNT", "4")
	t.Setenv("DELIVERY_CONSUMER_ACK_BATCH_SIZE", "16")
	t.Setenv("DELIVERY_CONSUMER_SYNC_WAKE_EXECUTION_MODE", "publish")
	t.Setenv("DELIVERY_CONSUMER_PRESENCE_EXECUTION_MODE", "publish")
	t.Setenv("DELIVERY_CONSUMER_NOTIFICATION_EXECUTION_MODE", "publish")

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
	if cfg.PlatformStreamKey != "platform:test" || cfg.PlatformDLQStreamKey != "platform:test:dlq" {
		t.Fatalf("unexpected platform stream config: %#v", cfg)
	}
	if cfg.PlatformReplayStreamKey != "platform:test:replay" {
		t.Fatalf("unexpected platform replay stream key: %s", cfg.PlatformReplayStreamKey)
	}
	if cfg.ReadCount != 33 {
		t.Fatalf("unexpected read count: %d", cfg.ReadCount)
	}
	if cfg.PendingIdleDuration != 70*time.Second || cfg.PendingClaimCount != 11 || cfg.PendingClaimInterval != 45*time.Second {
		t.Fatalf("unexpected pending claim config: %#v", cfg)
	}
	if cfg.PendingReclaimMaxBatches != 7 || cfg.ReservationConcurrency != 12 || cfg.ReservationMode != ReservationModeBlock || cfg.ReservationBatchSize != 25 || cfg.MongoInQueryChunkSize != 1500 {
		t.Fatalf("unexpected throughput config: %#v", cfg)
	}
	if cfg.WakePublishMode != "batch" || cfg.WakeBatchSize != 40 {
		t.Fatalf("unexpected wake publish config: %#v", cfg)
	}
	if cfg.ReclaimCursorMode != "restart" {
		t.Fatalf("unexpected reclaim cursor mode: %s", cfg.ReclaimCursorMode)
	}
	if !cfg.MongoEnsureIndexes {
		t.Fatalf("expected mongo index ensure config to be enabled")
	}
	if cfg.PprofBindAddr != "127.0.0.1:6060" {
		t.Fatalf("unexpected pprof bind addr: %s", cfg.PprofBindAddr)
	}
	if cfg.PlatformReplayScanCount != 6000 {
		t.Fatalf("unexpected platform replay scan count: %d", cfg.PlatformReplayScanCount)
	}
	if cfg.ConsumerWorkerCount != 4 || cfg.AckBatchSize != 16 {
		t.Fatalf("unexpected consumer worker/ack config: %#v", cfg)
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
	if cfg.SyncWakeExecutionMode != "publish" || cfg.NotificationExecutionMode != "publish" || cfg.PresenceExecutionMode != "publish" {
		t.Fatalf("unexpected platform execution modes: %#v", cfg)
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

func TestLoadEnablesCanaryExecutionMode(t *testing.T) {
	t.Setenv("DELIVERY_CONSUMER_EXECUTION_MODE", "canary")
	t.Setenv("DELIVERY_CONSUMER_CANARY_STREAM_KEY", "chat:delivery:test:canary")
	t.Setenv("DELIVERY_CONSUMER_CANARY_MISMATCH_THRESHOLD", "4")
	t.Setenv("DELIVERY_CONSUMER_CANARY_DLQ_THRESHOLD", "2")

	cfg := Load()

	if cfg.ExecutionMode != "canary" {
		t.Fatalf("expected canary execution mode, got %s", cfg.ExecutionMode)
	}
	if cfg.CanaryStreamKey != "chat:delivery:test:canary" {
		t.Fatalf("unexpected canary stream key: %s", cfg.CanaryStreamKey)
	}
	if cfg.CanaryMismatchThreshold != 4 {
		t.Fatalf("unexpected canary mismatch threshold: %d", cfg.CanaryMismatchThreshold)
	}
	if cfg.CanaryDLQThreshold != 2 {
		t.Fatalf("unexpected canary dlq threshold: %d", cfg.CanaryDLQThreshold)
	}
	if cfg.DryRun {
		t.Fatalf("expected dry-run false in canary mode")
	}
}

func TestLoadEnablesPrimaryExecutionOnlyBehindHardGate(t *testing.T) {
	t.Setenv("DELIVERY_CONSUMER_EXECUTION_MODE", "primary")
	t.Setenv("DELIVERY_GO_PRIMARY_READY", "true")
	t.Setenv("DELIVERY_CONSUMER_MONGO_URL", "mongodb://mongo.internal:27017/telegram")
	t.Setenv("DELIVERY_CONSUMER_MONGO_DATABASE", "telegram")
	t.Setenv("DELIVERY_CONSUMER_PRIMARY_MAX_RECIPIENTS", "2")
	t.Setenv("DELIVERY_CONSUMER_PRIMARY_GROUP_ENABLED", "false")

	cfg := Load()

	if cfg.ExecutionMode != "primary" {
		t.Fatalf("expected primary execution mode, got %s", cfg.ExecutionMode)
	}
	if !cfg.GoPrimaryReady {
		t.Fatalf("expected Go primary hard gate to be enabled")
	}
	if cfg.MongoURL != "mongodb://mongo.internal:27017/telegram" {
		t.Fatalf("unexpected mongo url: %s", cfg.MongoURL)
	}
	if cfg.MongoDatabase != "telegram" {
		t.Fatalf("unexpected mongo database: %s", cfg.MongoDatabase)
	}
	if cfg.PrimaryMaxRecipients != 2 {
		t.Fatalf("unexpected primary max recipients: %d", cfg.PrimaryMaxRecipients)
	}
	if cfg.PrimaryGroupEnabled {
		t.Fatalf("expected group primary execution disabled by default gate")
	}
}

func TestLoadFallsBackToDefaults(t *testing.T) {
	for _, key := range []string{
		"DELIVERY_CONSUMER_BIND_ADDR",
		"DELIVERY_CONSUMER_REDIS_URL",
		"REDIS_URL",
		"DELIVERY_CONSUMER_STREAM_KEY",
		"DELIVERY_CONSUMER_PLATFORM_STREAM_KEY",
		"DELIVERY_CONSUMER_PLATFORM_REPLAY_STREAM_KEY",
		"DELIVERY_CONSUMER_GROUP",
		"DELIVERY_CONSUMER_CONSUMER_NAME",
		"DELIVERY_CONSUMER_EXECUTION_MODE",
		"DELIVERY_CONSUMER_DLQ_STREAM_KEY",
		"DELIVERY_CONSUMER_PLATFORM_DLQ_STREAM_KEY",
		"DELIVERY_CONSUMER_MAX_RECIPIENTS_PER_CHUNK",
		"DELIVERY_CONSUMER_BLOCK_MS",
		"DELIVERY_CONSUMER_READ_COUNT",
		"DELIVERY_CONSUMER_PENDING_IDLE_MS",
		"DELIVERY_CONSUMER_PENDING_CLAIM_COUNT",
		"DELIVERY_CONSUMER_PENDING_CLAIM_INTERVAL_MS",
		"DELIVERY_CONSUMER_PENDING_RECLAIM_MAX_BATCHES",
		"DELIVERY_CONSUMER_RECLAIM_CURSOR_MODE",
		"DELIVERY_CONSUMER_RESERVATION_CONCURRENCY",
		"DELIVERY_CONSUMER_RESERVATION_MODE",
		"DELIVERY_CONSUMER_RESERVATION_BATCH_SIZE",
		"DELIVERY_CONSUMER_MONGO_IN_QUERY_CHUNK_SIZE",
		"DELIVERY_CONSUMER_MONGO_ENSURE_INDEXES",
		"DELIVERY_CONSUMER_WAKE_PUBLISH_MODE",
		"DELIVERY_CONSUMER_WAKE_BATCH_SIZE",
		"DELIVERY_CONSUMER_PLATFORM_REPLAY_SCAN_COUNT",
		"DELIVERY_CONSUMER_PPROF_BIND_ADDR",
		"DELIVERY_CONSUMER_DRY_RUN",
		"DELIVERY_CONSUMER_SYNC_WAKE_EXECUTION_MODE",
		"DELIVERY_CONSUMER_PRESENCE_EXECUTION_MODE",
		"DELIVERY_CONSUMER_NOTIFICATION_EXECUTION_MODE",
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
	if cfg.PlatformStreamKey != defaultPlatformStreamKey {
		t.Fatalf("expected default platform stream key, got %s", cfg.PlatformStreamKey)
	}
	if cfg.PlatformDLQStreamKey != defaultPlatformDLQStreamKey {
		t.Fatalf("expected default platform dlq stream key, got %s", cfg.PlatformDLQStreamKey)
	}
	if cfg.PlatformReplayStreamKey != defaultPlatformReplayStreamKey {
		t.Fatalf("expected default platform replay stream key, got %s", cfg.PlatformReplayStreamKey)
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
	if cfg.PendingIdleDuration != time.Duration(defaultPendingIdleMS)*time.Millisecond {
		t.Fatalf("unexpected default pending idle")
	}
	if cfg.PendingClaimCount != defaultReadCount {
		t.Fatalf("unexpected default pending claim count")
	}
	if cfg.PendingClaimInterval != time.Duration(defaultPendingClaimIntervalMS)*time.Millisecond {
		t.Fatalf("unexpected default pending claim interval")
	}
	if cfg.PendingReclaimMaxBatches != defaultPendingReclaimMaxBatches {
		t.Fatalf("unexpected default pending reclaim max batches")
	}
	if cfg.ReclaimCursorMode != defaultReclaimCursorMode {
		t.Fatalf("unexpected default reclaim cursor mode")
	}
	if cfg.ReservationConcurrency != defaultReservationConcurrency {
		t.Fatalf("unexpected default reservation concurrency")
	}
	if cfg.ReservationMode != defaultReservationMode {
		t.Fatalf("unexpected default reservation mode")
	}
	if cfg.ReservationBatchSize != defaultReservationBatchSize {
		t.Fatalf("unexpected default reservation batch size")
	}
	if cfg.MongoInQueryChunkSize != defaultMongoInQueryChunkSize {
		t.Fatalf("unexpected default mongo in-query chunk size")
	}
	if cfg.WakePublishMode != defaultWakePublishMode || cfg.WakeBatchSize != defaultWakeBatchSize {
		t.Fatalf("unexpected wake publish defaults: %#v", cfg)
	}
	if cfg.MongoEnsureIndexes {
		t.Fatalf("expected mongo index ensure to default false")
	}
	if cfg.PlatformReplayScanCount != defaultPlatformReplayScanCount {
		t.Fatalf("unexpected default platform replay scan count")
	}
	if cfg.PprofBindAddr != "" {
		t.Fatalf("expected pprof bind addr to default empty")
	}
	if cfg.ConsumerWorkerCount != defaultConsumerWorkerCount || cfg.AckBatchSize != defaultAckBatchSize {
		t.Fatalf("unexpected worker/ack defaults: %#v", cfg)
	}
	if cfg.MaxRecipientsPerChunk != defaultChunkMax {
		t.Fatalf("unexpected default chunk max")
	}
	if cfg.SyncWakeExecutionMode != "publish" || cfg.PresenceExecutionMode != "publish" || cfg.NotificationExecutionMode != "publish" {
		t.Fatalf("expected platform topics to default to publish, got %#v", cfg)
	}
	if !cfg.DryRun {
		t.Fatalf("expected dry-run default true")
	}
}
