package reservation

import (
	"context"
	"errors"
	"sort"
	"sync"
)

const DefaultConcurrency = 8

func Concurrency(value int) int {
	if value <= 0 {
		return DefaultConcurrency
	}
	if value > 64 {
		return 64
	}
	return value
}

type indexedResult[T any] struct {
	index int
	value T
}

type job struct {
	index int
	key   string
}

type result[T any] struct {
	index int
	value T
	err   error
}

func RunBounded[T any](
	ctx context.Context,
	keys []string,
	maxConcurrency int,
	reserve func(context.Context, string) (T, error),
) ([]T, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	if maxConcurrency <= 0 || maxConcurrency > len(keys) {
		maxConcurrency = len(keys)
	}

	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan job)
	results := make(chan result[T], len(keys))

	var workers sync.WaitGroup
	workers.Add(maxConcurrency)
	for worker := 0; worker < maxConcurrency; worker++ {
		go func() {
			defer workers.Done()
			for job := range jobs {
				value, err := reserve(workerCtx, job.key)
				if err != nil {
					cancel()
				}
				results <- result[T]{
					index: job.index,
					value: value,
					err:   err,
				}
				if err != nil {
					return
				}
			}
		}()
	}

producer:
	for index, key := range keys {
		select {
		case <-workerCtx.Done():
			break producer
		case jobs <- job{index: index, key: key}:
		}
	}
	close(jobs)
	workers.Wait()
	close(results)

	return collectResults(results)
}

func collectResults[T any](results <-chan result[T]) ([]T, error) {
	indexed := make([]indexedResult[T], 0)
	var firstErr error
	for result := range results {
		if result.err != nil {
			firstErr = preferredError(firstErr, result.err)
			continue
		}
		indexed = append(indexed, indexedResult[T]{
			index: result.index,
			value: result.value,
		})
	}
	sort.Slice(indexed, func(i, j int) bool {
		return indexed[i].index < indexed[j].index
	})

	values := make([]T, 0, len(indexed))
	for _, item := range indexed {
		values = append(values, item.value)
	}
	return values, firstErr
}

func preferredError(current error, next error) error {
	if current == nil {
		return next
	}
	if errors.Is(current, context.Canceled) && !errors.Is(next, context.Canceled) {
		return next
	}
	return current
}
