package primary

import (
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
