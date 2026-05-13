package primary

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

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
	if reservationConcurrency(0) != maxSyncUpdateReservationConcurrency {
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
