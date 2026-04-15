package primary

import (
	"context"
	"encoding/json"
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

type updateCounterDocument struct {
	UpdateID int64 `bson:"updateId"`
}

type outboxDocument struct {
	Chunks []outboxChunk `bson:"chunks"`
}

type outboxChunk struct {
	Status     string            `bson:"status"`
	JobID      string            `bson:"jobId"`
	Projection *outboxProjection `bson:"projection"`
}

type outboxProjection struct {
	RecipientCount int `bson:"recipientCount"`
	ChunkCount     int `bson:"chunkCount"`
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

func (e *MongoExecutor) projectRecipients(ctx context.Context, payload FanoutPayload, recipients []string) (int, error) {
	projectionChunkSize := positiveOrDefault(e.cfg.ProjectionChunkSize, len(recipients))
	projectionCount := 0
	for offset := 0; offset < len(recipients); offset += projectionChunkSize {
		end := offset + projectionChunkSize
		if end > len(recipients) {
			end = len(recipients)
		}
		chunk := recipients[offset:end]
		if err := e.updateMemberStates(ctx, payload, chunk); err != nil {
			return projectionCount, err
		}
		for _, userID := range chunk {
			if err := e.appendSyncUpdate(ctx, payload, userID); err != nil {
				return projectionCount, err
			}
		}
		projectionCount += 1
	}
	return projectionCount, nil
}

func (e *MongoExecutor) updateMemberStates(ctx context.Context, payload FanoutPayload, recipients []string) error {
	now := time.Now().UTC()
	ops := make([]mongo.WriteModel, 0, len(recipients))
	for _, userID := range recipients {
		ops = append(ops, mongo.NewUpdateOneModel().
			SetFilter(bson.M{"chatId": payload.ChatID, "userId": userID}).
			SetUpdate(bson.M{
				"$max": bson.M{"lastDeliveredSeq": payload.Seq},
				"$set": bson.M{"updatedAt": now},
				"$setOnInsert": bson.M{
					"chatId":      payload.ChatID,
					"userId":      userID,
					"lastReadSeq": 0,
					"createdAt":   now,
				},
			}).
			SetUpsert(true))
	}
	if len(ops) == 0 {
		return nil
	}
	_, err := e.memberStates.BulkWrite(ctx, ops, options.BulkWrite().SetOrdered(false))
	if err != nil {
		return fmt.Errorf("bulk update member state: %w", err)
	}
	return nil
}

func (e *MongoExecutor) appendSyncUpdate(ctx context.Context, payload FanoutPayload, userID string) error {
	filter := bson.M{
		"userId":    userID,
		"type":      "message",
		"chatId":    payload.ChatID,
		"messageId": payload.MessageID,
	}
	err := e.updateLogs.FindOne(ctx, filter).Err()
	if err == nil {
		return nil
	}
	if err != mongo.ErrNoDocuments {
		return fmt.Errorf("check existing update log: %w", err)
	}

	now := time.Now().UTC()
	var counter updateCounterDocument
	err = e.updateCounters.FindOneAndUpdate(
		ctx,
		bson.M{"_id": userID},
		bson.M{
			"$inc": bson.M{"updateId": 1},
			"$set": bson.M{"updatedAt": now},
		},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&counter)
	if err != nil {
		return fmt.Errorf("reserve update id: %w", err)
	}

	_, err = e.updateLogs.InsertOne(ctx, bson.M{
		"userId":    userID,
		"updateId":  counter.UpdateID,
		"type":      "message",
		"chatId":    payload.ChatID,
		"seq":       payload.Seq,
		"messageId": payload.MessageID,
		"payload":   nil,
		"createdAt": now,
	})
	if err != nil {
		return fmt.Errorf("insert update log: %w", err)
	}
	e.publishWake(ctx, userID, counter.UpdateID)
	return nil
}

func (e *MongoExecutor) publishWake(ctx context.Context, userID string, updateID int64) {
	if e.wakePublisher == nil || e.cfg.WakePubSubChannel == "" {
		return
	}
	payload, err := json.Marshal(map[string]interface{}{
		"userId":   userID,
		"updateId": updateID,
	})
	if err != nil {
		return
	}
	_ = e.wakePublisher.Publish(ctx, e.cfg.WakePubSubChannel, string(payload)).Err()
}

func (e *MongoExecutor) markChunkStarted(ctx context.Context, outboxID bson.ObjectID, chunkIndex int, jobID string, attemptCount int) error {
	now := time.Now().UTC()
	_, err := e.outboxes.UpdateOne(ctx, bson.M{
		"_id":               outboxID,
		"chunks.chunkIndex": chunkIndex,
	}, bson.M{
		"$set": bson.M{
			"status":                    "projecting",
			"lastDispatchedAt":          now,
			"updatedAt":                 now,
			"chunks.$.status":           "projecting",
			"chunks.$.jobId":            jobID,
			"chunks.$.lastAttemptAt":    now,
			"chunks.$.lastErrorMessage": nil,
			"chunks.$.attemptCount":     attemptCount,
		},
	})
	if err != nil {
		return fmt.Errorf("mark outbox chunk started: %w", err)
	}
	return e.refreshOutboxAggregates(ctx, outboxID)
}

func (e *MongoExecutor) markChunkCompleted(
	ctx context.Context,
	outboxID bson.ObjectID,
	chunkIndex int,
	jobID string,
	attemptCount int,
	recipientCount int,
	projectionCount int,
) error {
	now := time.Now().UTC()
	_, err := e.outboxes.UpdateOne(ctx, bson.M{
		"_id":               outboxID,
		"chunks.chunkIndex": chunkIndex,
	}, bson.M{
		"$set": bson.M{
			"updatedAt":                 now,
			"chunks.$.status":           "completed",
			"chunks.$.jobId":            jobID,
			"chunks.$.attemptCount":     attemptCount,
			"chunks.$.lastAttemptAt":    now,
			"chunks.$.lastErrorMessage": nil,
			"chunks.$.projection": bson.M{
				"recipientCount": recipientCount,
				"chunkCount":     projectionCount,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("mark outbox chunk completed: %w", err)
	}
	return e.refreshOutboxAggregates(ctx, outboxID)
}

func (e *MongoExecutor) markOutboxCompleted(
	ctx context.Context,
	outboxID bson.ObjectID,
	plan planner.ShadowPlan,
	projectionCount int,
	dispatchMode string,
) error {
	now := time.Now().UTC()
	jobIDs := make([]string, 0, len(plan.Chunks))
	for _, chunk := range plan.Chunks {
		jobIDs = append(jobIDs, fmt.Sprintf("%s:%s:%d", resolveJobPrefix(dispatchMode), plan.OutboxID, chunk.ChunkIndex))
	}
	_, err := e.outboxes.UpdateByID(ctx, outboxID, bson.M{
		"$set": bson.M{
			"dispatchMode":            dispatchMode,
			"status":                  "completed",
			"queuedChunkCount":        0,
			"completedChunkCount":     len(plan.Chunks),
			"failedChunkCount":        0,
			"projectedRecipientCount": plan.TotalRecipientCount,
			"projectedChunkCount":     projectionCount,
			"queuedJobIds":            jobIDs,
			"lastCompletedAt":         now,
			"lastErrorMessage":        nil,
			"updatedAt":               now,
		},
	})
	if err != nil {
		return fmt.Errorf("mark outbox completed: %w", err)
	}
	return nil
}

func resolveJobPrefix(dispatchMode string) string {
	if dispatchMode == "go_group_canary" {
		return "go-group-canary"
	}
	return "go-primary"
}

func (e *MongoExecutor) refreshOutboxAggregates(ctx context.Context, outboxID bson.ObjectID) error {
	var doc outboxDocument
	if err := e.outboxes.FindOne(ctx, bson.M{"_id": outboxID}).Decode(&doc); err != nil {
		return fmt.Errorf("load outbox aggregates: %w", err)
	}
	queued := 0
	completed := 0
	failed := 0
	projectedRecipients := 0
	projectedChunks := 0
	queuedJobIDs := make([]string, 0, len(doc.Chunks))

	for _, chunk := range doc.Chunks {
		switch chunk.Status {
		case "queued":
			queued += 1
		case "completed":
			completed += 1
		case "failed":
			failed += 1
		}
		if chunk.JobID != "" {
			queuedJobIDs = append(queuedJobIDs, chunk.JobID)
		}
		if chunk.Projection != nil {
			projectedRecipients += chunk.Projection.RecipientCount
			projectedChunks += chunk.Projection.ChunkCount
		}
	}

	status := deriveOutboxStatus(doc.Chunks)
	set := bson.M{
		"status":                  status,
		"queuedChunkCount":        queued,
		"completedChunkCount":     completed,
		"failedChunkCount":        failed,
		"projectedRecipientCount": projectedRecipients,
		"projectedChunkCount":     projectedChunks,
		"queuedJobIds":            queuedJobIDs,
		"updatedAt":               time.Now().UTC(),
	}
	if status == "completed" {
		set["lastCompletedAt"] = time.Now().UTC()
	}
	_, err := e.outboxes.UpdateByID(ctx, outboxID, bson.M{"$set": set})
	if err != nil {
		return fmt.Errorf("refresh outbox aggregates: %w", err)
	}
	return nil
}

func deriveOutboxStatus(chunks []outboxChunk) string {
	if len(chunks) == 0 {
		return "pending_dispatch"
	}
	failed := 0
	completed := 0
	projecting := 0
	queued := 0
	for _, chunk := range chunks {
		switch chunk.Status {
		case "failed":
			failed += 1
		case "completed":
			completed += 1
		case "projecting":
			projecting += 1
		case "queued":
			queued += 1
		}
	}
	if failed > 0 {
		return "failed"
	}
	if completed == len(chunks) {
		return "completed"
	}
	if completed > 0 {
		return "partially_completed"
	}
	if projecting > 0 {
		return "projecting"
	}
	if queued > 0 {
		return "queued"
	}
	return "pending_dispatch"
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	if fallback > 0 {
		return fallback
	}
	return 1
}
