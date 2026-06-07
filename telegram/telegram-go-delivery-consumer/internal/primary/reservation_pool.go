package primary

import (
	"context"
	"fmt"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/reservation"
)

type syncUpdateReservationAllocator interface {
	Reserve(ctx context.Context, recipients []string, now time.Time) ([]syncUpdateReservation, error)
}

type perUserReserveFunc func(context.Context, string, time.Time) (syncUpdateReservation, error)

type legacyPerUserReservationAllocator struct {
	concurrency int
	reserve     perUserReserveFunc
}

type syncUpdateReservationBlock struct {
	RecipientIDs []string
	StartUpdate  int64
}

type blockReserveFunc func(context.Context, []string, time.Time) (syncUpdateReservationBlock, error)

type chunkBlockReservationAllocator struct {
	batchSize   int
	concurrency int
	reserve     blockReserveFunc
}

func reservationConcurrency(value int) int {
	return reservation.Concurrency(value)
}

func (e *MongoExecutor) reserveSyncUpdates(ctx context.Context, recipients []string, now time.Time) ([]syncUpdateReservation, error) {
	allocator := e.reservations
	if allocator == nil {
		allocator = e.defaultSyncUpdateReservationAllocator()
	}
	return allocator.Reserve(ctx, recipients, now)
}

func (e *MongoExecutor) defaultSyncUpdateReservationAllocator() syncUpdateReservationAllocator {
	switch e.cfg.ReservationMode {
	case config.ReservationModeBlock:
		return newChunkBlockReservationAllocator(
			e.cfg.ReservationBatchSize,
			e.cfg.ReservationConcurrency,
			func(context.Context, []string, time.Time) (syncUpdateReservationBlock, error) {
				return syncUpdateReservationBlock{}, fmt.Errorf("block reservation mode requires a block allocator")
			},
		)
	default:
		return newLegacyPerUserReservationAllocator(e.cfg.ReservationConcurrency, func(ctx context.Context, userID string, now time.Time) (syncUpdateReservation, error) {
			return e.reserveSyncUpdate(ctx, userID, now)
		})
	}
}

func newLegacyPerUserReservationAllocator(concurrency int, reserve perUserReserveFunc) legacyPerUserReservationAllocator {
	return legacyPerUserReservationAllocator{
		concurrency: concurrency,
		reserve:     reserve,
	}
}

func (a legacyPerUserReservationAllocator) Reserve(ctx context.Context, recipients []string, now time.Time) ([]syncUpdateReservation, error) {
	return reserveSyncUpdatesBounded(ctx, recipients, reservationConcurrency(a.concurrency), func(ctx context.Context, userID string) (syncUpdateReservation, error) {
		return a.reserve(ctx, userID, now)
	})
}

func newChunkBlockReservationAllocator(batchSize int, concurrency int, reserve blockReserveFunc) chunkBlockReservationAllocator {
	return chunkBlockReservationAllocator{
		batchSize:   batchSize,
		concurrency: concurrency,
		reserve:     reserve,
	}
}

func (a chunkBlockReservationAllocator) Reserve(ctx context.Context, recipients []string, now time.Time) ([]syncUpdateReservation, error) {
	if len(recipients) == 0 {
		return nil, nil
	}
	chunks := chunkStrings(recipients, positiveOrDefault(a.batchSize, 1))
	blocks := make([]syncUpdateReservationBlock, 0, len(chunks))
	for _, chunk := range chunks {
		block, err := a.reserve(ctx, chunk, now)
		if len(block.RecipientIDs) == 0 && block.StartUpdate != 0 {
			block.RecipientIDs = append([]string(nil), chunk...)
		}
		if len(block.RecipientIDs) > 0 {
			blocks = append(blocks, block)
		}
		if err != nil {
			return expandSyncUpdateReservationBlocks(blocks), err
		}
	}
	return expandSyncUpdateReservationBlocks(blocks), nil
}

func reserveSyncUpdatesBounded(
	ctx context.Context,
	recipients []string,
	maxConcurrency int,
	reserve func(context.Context, string) (syncUpdateReservation, error),
) ([]syncUpdateReservation, error) {
	return reservation.RunBounded(ctx, recipients, maxConcurrency, reserve)
}

func expandSyncUpdateReservationBlocks(blocks []syncUpdateReservationBlock) []syncUpdateReservation {
	total := 0
	for _, block := range blocks {
		total += len(block.RecipientIDs)
	}
	reservations := make([]syncUpdateReservation, 0, total)
	for _, block := range blocks {
		for offset, userID := range block.RecipientIDs {
			reservations = append(reservations, syncUpdateReservation{
				UserID:   userID,
				UpdateID: block.StartUpdate + int64(offset),
			})
		}
	}
	return reservations
}
