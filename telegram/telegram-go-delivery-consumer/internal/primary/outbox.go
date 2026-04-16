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
	Status     string            `bson:"status"`
	JobID      string            `bson:"jobId"`
	Projection *outboxProjection `bson:"projection"`
}

type outboxProjection struct {
	RecipientCount int `bson:"recipientCount"`
	ChunkCount     int `bson:"chunkCount"`
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
