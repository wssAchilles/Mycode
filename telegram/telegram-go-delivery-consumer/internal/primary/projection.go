package primary

import (
	"context"
	"encoding/json"
	"errors"
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
		if err := e.appendSyncUpdates(ctx, payload, chunk); err != nil {
			return projectionCount, err
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

type syncUpdateReservation struct {
	UserID   string
	UpdateID int64
}

type existingSyncUpdateDocument struct {
	UserID string `bson:"userId"`
}

func (e *MongoExecutor) appendSyncUpdates(ctx context.Context, payload FanoutPayload, recipients []string) error {
	pendingRecipients, err := e.findRecipientsMissingSyncUpdate(ctx, payload, recipients)
	if err != nil {
		return err
	}
	if len(pendingRecipients) == 0 {
		return nil
	}
	now := time.Now().UTC()
	reservations := make([]syncUpdateReservation, 0, len(pendingRecipients))
	for _, userID := range pendingRecipients {
		reservation, reserveErr := e.reserveSyncUpdate(ctx, userID, now)
		if reserveErr != nil {
			if len(reservations) == 0 {
				return reserveErr
			}
			flushErr := e.flushReservedSyncUpdates(ctx, payload, reservations, now)
			if flushErr != nil {
				return fmt.Errorf("%w: %v", reserveErr, flushErr)
			}
			return reserveErr
		}
		reservations = append(reservations, reservation)
	}
	return e.flushReservedSyncUpdates(ctx, payload, reservations, now)
}

func (e *MongoExecutor) findRecipientsMissingSyncUpdate(ctx context.Context, payload FanoutPayload, recipients []string) ([]string, error) {
	cursor, err := e.updateLogs.Find(
		ctx,
		bson.M{
			"userId":    bson.M{"$in": recipients},
			"type":      "message",
			"chatId":    payload.ChatID,
			"messageId": payload.MessageID,
		},
		options.Find().SetProjection(bson.M{"_id": 0, "userId": 1}),
	)
	if err != nil {
		return nil, fmt.Errorf("check existing update logs: %w", err)
	}
	defer cursor.Close(ctx)

	existing := make(map[string]struct{}, len(recipients))
	for cursor.Next(ctx) {
		var document existingSyncUpdateDocument
		if err := cursor.Decode(&document); err != nil {
			return nil, fmt.Errorf("decode existing update log: %w", err)
		}
		if document.UserID != "" {
			existing[document.UserID] = struct{}{}
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing update logs: %w", err)
	}

	return pendingSyncUpdateRecipients(recipients, existing), nil
}

func pendingSyncUpdateRecipients(recipients []string, existing map[string]struct{}) []string {
	pending := make([]string, 0, len(recipients))
	for _, userID := range recipients {
		if _, exists := existing[userID]; exists {
			continue
		}
		pending = append(pending, userID)
	}
	return pending
}

func (e *MongoExecutor) reserveSyncUpdate(ctx context.Context, userID string, now time.Time) (syncUpdateReservation, error) {
	var counter updateCounterDocument
	err := e.updateCounters.FindOneAndUpdate(
		ctx,
		bson.M{"_id": userID},
		bson.M{
			"$inc": bson.M{"updateId": 1},
			"$set": bson.M{"updatedAt": now},
		},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&counter)
	if err != nil {
		return syncUpdateReservation{}, fmt.Errorf("reserve update id: %w", err)
	}
	return syncUpdateReservation{
		UserID:   userID,
		UpdateID: counter.UpdateID,
	}, nil
}

func (e *MongoExecutor) insertSyncUpdates(
	ctx context.Context,
	payload FanoutPayload,
	reservations []syncUpdateReservation,
	now time.Time,
) ([]syncUpdateReservation, error) {
	if len(reservations) == 0 {
		return nil, nil
	}
	documents := make([]interface{}, 0, len(reservations))
	for _, reservation := range reservations {
		documents = append(documents, bson.M{
			"userId":    reservation.UserID,
			"updateId":  reservation.UpdateID,
			"type":      "message",
			"chatId":    payload.ChatID,
			"seq":       payload.Seq,
			"messageId": payload.MessageID,
			"payload":   nil,
			"createdAt": now,
		})
	}

	_, err := e.updateLogs.InsertMany(ctx, documents, options.InsertMany().SetOrdered(false))
	insertedReservations, insertErr := resolveInsertedSyncUpdates(reservations, err)
	if insertErr != nil {
		return insertedReservations, fmt.Errorf("insert update logs: %w", insertErr)
	}
	return insertedReservations, nil
}

func (e *MongoExecutor) flushReservedSyncUpdates(
	ctx context.Context,
	payload FanoutPayload,
	reservations []syncUpdateReservation,
	now time.Time,
) error {
	insertedReservations, err := e.insertSyncUpdates(ctx, payload, reservations, now)
	e.publishWakeBatch(ctx, insertedReservations)
	return err
}

func resolveInsertedSyncUpdates(
	reservations []syncUpdateReservation,
	err error,
) ([]syncUpdateReservation, error) {
	if err == nil {
		return append([]syncUpdateReservation(nil), reservations...), nil
	}

	var bulkErr mongo.BulkWriteException
	if !errors.As(err, &bulkErr) {
		return nil, err
	}
	if bulkErr.WriteConcernError != nil && len(bulkErr.WriteErrors) == 0 {
		return nil, err
	}

	failedIndexes := make(map[int]struct{}, len(bulkErr.WriteErrors))
	duplicateOnly := len(bulkErr.WriteErrors) > 0
	for _, writeErr := range bulkErr.WriteErrors {
		failedIndexes[writeErr.Index] = struct{}{}
		if !isDuplicateBulkWriteError(writeErr.WriteError) {
			duplicateOnly = false
		}
	}

	inserted := make([]syncUpdateReservation, 0, len(reservations)-len(failedIndexes))
	for index, reservation := range reservations {
		if _, failed := failedIndexes[index]; failed {
			continue
		}
		inserted = append(inserted, reservation)
	}

	if duplicateOnly && bulkErr.WriteConcernError == nil {
		return inserted, nil
	}
	return inserted, err
}

func isDuplicateBulkWriteError(err mongo.WriteError) bool {
	switch err.Code {
	case 11000, 11001, 12582:
		return true
	case 16460:
		return err.HasErrorMessage("E11000")
	default:
		return err.HasErrorMessage("E11000")
	}
}

func (e *MongoExecutor) publishWakeBatch(ctx context.Context, reservations []syncUpdateReservation) {
	for _, reservation := range reservations {
		e.publishWake(ctx, reservation.UserID, reservation.UpdateID)
	}
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
