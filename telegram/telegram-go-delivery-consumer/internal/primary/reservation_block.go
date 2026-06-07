package primary

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/failures"
)

type reservationBlock struct {
	UserID      string
	StartUpdate int64
	Count       int
}

func (e *MongoExecutor) reserveSyncUpdateBlock(ctx context.Context, userID string, count int, now time.Time) (reservationBlock, error) {
	if count <= 0 {
		return reservationBlock{}, nil
	}
	var counter updateCounterDocument
	err := e.updateCounters.FindOneAndUpdate(
		ctx,
		bson.M{"_id": userID},
		bson.M{
			"$inc": bson.M{"updateId": count},
			"$set": bson.M{"updatedAt": now},
		},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&counter)
	if err != nil {
		return reservationBlock{}, fmt.Errorf("reserve update id block: %w", failures.Wrap("reserve_update_id_block", err))
	}
	return reservationBlock{
		UserID:      userID,
		StartUpdate: counter.UpdateID - int64(count) + 1,
		Count:       count,
	}, nil
}

func expandReservationBlocks(blocks []reservationBlock) []syncUpdateReservation {
	total := 0
	for _, block := range blocks {
		total += block.Count
	}
	reservations := make([]syncUpdateReservation, 0, total)
	for _, block := range blocks {
		for offset := 0; offset < block.Count; offset++ {
			reservations = append(reservations, syncUpdateReservation{
				UserID:   block.UserID,
				UpdateID: block.StartUpdate + int64(offset),
			})
		}
	}
	return reservations
}
