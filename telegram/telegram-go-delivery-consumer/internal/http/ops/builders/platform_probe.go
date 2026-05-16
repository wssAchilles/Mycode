package builders

import (
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/http/ops/contracts"
	runtimesnapshot "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/observability/runtime"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func BuildPlatformProbe(
	cfg config.Config,
	snapshot summary.Snapshot,
	replayPayload any,
	runtimeStats runtimesnapshot.Snapshot,
) contracts.PlatformProbe {
	return contracts.PlatformProbe{
		OK:              true,
		Service:         "telegram-go-delivery-consumer",
		ContractVersion: contracts.PlatformProbeContractVersion,
		CheckedAt:       time.Now().UTC().Format(time.RFC3339),
		Consumer:        snapshot,
		Replay:          replayPayload,
		RuntimeStats:    runtimeStats,
		CheckedCapabilities: []string{
			"consumer_summary",
			"platform_replay_summary",
			"runtime_stats",
			"pending_reclaim_config",
		},
		Runtime: map[string]any{
			"executionMode":             cfg.ExecutionMode,
			"streamKey":                 cfg.StreamKey,
			"platformStreamKey":         cfg.PlatformStreamKey,
			"platformReplayStreamKey":   cfg.PlatformReplayStreamKey,
			"platformReplayScanCount":   cfg.PlatformReplayScanCount,
			"pendingReclaimMaxBatches":  cfg.PendingReclaimMaxBatches,
			"pendingClaimCount":         cfg.PendingClaimCount,
			"pendingClaimIntervalMs":    cfg.PendingClaimInterval.Milliseconds(),
			"reservationConcurrency":    cfg.ReservationConcurrency,
			"mongoInQueryChunkSize":     cfg.MongoInQueryChunkSize,
			"syncWakeExecutionMode":     cfg.SyncWakeExecutionMode,
			"presenceExecutionMode":     cfg.PresenceExecutionMode,
			"notificationExecutionMode": cfg.NotificationExecutionMode,
		},
	}
}
