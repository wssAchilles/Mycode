package primary

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/wake"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func TestPendingSyncUpdateRecipientsFiltersExistingUsers(t *testing.T) {
	recipients := []string{"u1", "u2", "u3"}
	existing := map[string]struct{}{
		"u2": {},
	}

	pending := pendingSyncUpdateRecipients(recipients, existing)

	if len(pending) != 2 || pending[0] != "u1" || pending[1] != "u3" {
		t.Fatalf("unexpected pending recipients: %#v", pending)
	}
}

func TestChunkStringsSplitsRecipientsForMongoInQueries(t *testing.T) {
	chunks := chunkStrings([]string{"u1", "u2", "u3", "u4", "u5"}, 2)

	if len(chunks) != 3 {
		t.Fatalf("expected three chunks, got %#v", chunks)
	}
	if len(chunks[0]) != 2 || len(chunks[1]) != 2 || len(chunks[2]) != 1 {
		t.Fatalf("unexpected chunk sizes: %#v", chunks)
	}
}

func TestReservationConcurrencyBoundsConfig(t *testing.T) {
	if reservationConcurrency(0) != 8 {
		t.Fatalf("expected default reservation concurrency")
	}
	if reservationConcurrency(128) != 64 {
		t.Fatalf("expected reservation concurrency cap")
	}
	if reservationConcurrency(12) != 12 {
		t.Fatalf("expected configured reservation concurrency")
	}
}

func TestReserveSyncUpdatesBoundedCancelsAfterFirstError(t *testing.T) {
	reserveErr := errors.New("reserve failed")
	var calls int32

	reservations, err := reserveSyncUpdatesBounded(
		context.Background(),
		[]string{"u1", "u2", "u3", "u4"},
		1,
		func(_ context.Context, userID string) (syncUpdateReservation, error) {
			atomic.AddInt32(&calls, 1)
			if userID == "u2" {
				return syncUpdateReservation{}, reserveErr
			}
			return syncUpdateReservation{UserID: userID, UpdateID: int64(len(userID))}, nil
		},
	)

	if !errors.Is(err, reserveErr) {
		t.Fatalf("expected reservation error, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("expected worker to stop after first error, got %d calls", calls)
	}
	if len(reservations) != 1 || reservations[0].UserID != "u1" {
		t.Fatalf("expected successful reservations before error to be returned, got %#v", reservations)
	}
}

func TestResolveInsertedSyncUpdatesTreatsDuplicateBulkErrorsAsIdempotent(t *testing.T) {
	reservations := []syncUpdateReservation{
		{UserID: "u1", UpdateID: 1},
		{UserID: "u2", UpdateID: 2},
		{UserID: "u3", UpdateID: 3},
	}

	inserted, err := resolveInsertedSyncUpdates(reservations, mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{
				WriteError: mongo.WriteError{
					Index:   1,
					Code:    11000,
					Message: "E11000 duplicate key error",
				},
			},
		},
	})

	if err != nil {
		t.Fatalf("expected duplicate-only bulk error to be swallowed, got %v", err)
	}
	if len(inserted) != 2 || inserted[0].UserID != "u1" || inserted[1].UserID != "u3" {
		t.Fatalf("unexpected inserted reservations: %#v", inserted)
	}
}

func TestResolveInsertedSyncUpdatesReturnsNonDuplicateBulkErrors(t *testing.T) {
	reservations := []syncUpdateReservation{
		{UserID: "u1", UpdateID: 1},
	}
	bulkErr := mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{
				WriteError: mongo.WriteError{
					Index:   0,
					Code:    42,
					Message: "write failed",
				},
			},
		},
	}

	inserted, err := resolveInsertedSyncUpdates(reservations, bulkErr)

	if err == nil {
		t.Fatalf("expected non-duplicate bulk error")
	}
	if len(inserted) != 0 {
		t.Fatalf("expected no inserted reservations, got %#v", inserted)
	}
}

func TestLegacyReservationModeKeepsPerUserOrdering(t *testing.T) {
	var calls int32
	recipients := []string{"u1", "u2", "u3", "u4", "u5"}
	allocator := newLegacyPerUserReservationAllocator(2, func(_ context.Context, userID string, _ time.Time) (syncUpdateReservation, error) {
		atomic.AddInt32(&calls, 1)
		return syncUpdateReservation{UserID: userID, UpdateID: int64(len(userID))}, nil
	})

	reservations, err := allocator.Reserve(context.Background(), recipients, time.Now())
	if err != nil {
		t.Fatalf("expected legacy reservations to succeed: %v", err)
	}
	if atomic.LoadInt32(&calls) != int32(len(recipients)) {
		t.Fatalf("expected legacy mode to reserve once per recipient, got %d", calls)
	}
	if len(reservations) != len(recipients) {
		t.Fatalf("unexpected reservation count: %#v", reservations)
	}
	for index, reservation := range reservations {
		if reservation.UserID != recipients[index] || reservation.UpdateID != 2 {
			t.Fatalf("reservation order drifted: %#v", reservations)
		}
	}
}

func TestBlockReservationModeMapsRecipientsToChunkBlocks(t *testing.T) {
	var calls int32
	var chunkSizes []int
	recipients := []string{"u1", "u2", "u3", "u4", "u5"}
	allocator := newChunkBlockReservationAllocator(2, 2, func(_ context.Context, chunk []string, _ time.Time) (syncUpdateReservationBlock, error) {
		call := atomic.AddInt32(&calls, 1)
		chunkSizes = append(chunkSizes, len(chunk))
		return syncUpdateReservationBlock{
			RecipientIDs: append([]string(nil), chunk...),
			StartUpdate:  int64(call * 100),
		}, nil
	})

	reservations, err := allocator.Reserve(context.Background(), recipients, time.Now())
	if err != nil {
		t.Fatalf("expected block reservations to succeed: %v", err)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected one reservation call per chunk, got %d", calls)
	}
	if len(chunkSizes) != 3 || chunkSizes[0] != 2 || chunkSizes[1] != 2 || chunkSizes[2] != 1 {
		t.Fatalf("unexpected chunk boundaries: %#v", chunkSizes)
	}
	if len(reservations) != len(recipients) {
		t.Fatalf("unexpected reservation count: %#v", reservations)
	}
	expectedUpdates := []int64{100, 101, 200, 201, 300}
	for index, reservation := range reservations {
		if reservation.UserID != recipients[index] || reservation.UpdateID != expectedUpdates[index] {
			t.Fatalf("unexpected reservation mapping: %#v", reservations)
		}
	}
}

type recordingWakePublisher struct {
	messages []string
}

func (r *recordingWakePublisher) Publish(_ context.Context, _ string, message interface{}) *redis.IntCmd {
	r.messages = append(r.messages, message.(string))
	return redis.NewIntResult(1, nil)
}

func TestPublishWakeBatchCompatibilityModes(t *testing.T) {
	t.Run("single", func(t *testing.T) {
		publisher := &recordingWakePublisher{}
		executor := &MongoExecutor{cfg: config.Config{WakePubSubChannel: "sync:update:wake:v1", WakePublishMode: "single"}, wakePublisher: publisher}
		executor.publishWakeBatch(context.Background(), []syncUpdateReservation{{UserID: "u1", UpdateID: 1}, {UserID: "u2", UpdateID: 2}})
		if len(publisher.messages) != 2 {
			t.Fatalf("expected single publish mode to keep one payload per user, got %d", len(publisher.messages))
		}
	})

	t.Run("batch", func(t *testing.T) {
		publisher := &recordingWakePublisher{}
		executor := &MongoExecutor{cfg: config.Config{WakePubSubChannel: "sync:update:wake:v1", WakePublishMode: "batch", WakeBatchSize: 10}, wakePublisher: publisher}
		executor.publishWakeBatch(context.Background(), []syncUpdateReservation{{UserID: "u1", UpdateID: 1}, {UserID: "u2", UpdateID: 2}})
		if len(publisher.messages) != 1 {
			t.Fatalf("expected batch mode to reduce publish calls, got %d", len(publisher.messages))
		}
		var payload wake.BatchPayload
		if err := json.Unmarshal([]byte(publisher.messages[0]), &payload); err != nil {
			t.Fatalf("decode wake batch payload: %v", err)
		}
		if len(payload.Updates) != 2 || payload.Updates[1].UserID != "u2" {
			t.Fatalf("unexpected wake batch payload: %#v", payload)
		}
	})
}
