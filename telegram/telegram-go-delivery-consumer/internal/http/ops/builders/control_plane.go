package builders

import (
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/http/ops/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func BuildControlPlane(cfg config.Config, snapshot summary.Snapshot) contracts.ControlPlane {
	return contracts.ControlPlane{
		ContractVersion: contracts.SummaryContractVersion,
		Runtime: map[string]any{
			"executionMode": cfg.ExecutionMode,
			"dryRun":        cfg.DryRun,
			"streamKey":     cfg.StreamKey,
			"consumerGroup": cfg.ConsumerGroup,
			"consumerName":  snapshot.ConsumerName,
		},
		Throughput: map[string]any{
			"eventsConsumed":       snapshot.EventsConsumed,
			"readErrors":           snapshot.ReadErrors,
			"deadLetters":          snapshot.DeadLetters,
			"countsByTopic":        snapshot.CountsByTopic,
			"countsByStream":       snapshot.CountsByStream,
			"lastConsumedAt":       snapshot.LastConsumedAt,
			"lastEventId":          snapshot.LastEventID,
			"lastTopic":            snapshot.LastTopic,
			"lastStreamKey":        snapshot.LastStreamKey,
			"lastError":            snapshot.LastError,
			"lastDeadLetterReason": snapshot.LastDeadLetterReason,
		},
		Reclaim: map[string]any{
			"pendingIdleMs":            cfg.PendingIdleDuration.Milliseconds(),
			"pendingClaimCount":        cfg.PendingClaimCount,
			"pendingClaimIntervalMs":   cfg.PendingClaimInterval.Milliseconds(),
			"pendingReclaimMaxBatches": cfg.PendingReclaimMaxBatches,
			"reclaimCursorMode":        cfg.ReclaimCursorMode,
			"scans":                    snapshot.PendingReclaimScans,
			"claimed":                  snapshot.PendingReclaimClaimed,
			"poison":                   snapshot.PendingReclaimPoison,
			"ackFailures":              snapshot.PendingReclaimAckFailures,
			"lastCursor":               snapshot.PendingReclaimLastCursor,
			"streams":                  snapshot.PendingReclaimStreams,
		},
		Primary: map[string]any{
			"executions":               snapshot.PrimaryExecutions,
			"succeeded":                snapshot.PrimarySucceeded,
			"failed":                   snapshot.PrimaryFailed,
			"skipped":                  snapshot.PrimarySkipped,
			"completedChunkSkips":      snapshot.PrimaryCompletedChunkSkips,
			"retryQueued":              snapshot.PrimaryRetryQueued,
			"retryableFailures":        snapshot.PrimaryRetryableFailures,
			"terminalFailures":         snapshot.PrimaryTerminalFailures,
			"projectedRecipients":      snapshot.PrimaryProjectedRecipients,
			"groupProjectedRecipients": snapshot.PrimaryGroupProjectedRecipients,
			"skipReasons":              snapshot.PrimarySkipReasons,
			"lastEventId":              snapshot.LastPrimaryEventID,
			"lastOutboxId":             snapshot.LastPrimaryOutboxID,
			"lastFailure":              snapshot.LastPrimaryFailure,
			"lastSkipReason":           snapshot.LastPrimarySkipReason,
		},
		Platform: map[string]any{
			"streamKey":                 cfg.PlatformStreamKey,
			"replayStreamKey":           cfg.PlatformReplayStreamKey,
			"replayScanCount":           cfg.PlatformReplayScanCount,
			"syncWakeExecutionMode":     cfg.SyncWakeExecutionMode,
			"presenceExecutionMode":     cfg.PresenceExecutionMode,
			"notificationExecutionMode": cfg.NotificationExecutionMode,
			"executions":                snapshot.PlatformExecutions,
			"succeeded":                 snapshot.PlatformSucceeded,
			"failed":                    snapshot.PlatformFailed,
			"shadowed":                  snapshot.PlatformShadowed,
			"fallbacks":                 snapshot.PlatformFallbacks,
			"replayed":                  snapshot.PlatformReplayed,
			"topics":                    snapshot.PlatformTopics,
			"lastTopic":                 snapshot.LastPlatformTopic,
			"lastChannel":               snapshot.LastPlatformChannel,
			"lastFailure":               snapshot.LastPlatformFailure,
			"lastReplayStream":          snapshot.LastPlatformReplayStream,
			"lastReplayId":              snapshot.LastPlatformReplayID,
		},
		Mongo: map[string]any{
			"reservationConcurrency": cfg.ReservationConcurrency,
			"inQueryChunkSize":       cfg.MongoInQueryChunkSize,
			"ensureIndexes":          cfg.MongoEnsureIndexes,
			"failureCategories":      snapshot.PrimaryMongoFailureCategories,
		},
	}
}
