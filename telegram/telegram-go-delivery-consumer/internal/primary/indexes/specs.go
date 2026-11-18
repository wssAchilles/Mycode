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

// Specs 返回主投影依赖集合的标准索引声明，不硬编码自定义索引名以避免与 Mongoose 默认索引名发生 Code 85 冲突。
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
					Options: options.Index().SetUnique(true),
				},
			},
		},
		{
			Collection: names.UpdateLogs,
			Indexes: []mongo.IndexModel{
				{
					Keys: bson.D{
						{Key: "userId", Value: 1},
						{Key: "type", Value: 1},
						{Key: "chatId", Value: 1},
						{Key: "messageId", Value: 1},
					},
				},
				{
					Keys: bson.D{
						{Key: "userId", Value: 1},
						{Key: "updateId", Value: 1},
					},
					Options: options.Index().SetUnique(true),
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
				},
			},
		},
	}
}
