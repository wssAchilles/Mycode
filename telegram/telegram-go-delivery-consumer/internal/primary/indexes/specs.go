package indexes

import (
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type CollectionNames struct {
	MemberStates string
	UpdateLogs   string
	Outboxes     string
}

type CollectionSpec struct {
	Collection string
	Indexes    []mongo.IndexModel
}

func Specs(names CollectionNames) []CollectionSpec {
	return []CollectionSpec{
		{
			Collection: names.MemberStates,
			Indexes: []mongo.IndexModel{
				{
					Keys: bson.D{
						{Key: "chatId", Value: 1},
						{Key: "userId", Value: 1},
					},
					Options: options.Index().SetName("member_state_chat_user_unique").SetUnique(true),
				},
			},
		},
		{
			Collection: names.UpdateLogs,
			Indexes: []mongo.IndexModel{
				{
					Keys: bson.D{
						{Key: "type", Value: 1},
						{Key: "chatId", Value: 1},
						{Key: "messageId", Value: 1},
						{Key: "userId", Value: 1},
					},
					Options: options.Index().SetName("update_log_message_user_lookup"),
				},
				{
					Keys: bson.D{
						{Key: "userId", Value: 1},
						{Key: "updateId", Value: 1},
					},
					Options: options.Index().SetName("update_log_user_update_unique").SetUnique(true),
				},
			},
		},
		{
			Collection: names.Outboxes,
			Indexes: []mongo.IndexModel{
				{
					Keys: bson.D{
						{Key: "chunks.status", Value: 1},
						{Key: "updatedAt", Value: 1},
					},
					Options: options.Index().SetName("outbox_chunk_status_updated"),
				},
			},
		},
	}
}
