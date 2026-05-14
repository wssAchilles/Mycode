package delivery

import (
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/failures"
)

func TestDecidePrimaryFailureQueuesRetryForRetryableError(t *testing.T) {
	decision := DecidePrimaryFailure(context.DeadlineExceeded, 1, 3)

	if decision.Category != failures.CategoryTimeout || !decision.QueueRetry || decision.Terminal || decision.Handled {
		t.Fatalf("unexpected retry decision: %#v", decision)
	}
}

func TestDecidePrimaryFailureMarksDuplicateAsHandled(t *testing.T) {
	decision := DecidePrimaryFailure(mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{WriteError: mongo.WriteError{Code: 11000, Message: "E11000 duplicate key"}},
		},
	}, 1, 3)

	if decision.Category != failures.CategoryDuplicateKey || !decision.Handled || decision.QueueRetry || decision.Terminal {
		t.Fatalf("unexpected duplicate decision: %#v", decision)
	}
}

func TestDecidePrimaryFailureMarksTerminalWrite(t *testing.T) {
	decision := DecidePrimaryFailure(mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{WriteError: mongo.WriteError{Code: 121, Message: "document validation failure"}},
		},
	}, 1, 3)

	if decision.Category != failures.CategoryTerminalWrite || !decision.Terminal || decision.QueueRetry || decision.Handled {
		t.Fatalf("unexpected terminal decision: %#v", decision)
	}
}
