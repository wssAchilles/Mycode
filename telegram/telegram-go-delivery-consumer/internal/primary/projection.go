package primary

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type updateCounterDocument struct {
	UpdateID int64 `bson:"updateId"`
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
