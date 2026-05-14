package failures

import (
	"context"
	"errors"
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

func TestStrategyUsesWrappedClassification(t *testing.T) {
	strategy := StrategyFor(ClassifiedError{
		Operation: "member_state_update",
		Classification: Classification{
			Category: CategoryTerminalWrite,
			Terminal: true,
		},
		Err: errors.New("wrapped validation failure"),
	})

	if !strategy.Terminal || strategy.Retryable || strategy.Handled {
		t.Fatalf("unexpected wrapped terminal strategy: %#v", strategy)
	}
}

func TestStrategyRetriesWriteConcernAndCanceledCategories(t *testing.T) {
	for _, err := range []error{
		ClassifiedError{Classification: Classification{Category: CategoryWriteConcern}, Err: errors.New("write concern")},
		context.Canceled,
		errors.New("unknown"),
	} {
		strategy := StrategyFor(err)
		if !strategy.Retryable || strategy.Terminal || strategy.Handled {
			t.Fatalf("expected retryable strategy for %v, got %#v", err, strategy)
		}
	}
}
