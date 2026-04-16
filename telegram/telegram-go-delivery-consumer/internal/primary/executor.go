package primary

import (
	"context"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
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
	wakePublisher  WakePublisher
}

func NewMongoExecutor(ctx context.Context, cfg config.Config, wakePublisher WakePublisher) (*MongoExecutor, error) {
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
	return &MongoExecutor{
		cfg:            cfg,
		client:         client,
		memberStates:   db.Collection(cfg.MemberStateCollection),
		updateCounters: db.Collection(cfg.UpdateCounterCollection),
		updateLogs:     db.Collection(cfg.UpdateLogCollection),
		outboxes:       db.Collection(cfg.OutboxCollection),
		wakePublisher:  wakePublisher,
	}, nil
}

func (e *MongoExecutor) Close(ctx context.Context) error {
	return e.client.Disconnect(ctx)
}

func (e *MongoExecutor) ExecuteFanout(ctx context.Context, payload FanoutPayload) (ExecutionResult, error) {
	recipients := dedupeRecipients(payload.RecipientIDs)
	if len(recipients) == 0 {
		return ExecutionResult{OutboxID: payload.OutboxID}, nil
	}

	outboxID, err := bson.ObjectIDFromHex(payload.OutboxID)
	if err != nil {
		return ExecutionResult{}, fmt.Errorf("parse outbox id: %w", err)
	}

	plan := planner.BuildShadowPlan(planner.FanoutRequest{
		MessageID:    payload.MessageID,
		ChatID:       payload.ChatID,
		OutboxID:     payload.OutboxID,
		RecipientIDs: recipients,
	}, positiveOrDefault(e.cfg.MaxRecipientsPerChunk, len(recipients)))

	projectionCount := 0
	for _, chunk := range plan.Chunks {
		jobID := fmt.Sprintf("%s:%s:%d", resolveJobPrefix(payload.DispatchMode), payload.OutboxID, chunk.ChunkIndex)
		if err := e.markChunkStarted(ctx, outboxID, chunk.ChunkIndex, jobID, payload.AttemptCount); err != nil {
			return ExecutionResult{}, err
		}
		chunkProjectionCount, err := e.projectRecipients(ctx, payload, chunk.RecipientIDs)
		if err != nil {
			return ExecutionResult{}, err
		}
		projectionCount += chunkProjectionCount
		if err := e.markChunkCompleted(ctx, outboxID, chunk.ChunkIndex, jobID, payload.AttemptCount, len(chunk.RecipientIDs), chunkProjectionCount); err != nil {
			return ExecutionResult{}, err
		}
	}

	if err := e.markOutboxCompleted(ctx, outboxID, plan, projectionCount, payload.DispatchMode); err != nil {
		return ExecutionResult{}, err
	}

	return ExecutionResult{
		OutboxID:        payload.OutboxID,
		RecipientCount:  len(recipients),
		ProjectionCount: projectionCount,
	}, nil
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
	if refreshErr := e.refreshOutboxAggregates(ctx, outboxID); refreshErr != nil {
		return refreshErr
	}
	return nil
}
