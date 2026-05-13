package failures

import (
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

func TestStrategyRetriesTimeouts(t *testing.T) {
	strategy := StrategyFor(context.DeadlineExceeded)

	if !strategy.Retryable || strategy.Terminal {
		t.Fatalf("unexpected timeout strategy: %#v", strategy)
	}
}

func TestStrategyMarksTerminalWrites(t *testing.T) {
	strategy := StrategyFor(mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{WriteError: mongo.WriteError{Code: 121, Message: "document validation failure"}},
		},
	})

	if !strategy.Terminal || strategy.Retryable {
		t.Fatalf("unexpected terminal write strategy: %#v", strategy)
	}
}

func TestStrategyTreatsDuplicateKeyAsIdempotent(t *testing.T) {
	strategy := StrategyFor(mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{WriteError: mongo.WriteError{Code: 11000, Message: "E11000 duplicate key"}},
		},
	})

	if !strategy.Handled || strategy.Terminal || strategy.Retryable {
		t.Fatalf("unexpected duplicate key strategy: %#v", strategy)
	}
}
