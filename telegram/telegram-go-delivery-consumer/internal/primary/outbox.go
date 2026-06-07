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

func (e *MongoExecutor) markChunkStarted(ctx context.Context, outboxID bson.ObjectID, chunkIndex int, jobID string, attemptCount int) error {
	doc, err := e.loadOutboxAggregateDocument(ctx, outboxID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err = e.outboxes.UpdateOne(ctx, bson.M{
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
	applyChunkStarted(&doc, chunkIndex, jobID)
	return e.applyOutboxAggregatePatch(ctx, outboxID, summarizeOutboxChunks(doc.Chunks))
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
	doc, err := e.loadOutboxAggregateDocument(ctx, outboxID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err = e.outboxes.UpdateOne(ctx, bson.M{
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
	applyChunkCompleted(&doc, chunkIndex, jobID, recipientCount, projectionCount)
	return e.applyOutboxAggregatePatch(ctx, outboxID, summarizeOutboxChunks(doc.Chunks))
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

func (e *MongoExecutor) reconcileOutboxAggregates(ctx context.Context, outboxID bson.ObjectID) error {
	doc, err := e.loadOutboxAggregateDocument(ctx, outboxID)
	if err != nil {
		return err
	}
	return e.applyOutboxAggregatePatch(ctx, outboxID, summarizeOutboxChunks(doc.Chunks))
}

func (e *MongoExecutor) loadOutboxAggregateDocument(ctx context.Context, outboxID bson.ObjectID) (outboxDocument, error) {
	var doc outboxDocument
	if err := e.outboxes.FindOne(ctx, bson.M{"_id": outboxID}).Decode(&doc); err != nil {
		return outboxDocument{}, fmt.Errorf("load outbox aggregates: %w", err)
	}
	return doc, nil
}

func (e *MongoExecutor) refreshOutboxAggregates(ctx context.Context, outboxID bson.ObjectID) error {
	return e.reconcileOutboxAggregates(ctx, outboxID)
}

func (e *MongoExecutor) applyOutboxAggregatePatch(ctx context.Context, outboxID bson.ObjectID, state outboxAggregateState) error {
	now := time.Now().UTC()
	set := bson.M{
		"status":                  state.Status,
		"queuedChunkCount":        state.QueuedChunkCount,
		"completedChunkCount":     state.CompletedChunkCount,
		"failedChunkCount":        state.FailedChunkCount,
		"projectedRecipientCount": state.ProjectedRecipientCount,
		"projectedChunkCount":     state.ProjectedChunkCount,
		"queuedJobIds":            state.QueuedJobIDs,
		"updatedAt":               now,
	}
	if state.LastCompletedAt != nil {
		set["lastCompletedAt"] = *state.LastCompletedAt
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
