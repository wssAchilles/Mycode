package primary

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/failures"
	projectionlogic "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/projection"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/projection/mongoops"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/wake"
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
		projectionCount++
	}
	return projectionCount, nil
}

func (e *MongoExecutor) updateMemberStates(ctx context.Context, payload FanoutPayload, recipients []string) error {
	now := time.Now().UTC()
	err := mongoops.UpdateMemberStates(
		ctx,
		e.memberStates,
		mongoops.MemberStatePayload{
			ChatID: payload.ChatID,
			Seq:    payload.Seq,
		},
		recipients,
		now,
	)
	if err != nil {
		return fmt.Errorf("bulk update member state: %w", failures.Wrap("member_state_bulk_update", err))
	}
	return nil
}

type syncUpdateReservation = mongoops.SyncUpdateReservation

func (e *MongoExecutor) appendSyncUpdates(ctx context.Context, payload FanoutPayload, recipients []string) error {
	pendingRecipients, err := e.findRecipientsMissingSyncUpdate(ctx, payload, recipients)
	if err != nil {
		return err
	}
	if len(pendingRecipients) == 0 {
		return nil
	}
	now := time.Now().UTC()
	reservations, reserveErr := e.reserveSyncUpdates(ctx, pendingRecipients, now)
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
	return e.flushReservedSyncUpdates(ctx, payload, reservations, now)
}

func (e *MongoExecutor) findRecipientsMissingSyncUpdate(ctx context.Context, payload FanoutPayload, recipients []string) ([]string, error) {
	existing := make(map[string]struct{}, len(recipients))
	chunkSize := positiveOrDefault(e.cfg.MongoInQueryChunkSize, len(recipients))
	for _, chunk := range chunkStrings(recipients, chunkSize) {
		chunkExisting, err := mongoops.FindExistingSyncUpdateUsers(
			ctx,
			e.updateLogs,
			mongoops.MissingSyncUpdateQuery{
				ChatID:    payload.ChatID,
				MessageID: payload.MessageID,
				UserIDs:   chunk,
			},
		)
		if err != nil {
			return nil, fmt.Errorf("check existing update logs: %w", failures.Wrap("find_missing_sync_updates", err))
		}
		for userID := range chunkExisting {
			existing[userID] = struct{}{}
		}
	}

	return pendingSyncUpdateRecipients(recipients, existing), nil
}

func chunkStrings(values []string, chunkSize int) [][]string {
	return projectionlogic.ChunkStrings(values, positiveOrDefault(chunkSize, len(values)))
}

func pendingSyncUpdateRecipients(recipients []string, existing map[string]struct{}) []string {
	return projectionlogic.PendingRecipients(recipients, existing)
}

func (e *MongoExecutor) reserveSyncUpdate(ctx context.Context, userID string, now time.Time) (syncUpdateReservation, error) {
	block, err := e.reserveSyncUpdateBlock(ctx, userID, 1, now)
	if err != nil {
		return syncUpdateReservation{}, err
	}
	return syncUpdateReservation{UserID: block.UserID, UpdateID: block.StartUpdate}, nil
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
	err := mongoops.InsertSyncUpdates(
		ctx,
		e.updateLogs,
		mongoops.SyncUpdatePayload{
			ChatID:    payload.ChatID,
			Seq:       payload.Seq,
			MessageID: payload.MessageID,
		},
		reservations,
		now,
	)
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
		return nil, failures.Wrap("insert_update_logs", err)
	}
	if bulkErr.WriteConcernError != nil && len(bulkErr.WriteErrors) == 0 {
		return nil, failures.Wrap("insert_update_logs", err)
	}

	failedIndexes := make(map[int]struct{}, len(bulkErr.WriteErrors))
	duplicateOnly := len(bulkErr.WriteErrors) > 0
	for _, writeErr := range bulkErr.WriteErrors {
		failedIndexes[writeErr.Index] = struct{}{}
		if !failures.IsDuplicateWriteError(writeErr.WriteError) {
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
	return inserted, failures.Wrap("insert_update_logs", err)
}

func (e *MongoExecutor) publishWakeBatch(ctx context.Context, reservations []syncUpdateReservation) {
	if e.wakePublisher == nil || e.cfg.WakePubSubChannel == "" || len(reservations) == 0 {
		return
	}
	if e.cfg.WakePublishMode == "batch" {
		batchSize := positiveOrDefault(e.cfg.WakeBatchSize, len(reservations))
		for start := 0; start < len(reservations); start += batchSize {
			end := start + batchSize
			if end > len(reservations) {
				end = len(reservations)
			}
			e.publishWakeReservationBatch(ctx, reservations[start:end])
		}
		return
	}
	for _, reservation := range reservations {
		e.publishSingleWake(ctx, reservation.UserID, reservation.UpdateID)
	}
}

func (e *MongoExecutor) publishWakeReservationBatch(ctx context.Context, reservations []syncUpdateReservation) {
	updates := make([]wake.Payload, 0, len(reservations))
	for _, reservation := range reservations {
		updates = append(updates, wake.Payload{
			UserID:   reservation.UserID,
			UpdateID: reservation.UpdateID,
		})
	}
	payload, err := wake.EncodeBatch(updates)
	if err != nil {
		if e.logger != nil {
			e.logger.Printf("warn: encode wake batch failed: %v", err)
		}
		return
	}
	if err := e.wakePublisher.Publish(ctx, e.cfg.WakePubSubChannel, payload).Err(); err != nil && e.logger != nil {
		e.logger.Printf("warn: publish wake batch failed: %v", err)
	}
}

func (e *MongoExecutor) publishSingleWake(ctx context.Context, userID string, updateID int64) {
	payload, err := wake.Encode(userID, updateID)
	if err != nil {
		return
	}
	if err := e.wakePublisher.Publish(ctx, e.cfg.WakePubSubChannel, payload).Err(); err != nil {
		if e.logger != nil {
			e.logger.Printf("warn: publish wake for user %s failed: %v", userID, err)
		}
	}
}
