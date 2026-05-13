package primary

import (
	"context"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/reservation"
)

func reservationConcurrency(value int) int {
	return reservation.Concurrency(value)
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
	return reservation.RunBounded(ctx, recipients, maxConcurrency, reserve)
}
