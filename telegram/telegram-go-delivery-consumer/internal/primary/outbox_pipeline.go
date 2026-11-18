package primary

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// buildOutboxChunkStartedPipeline 构造分片启动时的单文档原子聚合更新管线，避免先读后写引发的计数丢失。
func buildOutboxChunkStartedPipeline(chunkIndex int, jobID string, attemptCount int, now time.Time) mongo.Pipeline {
	chunkPatch := bson.M{
		"status":           "projecting",
		"jobId":            jobID,
		"lastAttemptAt":    now,
		"lastErrorMessage": nil,
		"attemptCount":     attemptCount,
	}
	return appendOutboxAggregateStages(bson.D{{
		Key: "$set",
		Value: bson.M{
			"lastDispatchedAt": now,
			"updatedAt":        now,
			"chunks":           mapChunkByIndexExpr(chunkIndex, chunkPatch),
		},
	}}, now)
}

// buildOutboxChunkCompletedPipeline 构造分片完成时的单文档原子聚合更新管线。
func buildOutboxChunkCompletedPipeline(
	chunkIndex int,
	jobID string,
	attemptCount int,
	recipientCount int,
	projectionCount int,
	now time.Time,
) mongo.Pipeline {
	chunkPatch := bson.M{
		"status":           "completed",
		"jobId":            jobID,
		"attemptCount":     attemptCount,
		"lastAttemptAt":    now,
		"lastErrorMessage": nil,
		"projection": bson.M{
			"recipientCount": recipientCount,
			"chunkCount":     projectionCount,
		},
	}
	return appendOutboxAggregateStages(bson.D{{
		Key: "$set",
		Value: bson.M{
			"updatedAt": now,
			"chunks":    mapChunkByIndexExpr(chunkIndex, chunkPatch),
		},
	}}, now)
}

// buildOutboxChunkFailedPipeline 构造分片失败（含毒丸标记）时的单文档原子聚合更新管线。
func buildOutboxChunkFailedPipeline(
	chunkIndex int,
	jobID string,
	attemptCount int,
	reason string,
	now time.Time,
) mongo.Pipeline {
	chunkPatch := bson.M{
		"status":           "failed",
		"jobId":            jobID,
		"attemptCount":     attemptCount,
		"lastAttemptAt":    now,
		"lastErrorMessage": reason,
		"failureMetadata": bson.M{
			"$mergeObjects": bson.A{
				bson.M{"$ifNull": bson.A{"$$chunk.failureMetadata", bson.M{}}},
				bson.M{
					"jobId":    jobID,
					"poisoned": true,
				},
			},
		},
	}
	return appendOutboxAggregateStages(bson.D{{
		Key: "$set",
		Value: bson.M{
			"lastErrorMessage": reason,
			"updatedAt":        now,
			"chunks":           mapChunkByIndexExpr(chunkIndex, chunkPatch),
		},
	}}, now)
}

// buildOutboxRecordFailurePipeline 构造整体主投影失败时的单文档原子聚合更新管线。
func buildOutboxRecordFailurePipeline(targetStatus string, reason string, now time.Time) mongo.Pipeline {
	chunksExpr := bson.M{
		"$map": bson.M{
			"input": bson.M{"$ifNull": bson.A{"$chunks", bson.A{}}},
			"as":    "chunk",
			"in": bson.M{
				"$cond": bson.A{
					bson.M{"$in": bson.A{"$$chunk.status", bson.A{"queued", "projecting"}}},
					bson.M{
						"$mergeObjects": bson.A{
							"$$chunk",
							bson.M{
								"status":           targetStatus,
								"lastErrorMessage": reason,
								"lastAttemptAt":    now,
							},
						},
					},
					"$$chunk",
				},
			},
		},
	}
	return appendOutboxAggregateStages(bson.D{{
		Key: "$set",
		Value: bson.M{
			"lastErrorMessage": reason,
			"updatedAt":        now,
			"chunks":           chunksExpr,
		},
	}}, now)
}

// buildOutboxReconcileAggregatesPipeline 构造纯服务端原子重算 Outbox 顶层聚合指标的更新管线。
func buildOutboxReconcileAggregatesPipeline(now time.Time) mongo.Pipeline {
	return appendOutboxAggregateStages(bson.D{{
		Key: "$set",
		Value: bson.M{
			"updatedAt": now,
		},
	}}, now)
}

func mapChunkByIndexExpr(chunkIndex int, patch bson.M) bson.M {
	return bson.M{
		"$map": bson.M{
			"input": bson.M{"$ifNull": bson.A{"$chunks", bson.A{}}},
			"as":    "chunk",
			"in": bson.M{
				"$cond": bson.A{
					bson.M{"$eq": bson.A{"$$chunk.chunkIndex", chunkIndex}},
					bson.M{"$mergeObjects": bson.A{"$$chunk", patch}},
					"$$chunk",
				},
			},
		},
	}
}

func appendOutboxAggregateStages(mutateStage bson.D, now time.Time) mongo.Pipeline {
	chunksArray := bson.M{"$ifNull": bson.A{"$chunks", bson.A{}}}
	aggregateStage := bson.D{{
		Key: "$set",
		Value: bson.M{
			"queuedChunkCount":        countChunksByStatusExpr("queued"),
			"completedChunkCount":     countChunksByStatusExpr("completed"),
			"failedChunkCount":        countChunksByStatusExpr("failed"),
			"projectedRecipientCount": sumProjectedRecipientCountExpr(chunksArray),
			"projectedChunkCount":     sumProjectedChunkCountExpr(chunksArray),
			"queuedJobIds":            collectChunkJobIDsExpr(chunksArray),
			"status":                  deriveOutboxStatusExpr(chunksArray),
			"updatedAt":               now,
		},
	}}
	completionStage := bson.D{{
		Key: "$set",
		Value: bson.M{
			"lastCompletedAt": bson.M{
				"$cond": bson.A{
					bson.M{"$eq": bson.A{"$status", "completed"}},
					now,
					"$lastCompletedAt",
				},
			},
		},
	}}
	return mongo.Pipeline{mutateStage, aggregateStage, completionStage}
}

func countChunksByStatusExpr(status string) bson.M {
	return bson.M{
		"$size": bson.M{
			"$filter": bson.M{
				"input": bson.M{"$ifNull": bson.A{"$chunks", bson.A{}}},
				"as":    "c",
				"cond":  bson.M{"$eq": bson.A{"$$c.status", status}},
			},
		},
	}
}

func sumProjectedRecipientCountExpr(chunksArray bson.M) bson.M {
	return bson.M{
		"$sum": bson.M{
			"$map": bson.M{
				"input": chunksArray,
				"as":    "c",
				"in":    bson.M{"$ifNull": bson.A{"$$c.projection.recipientCount", 0}},
			},
		},
	}
}

func sumProjectedChunkCountExpr(chunksArray bson.M) bson.M {
	return bson.M{
		"$sum": bson.M{
			"$map": bson.M{
				"input": chunksArray,
				"as":    "c",
				"in": bson.M{
					"$cond": bson.A{
						bson.M{"$ne": bson.A{bson.M{"$ifNull": bson.A{"$$c.projection", nil}}, nil}},
						bson.M{
							"$cond": bson.A{
								bson.M{"$gt": bson.A{bson.M{"$ifNull": bson.A{"$$c.projection.chunkCount", 0}}, 0}},
								"$$c.projection.chunkCount",
								1,
							},
						},
						0,
					},
				},
			},
		},
	}
}

func collectChunkJobIDsExpr(chunksArray bson.M) bson.M {
	return bson.M{
		"$map": bson.M{
			"input": bson.M{
				"$filter": bson.M{
					"input": chunksArray,
					"as":    "c",
					"cond":  bson.M{"$ne": bson.A{bson.M{"$ifNull": bson.A{"$$c.jobId", ""}}, ""}},
				},
			},
			"as": "jc",
			"in": "$$jc.jobId",
		},
	}
}

func deriveOutboxStatusExpr(chunksArray bson.M) bson.M {
	return bson.M{
		"$let": bson.M{
			"vars": bson.M{
				"total":      bson.M{"$size": chunksArray},
				"failed":     countChunksByStatusExpr("failed"),
				"completed":  countChunksByStatusExpr("completed"),
				"projecting": countChunksByStatusExpr("projecting"),
				"queued":     countChunksByStatusExpr("queued"),
			},
			"in": bson.M{
				"$switch": bson.M{
					"branches": bson.A{
						bson.M{"case": bson.M{"$eq": bson.A{"$$total", 0}}, "then": "pending_dispatch"},
						bson.M{"case": bson.M{"$gt": bson.A{"$$failed", 0}}, "then": "failed"},
						bson.M{"case": bson.M{"$eq": bson.A{"$$completed", "$$total"}}, "then": "completed"},
						bson.M{"case": bson.M{"$gt": bson.A{"$$completed", 0}}, "then": "partially_completed"},
						bson.M{"case": bson.M{"$gt": bson.A{"$$projecting", 0}}, "then": "projecting"},
						bson.M{"case": bson.M{"$gt": bson.A{"$$queued", 0}}, "then": "queued"},
					},
					"default": "pending_dispatch",
				},
			},
		},
	}
}
