package mongoops

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type MissingSyncUpdateQuery struct {
	ChatID    string
	MessageID string
	UserIDs   []string
}

type existingSyncUpdateDocument struct {
	UserID string `bson:"userId"`
}

func FindExistingSyncUpdateUsers(
	ctx context.Context,
	collection *mongo.Collection,
	query MissingSyncUpdateQuery,
) (map[string]struct{}, error) {
	existing := make(map[string]struct{}, len(query.UserIDs))
	if len(query.UserIDs) == 0 {
		return existing, nil
	}

	cursor, err := collection.Find(
		ctx,
		bson.M{
			"userId":    bson.M{"$in": query.UserIDs},
			"type":      "message",
			"chatId":    query.ChatID,
			"messageId": query.MessageID,
		},
		options.Find().SetProjection(bson.M{"_id": 0, "userId": 1}),
	)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = cursor.Close(ctx)
	}()

	for cursor.Next(ctx) {
		var document existingSyncUpdateDocument
		if err := cursor.Decode(&document); err != nil {
			return nil, fmt.Errorf("decode existing update log: %w", err)
		}
		if document.UserID != "" {
			existing[document.UserID] = struct{}{}
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing update logs: %w", err)
	}
	return existing, nil
}
