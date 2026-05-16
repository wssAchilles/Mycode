package builders

import (
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/observability/profiling"
	platformops "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/ops"
	platformreplay "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/replay"
)

func resolveTakeoverStage(cfg config.Config) string {
	if cfg.ExecutionMode != "primary" || !cfg.GoPrimaryReady {
		return cfg.ExecutionMode
	}
	if cfg.PrimaryPrivateEnabled && cfg.PrimaryGroupEnabled {
		if cfg.PrimaryGroupRolloutPercent >= 100 {
			return "full_primary"
		}
		return "group_canary"
	}
	if cfg.PrimaryPrivateEnabled {
		return "private_primary"
	}
	if cfg.PrimaryGroupEnabled {
		if cfg.PrimaryGroupRolloutPercent >= 100 {
			return "full_primary"
		}
		return "group_canary"
	}
	return cfg.ExecutionMode
}

func resolveSegmentStages(cfg config.Config) map[string]string {
	stage := resolveTakeoverStage(cfg)
	privateStage := "node_primary"
	groupStage := "node_primary"

	if cfg.PrimaryPrivateEnabled && (stage == "private_primary" || stage == "group_canary" || stage == "full_primary") {
		privateStage = "go_primary"
	}
	if cfg.PrimaryGroupEnabled {
		if stage == "group_canary" {
			groupStage = "go_group_canary"
		} else if stage == "full_primary" {
			groupStage = "go_primary"
		}
	}

	return map[string]string{
		"private": privateStage,
		"group":   groupStage,
	}
}

func resolveFallbackStrategy(cfg config.Config) string {
	if cfg.ExecutionMode == "primary" && cfg.GoPrimaryReady {
		return "fallback_only"
	}
	return "node_primary"
}

func BuildRuntime(cfg config.Config) map[string]any {
	return map[string]any{
		"executionMode":                             cfg.ExecutionMode,
		"takeoverStage":                             resolveTakeoverStage(cfg),
		"segmentStages":                             resolveSegmentStages(cfg),
		"fallbackStrategy":                          resolveFallbackStrategy(cfg),
		"goPrimaryReady":                            cfg.GoPrimaryReady,
		"nodeFallbackOnly":                          cfg.ExecutionMode == "primary" && cfg.GoPrimaryReady,
		"primaryMaxRecipients":                      cfg.PrimaryMaxRecipients,
		"primaryPrivateMaxRecipients":               cfg.PrimaryMaxRecipients,
		"primaryGroupMaxRecipients":                 cfg.PrimaryGroupMaxRecipients,
		"primaryMaxAttempts":                        cfg.PrimaryMaxAttempts,
		"primaryPrivateEnabled":                     cfg.PrimaryPrivateEnabled,
		"primaryGroupEnabled":                       cfg.PrimaryGroupEnabled,
		"primaryPrivateRolloutPercent":              cfg.PrimaryPrivateRolloutPercent,
		"primaryGroupRolloutPercent":                cfg.PrimaryGroupRolloutPercent,
		"projectionChunkSize":                       cfg.ProjectionChunkSize,
		"streamKey":                                 cfg.StreamKey,
		"memberStateCollection":                     cfg.MemberStateCollection,
		"updateCounterCollection":                   cfg.UpdateCounterCollection,
		"updateLogCollection":                       cfg.UpdateLogCollection,
		"platformStreamKey":                         cfg.PlatformStreamKey,
		"platformDLQStreamKey":                      cfg.PlatformDLQStreamKey,
		"platformReplayStreamKey":                   cfg.PlatformReplayStreamKey,
		"platformReplayCompletedKey":                platformreplay.CompletedKey(cfg.PlatformReplayStreamKey),
		"platformReplayScanCount":                   cfg.PlatformReplayScanCount,
		"platformReplaySingleTopicDrainConcurrency": platformreplay.SingleTopicDrainConcurrency,
		"platformReplayCrossTopicDrainConcurrency":  platformreplay.CrossTopicDrainConcurrency,
		"platformTopicModes":                        platformops.TopicModes(cfg),
		"platformTopics":                            platformops.TopicCatalog(cfg),
		"consumerGroup":                             cfg.ConsumerGroup,
		"pendingIdleMs":                             cfg.PendingIdleDuration.Milliseconds(),
		"pendingClaimCount":                         cfg.PendingClaimCount,
		"pendingClaimIntervalMs":                    cfg.PendingClaimInterval.Milliseconds(),
		"pendingReclaimMaxBatches":                  cfg.PendingReclaimMaxBatches,
		"reclaimCursorMode":                         cfg.ReclaimCursorMode,
		"reservationConcurrency":                    cfg.ReservationConcurrency,
		"mongoInQueryChunkSize":                     cfg.MongoInQueryChunkSize,
		"mongoEnsureIndexes":                        cfg.MongoEnsureIndexes,
		"pprofEnabled":                              cfg.PprofBindAddr != "",
		"pprofBindAddr":                             cfg.PprofBindAddr,
		"pprofLoopbackOnly":                         cfg.PprofBindAddr == "" || profiling.IsLoopbackBind(cfg.PprofBindAddr),
		"syncWakeExecutionMode":                     cfg.SyncWakeExecutionMode,
		"presenceExecutionMode":                     cfg.PresenceExecutionMode,
		"notificationExecutionMode":                 cfg.NotificationExecutionMode,
		"wakePubSubChannel":                         cfg.WakePubSubChannel,
		"presenceOnlineChannel":                     cfg.PresenceOnlineChannel,
		"presenceOfflineChannel":                    cfg.PresenceOfflineChannel,
		"notificationChannel":                       cfg.NotificationChannel,
	}
}
