package mongoops

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type MemberStatePayload struct {
	ChatID string
	Seq    int64
}

func BuildMemberStateModels(payload MemberStatePayload, recipients []string, now time.Time) []mongo.WriteModel {
	ops := make([]mongo.WriteModel, 0, len(recipients))
	for _, userID := range recipients {
		ops = append(ops, mongo.NewUpdateOneModel().
			SetFilter(bson.M{"chatId": payload.ChatID, "userId": userID}).
			SetUpdate(bson.M{
				"$max": bson.M{"lastDeliveredSeq": payload.Seq},
				"$set": bson.M{"updatedAt": now},
				"$setOnInsert": bson.M{
					"chatId":      payload.ChatID,
					"userId":      userID,
					"lastReadSeq": 0,
					"createdAt":   now,
				},
			}).
			SetUpsert(true))
	}
	return ops
}

func UpdateMemberStates(
	ctx context.Context,
	collection *mongo.Collection,
	payload MemberStatePayload,
	recipients []string,
	now time.Time,
) error {
	ops := BuildMemberStateModels(payload, recipients, now)
	if len(ops) == 0 {
		return nil
	}
	_, err := collection.BulkWrite(ctx, ops, options.BulkWrite().SetOrdered(false))
	return err
}
