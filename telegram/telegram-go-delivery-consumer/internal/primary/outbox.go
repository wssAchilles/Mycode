package primary

import (
	"context"
	"fmt"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type outboxDocument struct {
	Chunks []outboxChunk `bson:"chunks"`
}

type outboxChunk struct {
	ChunkIndex int               `bson:"chunkIndex"`
	Status     string            `bson:"status"`
	JobID      string            `bson:"jobId"`
	Projection *outboxProjection `bson:"projection"`
}

type outboxProjection struct {
	RecipientCount int `bson:"recipientCount"`
	ChunkCount     int `bson:"chunkCount"`
}

func (e *MongoExecutor) loadCompletedChunkProjections(ctx context.Context, outboxID bson.ObjectID) (map[int]outboxProjection, error) {
	var doc outboxDocument
	if err := e.outboxes.FindOne(ctx, bson.M{"_id": outboxID}).Decode(&doc); err != nil {
		return nil, fmt.Errorf("load completed outbox chunks: %w", err)
	}
	return completedChunkProjections(doc.Chunks), nil
}

func completedChunkProjections(chunks []outboxChunk) map[int]outboxProjection {
	completed := make(map[int]outboxProjection)
	for _, chunk := range chunks {
		if chunk.Status != "completed" {
			continue
		}
		projection := outboxProjection{ChunkCount: 1}
		if chunk.Projection != nil {
			projection = *chunk.Projection
		}
		projection.ChunkCount = positiveOrDefault(projection.ChunkCount, 1)
		completed[chunk.ChunkIndex] = projection
	}
	return completed
}

// markChunkStarted 使用 MongoDB 聚合更新管线在单文档原子事务中推进分片为 projecting 并重算顶层统计。
func (e *MongoExecutor) markChunkStarted(ctx context.Context, outboxID bson.ObjectID, chunkIndex int, jobID string, attemptCount int) error {
	now := time.Now().UTC()
	_, err := e.outboxes.UpdateOne(ctx, bson.M{
		"_id":               outboxID,
		"chunks.chunkIndex": chunkIndex,
	}, buildOutboxChunkStartedPipeline(chunkIndex, jobID, attemptCount, now))
	if err != nil {
		return fmt.Errorf("mark outbox chunk started: %w", err)
	}
	return nil
}

// markChunkCompleted 使用 MongoDB 聚合更新管线原子写入分片完成结果与顶层投影聚合计数，消除并发 Lost Update。
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
	}, buildOutboxChunkCompletedPipeline(chunkIndex, jobID, attemptCount, recipientCount, projectionCount, now))
	if err != nil {
		return fmt.Errorf("mark outbox chunk completed: %w", err)
	}
	return nil
}

// markChunkFailed 使用 MongoDB 聚合更新管线原子标记毒丸分片失败并同步重算顶层计数。
func (e *MongoExecutor) markChunkFailed(
	ctx context.Context,
	outboxID bson.ObjectID,
	chunkIndex int,
	jobID string,
	attemptCount int,
	reason string,
) error {
	now := time.Now().UTC()
	_, err := e.outboxes.UpdateOne(ctx, bson.M{
		"_id":               outboxID,
		"chunks.chunkIndex": chunkIndex,
	}, buildOutboxChunkFailedPipeline(chunkIndex, jobID, attemptCount, reason, now))
	if err != nil {
		return fmt.Errorf("mark outbox chunk failed: %w", err)
	}
	return nil
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
		jobIDs = append(jobIDs, chunkIdempotencyKey(plan.OutboxID, chunk.ChunkIndex, dispatchMode))
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

func (e *MongoExecutor) reconcileOutboxAggregates(ctx context.Context, outboxID bson.ObjectID) error {
	now := time.Now().UTC()
	_, err := e.outboxes.UpdateByID(ctx, outboxID, buildOutboxReconcileAggregatesPipeline(now))
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
			failed++
		case "completed":
			completed++
		case "projecting":
			projecting++
		case "queued":
			queued++
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
