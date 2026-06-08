package primary

import (
	"context"
	"fmt"
	"log"
	"time"

	redis "github.com/redis/go-redis/v9"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/common"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/wake"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type WakePublisher interface {
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
}

type MongoExecutor struct {
	cfg            config.Config
	client         *mongo.Client
	memberStates   *mongo.Collection
	updateCounters *mongo.Collection
	updateLogs     *mongo.Collection
	outboxes       *mongo.Collection
	reservations   syncUpdateReservationAllocator
	wakePublisher  WakePublisher
	wakeRepair     *wake.RepairWriter
	dlqWriter      *dlq.Writer
	logger         *log.Logger
}

type executionLane string

const (
	executionLaneSmall    executionLane = "small"
	executionLaneStandard executionLane = "standard"
	executionLaneLarge    executionLane = "large"
	executionLaneBulk     executionLane = "bulk"
)

type fanoutPlan struct {
	OutboxObjectID      bson.ObjectID
	Shadow              planner.ShadowPlan
	Lane                executionLane
	Runtime             fanoutRuntimeMetadata
	CompletedChunks     map[int]outboxProjection
	RecipientCount      int
	ProjectionCount     int
	CompletedChunkSkips int
}

type fanoutRuntimeMetadata struct {
	ChunkSize      int
	Concurrency    int
	RetryThreshold int
}

type reservedChunk struct {
	Chunk planner.ChunkPlan
	JobID string
}

func NewMongoExecutor(ctx context.Context, cfg config.Config, wakePublisher WakePublisher, logger *log.Logger) (*MongoExecutor, error) {
	if cfg.MongoURL == "" {
		return nil, fmt.Errorf("DELIVERY_CONSUMER_MONGO_URL is required for primary execution")
	}
	if cfg.MongoDatabase == "" {
		return nil, fmt.Errorf("DELIVERY_CONSUMER_MONGO_DATABASE is required for primary execution")
	}
	client, err := mongo.Connect(options.Client().ApplyURI(cfg.MongoURL))
	if err != nil {
		return nil, fmt.Errorf("connect mongo: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(ctx)
		return nil, fmt.Errorf("ping mongo: %w", err)
	}
	db := client.Database(cfg.MongoDatabase)
	executor := &MongoExecutor{
		cfg:            cfg,
		client:         client,
		memberStates:   db.Collection(cfg.MemberStateCollection),
		updateCounters: db.Collection(cfg.UpdateCounterCollection),
		updateLogs:     db.Collection(cfg.UpdateLogCollection),
		outboxes:       db.Collection(cfg.OutboxCollection),
		wakePublisher:  wakePublisher,
		logger:         logger,
	}
	if repairClient, ok := wakePublisher.(wake.RepairStreamClient); ok {
		executor.wakeRepair = wake.NewRepairWriter(repairClient, cfg.WakeRepairStreamKey)
		executor.dlqWriter = dlq.New(repairClient, cfg.DLQStreamKey)
	}
	if cfg.MongoEnsureIndexes {
		if err := executor.EnsureIndexes(ctx); err != nil {
			_ = client.Disconnect(ctx)
			return nil, err
		}
	}
	return executor, nil
}

func (e *MongoExecutor) Close(ctx context.Context) error {
	return e.client.Disconnect(ctx)
}

func (e *MongoExecutor) ExecuteFanout(ctx context.Context, payload FanoutPayload) (ExecutionResult, error) {
	plan, err := e.BuildFanoutPlan(ctx, payload)
	if err != nil {
		return ExecutionResult{}, err
	}
	if plan.RecipientCount == 0 {
		return ExecutionResult{OutboxID: payload.OutboxID}, nil
	}

	for _, chunk := range plan.Shadow.Chunks {
		if projection, completed := plan.CompletedChunks[chunk.ChunkIndex]; completed {
			plan.ProjectionCount += projection.ChunkCount
			plan.CompletedChunkSkips++
			continue
		}

		reserved, err := e.ReserveChunk(ctx, payload, plan, chunk)
		if err != nil {
			return ExecutionResult{}, err
		}
		projection, err := e.ProjectChunkRecipients(ctx, payload, reserved)
		if err != nil {
			e.recordPoisonChunkIfThresholdExceeded(ctx, payload, plan, reserved, err)
			return ExecutionResult{}, err
		}
		plan.ProjectionCount += projection.ProjectionCount
		if err := e.MarkChunkCompleted(ctx, payload, plan, reserved, projection); err != nil {
			e.recordPoisonChunkIfThresholdExceeded(ctx, payload, plan, reserved, err)
			return ExecutionResult{}, err
		}
		e.PublishWakeOrRepair(ctx, payload, reserved, projection)
	}

	if err := e.markOutboxCompleted(ctx, plan.OutboxObjectID, plan.Shadow, plan.ProjectionCount, payload.DispatchMode); err != nil {
		e.recordPrimaryPoisonIfThresholdExceeded(ctx, payload, plan, err)
		return ExecutionResult{}, err
	}

	return ExecutionResult{
		OutboxID:            payload.OutboxID,
		RecipientCount:      plan.RecipientCount,
		ProjectionCount:     plan.ProjectionCount,
		CompletedChunkSkips: plan.CompletedChunkSkips,
	}, nil
}

func (e *MongoExecutor) BuildFanoutPlan(ctx context.Context, payload FanoutPayload) (fanoutPlan, error) {
	recipients := common.DedupeRecipients(payload.RecipientIDs)
	if len(recipients) == 0 {
		return fanoutPlan{RecipientCount: 0}, nil
	}

	outboxID, err := bson.ObjectIDFromHex(payload.OutboxID)
	if err != nil {
		return fanoutPlan{}, fmt.Errorf("parse outbox id: %w", err)
	}

	lane := classifyExecutionLane(len(recipients))
	chunkSize := positiveOrDefault(e.cfg.MaxRecipientsPerChunk, len(recipients))
	plan := planner.BuildShadowPlan(planner.FanoutRequest{
		MessageID:    payload.MessageID,
		ChatID:       payload.ChatID,
		OutboxID:     payload.OutboxID,
		RecipientIDs: recipients,
	}, chunkSize)

	completedChunks, err := e.loadCompletedChunkProjections(ctx, outboxID)
	if err != nil {
		return fanoutPlan{}, err
	}
	return fanoutPlan{
		OutboxObjectID:  outboxID,
		Shadow:          plan,
		Lane:            lane,
		CompletedChunks: completedChunks,
		RecipientCount:  len(recipients),
		Runtime: fanoutRuntimeMetadata{
			ChunkSize:      chunkSize,
			Concurrency:    laneConcurrency(lane),
			RetryThreshold: primaryPoisonThreshold(e.cfg),
		},
	}, nil
}

func (e *MongoExecutor) ReserveChunk(ctx context.Context, payload FanoutPayload, plan fanoutPlan, chunk planner.ChunkPlan) (reservedChunk, error) {
	jobID := chunkIdempotencyKey(payload.OutboxID, chunk.ChunkIndex, payload.DispatchMode)
	if err := e.markChunkStarted(ctx, plan.OutboxObjectID, chunk.ChunkIndex, jobID, payload.AttemptCount); err != nil {
		return reservedChunk{}, err
	}
	return reservedChunk{Chunk: chunk, JobID: jobID}, nil
}

func (e *MongoExecutor) ProjectChunkRecipients(ctx context.Context, payload FanoutPayload, reserved reservedChunk) (chunkProjectionResult, error) {
	return e.projectRecipients(ctx, payload, reserved.Chunk.RecipientIDs)
}

func (e *MongoExecutor) MarkChunkCompleted(ctx context.Context, payload FanoutPayload, plan fanoutPlan, reserved reservedChunk, projection chunkProjectionResult) error {
	return e.markChunkCompleted(
		ctx,
		plan.OutboxObjectID,
		reserved.Chunk.ChunkIndex,
		reserved.JobID,
		payload.AttemptCount,
		len(reserved.Chunk.RecipientIDs),
		projection.ProjectionCount,
	)
}

func (e *MongoExecutor) PublishWakeOrRepair(ctx context.Context, payload FanoutPayload, reserved reservedChunk, projection chunkProjectionResult) {
	err := e.publishWakeBatch(ctx, projection.Reservations)
	if err == nil {
		return
	}
	if e.wakeRepair != nil {
		repairErr := e.wakeRepair.Write(ctx, wake.RepairPayload{
			OutboxID:     payload.OutboxID,
			ChunkIndex:   reserved.Chunk.ChunkIndex,
			RecipientIDs: append([]string(nil), reserved.Chunk.RecipientIDs...),
			Reason:       err.Error(),
			RecordedAt:   time.Now().UTC(),
		})
		if repairErr != nil && e.logger != nil {
			e.logger.Printf("warn: write wake repair failed: %v", repairErr)
		}
	}
}

func chunkIdempotencyKey(outboxID string, chunkIndex int, dispatchMode string) string {
	return fmt.Sprintf("%s:%d:%s", outboxID, chunkIndex, dispatchMode)
}

func classifyExecutionLane(recipientCount int) executionLane {
	switch {
	case recipientCount <= 20:
		return executionLaneSmall
	case recipientCount <= 500:
		return executionLaneStandard
	case recipientCount <= 5000:
		return executionLaneLarge
	default:
		return executionLaneBulk
	}
}

func laneConcurrency(lane executionLane) int {
	switch lane {
	case executionLaneSmall:
		return 1
	case executionLaneStandard:
		return 2
	case executionLaneLarge:
		return 4
	default:
		return 8
	}
}

func primaryPoisonThreshold(cfg config.Config) int {
	return positiveOrDefault(cfg.PrimaryPoisonThreshold, positiveOrDefault(cfg.PrimaryMaxAttempts, 3))
}

func (e *MongoExecutor) recordPoisonChunkIfThresholdExceeded(
	ctx context.Context,
	payload FanoutPayload,
	plan fanoutPlan,
	reserved reservedChunk,
	cause error,
) {
	if payload.AttemptCount < plan.Runtime.RetryThreshold {
		return
	}
	reason := cause.Error()
	if e.outboxes != nil {
		if err := e.markChunkFailed(ctx, plan.OutboxObjectID, reserved.Chunk.ChunkIndex, reserved.JobID, payload.AttemptCount, reason); err != nil && e.logger != nil {
			e.logger.Printf("warn: mark poison chunk failed: %v", err)
		}
	}
	e.writePrimaryDLQ(ctx, payload, reason, map[string]interface{}{
		"failure_scope":  "chunk",
		"outbox_id":      payload.OutboxID,
		"chunk_index":    reserved.Chunk.ChunkIndex,
		"dispatch_mode":  payload.DispatchMode,
		"execution_lane": string(plan.Lane),
		"attempt_count":  payload.AttemptCount,
		"job_id":         reserved.JobID,
	})
}

func (e *MongoExecutor) recordPrimaryPoisonIfThresholdExceeded(ctx context.Context, payload FanoutPayload, plan fanoutPlan, cause error) {
	if payload.AttemptCount < plan.Runtime.RetryThreshold {
		return
	}
	reason := cause.Error()
	if e.outboxes != nil {
		if err := e.RecordFailure(ctx, payload, reason, true); err != nil && e.logger != nil {
			e.logger.Printf("warn: mark poison primary failed: %v", err)
		}
	}
	e.writePrimaryDLQ(ctx, payload, reason, map[string]interface{}{
		"failure_scope":  "primary",
		"outbox_id":      payload.OutboxID,
		"dispatch_mode":  payload.DispatchMode,
		"execution_lane": string(plan.Lane),
		"attempt_count":  payload.AttemptCount,
	})
}

func (e *MongoExecutor) writePrimaryDLQ(ctx context.Context, payload FanoutPayload, reason string, metadata map[string]interface{}) {
	if e.dlqWriter == nil {
		return
	}
	sourceID := payload.SourceMessageID
	if sourceID == "" {
		sourceID = payload.EventID
	}
	if sourceID == "" {
		sourceID = payload.OutboxID
	}
	if err := e.dlqWriter.WritePrimaryFailure(ctx, sourceID, reason, metadata); err != nil && e.logger != nil {
		e.logger.Printf("warn: primary dlq write failed: %v", err)
	}
}

func (e *MongoExecutor) RecordFailure(ctx context.Context, payload FanoutPayload, reason string, terminal bool) error {
	outboxID, err := bson.ObjectIDFromHex(payload.OutboxID)
	if err != nil {
		return fmt.Errorf("parse outbox id: %w", err)
	}
	status := "queued"
	if terminal {
		status = "failed"
	}
	now := time.Now().UTC()
	_, err = e.outboxes.UpdateByID(ctx, outboxID, bson.M{
		"$set": bson.M{
			"status":                           status,
			"lastErrorMessage":                 reason,
			"updatedAt":                        now,
			"chunks.$[chunk].status":           status,
			"chunks.$[chunk].lastErrorMessage": reason,
			"chunks.$[chunk].lastAttemptAt":    now,
		},
	}, options.UpdateOne().SetArrayFilters([]any{bson.M{"chunk.status": bson.M{"$in": []string{"queued", "projecting"}}}}))
	if err != nil {
		return fmt.Errorf("record outbox failure: %w", err)
	}
	if refreshErr := e.reconcileOutboxAggregates(ctx, outboxID); refreshErr != nil {
		return refreshErr
	}
	return nil
}
