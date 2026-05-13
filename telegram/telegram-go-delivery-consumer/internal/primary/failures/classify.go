package failures

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

type Category string

const (
	CategoryNone            Category = "none"
	CategoryDuplicateKey    Category = "duplicate_key"
	CategoryWriteConcern    Category = "write_concern"
	CategoryNetwork         Category = "network"
	CategoryTimeout         Category = "timeout"
	CategoryContextCanceled Category = "context_canceled"
	CategoryTerminalWrite   Category = "terminal_write"
	CategoryUnknown         Category = "unknown"
)

type Classification struct {
	Category  Category
	Retryable bool
	Terminal  bool
}

type ClassifiedError struct {
	Operation      string
	Classification Classification
	Err            error
}

func (e ClassifiedError) Error() string {
	if e.Operation == "" {
		return fmt.Sprintf("mongo %s error: %v", e.Classification.Category, e.Err)
	}
	return fmt.Sprintf(
		"mongo %s failed with %s error: %v",
		e.Operation,
		e.Classification.Category,
		e.Err,
	)
}

func (e ClassifiedError) Unwrap() error {
	return e.Err
}

func Wrap(operation string, err error) error {
	if err == nil {
		return nil
	}
	return ClassifiedError{
		Operation:      operation,
		Classification: Classify(err),
		Err:            err,
	}
}

func CategoryOf(err error) Category {
	var classified ClassifiedError
	if errors.As(err, &classified) {
		return classified.Classification.Category
	}
	return Classify(err).Category
}

func Classify(err error) Classification {
	switch {
	case err == nil:
		return Classification{Category: CategoryNone}
	case errors.Is(err, context.Canceled):
		return Classification{Category: CategoryContextCanceled, Retryable: true}
	case errors.Is(err, context.DeadlineExceeded):
		return Classification{Category: CategoryTimeout, Retryable: true}
	case mongo.IsTimeout(err):
		return Classification{Category: CategoryTimeout, Retryable: true}
	case mongo.IsNetworkError(err):
		return Classification{Category: CategoryNetwork, Retryable: true}
	}

	var bulkErr mongo.BulkWriteException
	if errors.As(err, &bulkErr) {
		return classifyBulkWriteException(bulkErr)
	}

	var writeErr mongo.WriteException
	if errors.As(err, &writeErr) {
		return classifyWriteException(writeErr)
	}

	return Classification{Category: CategoryUnknown, Retryable: true}
}

func classifyBulkWriteException(err mongo.BulkWriteException) Classification {
	if err.WriteConcernError != nil {
		return Classification{Category: CategoryWriteConcern, Retryable: true}
	}
	if len(err.WriteErrors) > 0 && BulkWriteErrorsAreDuplicateOnly(err.WriteErrors) {
		return Classification{Category: CategoryDuplicateKey}
	}
	if len(err.WriteErrors) > 0 {
		return Classification{Category: CategoryTerminalWrite, Terminal: true}
	}
	return Classification{Category: CategoryUnknown, Retryable: true}
}

func classifyWriteException(err mongo.WriteException) Classification {
	if err.WriteConcernError != nil {
		return Classification{Category: CategoryWriteConcern, Retryable: true}
	}
	if len(err.WriteErrors) > 0 && WriteErrorsAreDuplicateOnly(err.WriteErrors) {
		return Classification{Category: CategoryDuplicateKey}
	}
	if len(err.WriteErrors) > 0 {
		return Classification{Category: CategoryTerminalWrite, Terminal: true}
	}
	return Classification{Category: CategoryUnknown, Retryable: true}
}

func BulkWriteErrorsAreDuplicateOnly(errors []mongo.BulkWriteError) bool {
	if len(errors) == 0 {
		return false
	}
	for _, writeErr := range errors {
		if !IsDuplicateWriteError(writeErr.WriteError) {
			return false
		}
	}
	return true
}

func WriteErrorsAreDuplicateOnly(errors mongo.WriteErrors) bool {
	if len(errors) == 0 {
		return false
	}
	for _, writeErr := range errors {
		if !IsDuplicateWriteError(writeErr) {
			return false
		}
	}
	return true
}

func IsDuplicateWriteError(err mongo.WriteError) bool {
	switch err.Code {
	case 11000, 11001, 12582:
		return true
	case 16460:
		return err.HasErrorMessage("E11000")
	default:
		return err.HasErrorMessage("E11000")
	}
}
