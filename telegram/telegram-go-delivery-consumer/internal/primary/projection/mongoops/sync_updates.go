package mongoops

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type SyncUpdatePayload struct {
	ChatID    string
	Seq       int64
	MessageID string
}

type SyncUpdateReservation struct {
	UserID   string
	UpdateID int64
}

func BuildSyncUpdateDocuments(
	payload SyncUpdatePayload,
	reservations []SyncUpdateReservation,
	now time.Time,
) []interface{} {
	documents := make([]interface{}, 0, len(reservations))
	for _, reservation := range reservations {
		documents = append(documents, bson.M{
			"userId":    reservation.UserID,
			"updateId":  reservation.UpdateID,
			"type":      "message",
			"chatId":    payload.ChatID,
			"seq":       payload.Seq,
			"messageId": payload.MessageID,
			"payload":   nil,
			"createdAt": now,
		})
	}
	return documents
}

func InsertSyncUpdates(
	ctx context.Context,
	collection *mongo.Collection,
	payload SyncUpdatePayload,
	reservations []SyncUpdateReservation,
	now time.Time,
) error {
	documents := BuildSyncUpdateDocuments(payload, reservations, now)
	if len(documents) == 0 {
		return nil
	}
	_, err := collection.InsertMany(ctx, documents, options.InsertMany().SetOrdered(false))
	return err
}
