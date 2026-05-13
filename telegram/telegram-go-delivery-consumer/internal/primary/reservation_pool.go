package primary

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

const maxSyncUpdateReservationConcurrency = 8

func reservationConcurrency(value int) int {
	if value <= 0 {
		return maxSyncUpdateReservationConcurrency
	}
	if value > 64 {
		return 64
	}
	return value
}

type indexedSyncUpdateReservation struct {
	Index       int
	Reservation syncUpdateReservation
}

type reservationJob struct {
	index  int
	userID string
}

type reservationResult struct {
	index       int
	reservation syncUpdateReservation
	err         error
}

func (e *MongoExecutor) reserveSyncUpdates(ctx context.Context, recipients []string, now time.Time) ([]syncUpdateReservation, error) {
	return reserveSyncUpdatesBounded(ctx, recipients, reservationConcurrency(e.cfg.ReservationConcurrency), func(ctx context.Context, userID string) (syncUpdateReservation, error) {
		return e.reserveSyncUpdate(ctx, userID, now)
	})
}

func reserveSyncUpdatesBounded(
	ctx context.Context,
	recipients []string,
	maxConcurrency int,
	reserve func(context.Context, string) (syncUpdateReservation, error),
) ([]syncUpdateReservation, error) {
	if len(recipients) == 0 {
		return nil, nil
	}
	if maxConcurrency <= 0 || maxConcurrency > len(recipients) {
		maxConcurrency = len(recipients)
	}

	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan reservationJob)
	results := make(chan reservationResult, len(recipients))

	var workers sync.WaitGroup
	workers.Add(maxConcurrency)
	for worker := 0; worker < maxConcurrency; worker++ {
		go func() {
			defer workers.Done()
			for job := range jobs {
				reservation, err := reserve(workerCtx, job.userID)
				if err != nil {
					cancel()
				}
				results <- reservationResult{
					index:       job.index,
					reservation: reservation,
					err:         err,
				}
				if err != nil {
					return
				}
			}
		}()
	}

producer:
	for index, userID := range recipients {
		select {
		case <-workerCtx.Done():
			break producer
		case jobs <- reservationJob{index: index, userID: userID}:
		}
	}
	close(jobs)
	workers.Wait()
	close(results)

	return collectReservationResults(results)
}

func collectReservationResults(results <-chan reservationResult) ([]syncUpdateReservation, error) {
	indexed := make([]indexedSyncUpdateReservation, 0)
	var firstErr error
	for result := range results {
		if result.err != nil {
			firstErr = preferredReservationError(firstErr, result.err)
			continue
		}
		indexed = append(indexed, indexedSyncUpdateReservation{
			Index:       result.index,
			Reservation: result.reservation,
		})
	}
	sort.Slice(indexed, func(i, j int) bool {
		return indexed[i].Index < indexed[j].Index
	})

	reservations := make([]syncUpdateReservation, 0, len(indexed))
	for _, item := range indexed {
		reservations = append(reservations, item.Reservation)
	}
	return reservations, firstErr
}

func preferredReservationError(current error, next error) error {
	if current == nil {
		return next
	}
	if errors.Is(current, context.Canceled) && !errors.Is(next, context.Canceled) {
		return next
	}
	return current
}
