package failures

import (
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

func TestClassifyDuplicateBulkWrite(t *testing.T) {
	classification := Classify(mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{WriteError: mongo.WriteError{Code: 11000, Message: "E11000 duplicate key error"}},
		},
	})

	if classification.Category != CategoryDuplicateKey || classification.Retryable || classification.Terminal {
		t.Fatalf("unexpected duplicate classification: %#v", classification)
	}
}

func TestClassifyWriteConcernAsRetryable(t *testing.T) {
	classification := Classify(mongo.BulkWriteException{
		WriteConcernError: &mongo.WriteConcernError{Code: 64, Message: "write concern failed"},
	})

	if classification.Category != CategoryWriteConcern || !classification.Retryable || classification.Terminal {
		t.Fatalf("unexpected write concern classification: %#v", classification)
	}
}

func TestClassifyContextDeadlineAsRetryableTimeout(t *testing.T) {
	classification := Classify(context.DeadlineExceeded)

	if classification.Category != CategoryTimeout || !classification.Retryable || classification.Terminal {
		t.Fatalf("unexpected timeout classification: %#v", classification)
	}
}

func TestClassifyTerminalWrite(t *testing.T) {
	classification := Classify(mongo.BulkWriteException{
		WriteErrors: []mongo.BulkWriteError{
			{WriteError: mongo.WriteError{Code: 121, Message: "document validation failure"}},
		},
	})

	if classification.Category != CategoryTerminalWrite || !classification.Terminal {
		t.Fatalf("unexpected terminal write classification: %#v", classification)
	}
}
