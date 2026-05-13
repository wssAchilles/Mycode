package primary

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func newMongoIntegrationExecutor(t *testing.T) (*MongoExecutor, context.Context) {
	t.Helper()

	mongoURL := os.Getenv("DELIVERY_CONSUMER_MONGO_INTEGRATION_URL")
	if mongoURL == "" {
		t.Skip("set DELIVERY_CONSUMER_MONGO_INTEGRATION_URL to run Mongo integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)

	client, err := mongo.Connect(options.Client().ApplyURI(mongoURL))
	if err != nil {
		t.Fatalf("connect mongo: %v", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(ctx)
		t.Fatalf("ping mongo: %v", err)
	}

	dbName := fmt.Sprintf("delivery_consumer_integration_%d", time.Now().UnixNano())
	db := client.Database(dbName)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = db.Drop(cleanupCtx)
		_ = client.Disconnect(cleanupCtx)
	})

	return &MongoExecutor{
		cfg: config.Config{
			MongoInQueryChunkSize:  2,
			ProjectionChunkSize:    100,
			ReservationConcurrency: 8,
		},
		client:         client,
		memberStates:   db.Collection("member_states"),
		updateCounters: db.Collection("update_counters"),
		updateLogs:     db.Collection("update_logs"),
		outboxes:       db.Collection("outboxes"),
	}, ctx
}

func TestMongoIntegrationFindRecipientsMissingSyncUpdateUsesChunkedInQueries(t *testing.T) {
	executor, ctx := newMongoIntegrationExecutor(t)
	payload := FanoutPayload{
		ChatID:    "chat-1",
		MessageID: "msg-1",
		Seq:       7,
	}

	_, err := executor.updateLogs.InsertMany(ctx, []interface{}{
		bson.M{"userId": "u2", "type": "message", "chatId": payload.ChatID, "messageId": payload.MessageID},
		bson.M{"userId": "u4", "type": "message", "chatId": payload.ChatID, "messageId": payload.MessageID},
	})
	if err != nil {
		t.Fatalf("seed update logs: %v", err)
	}

	pending, err := executor.findRecipientsMissingSyncUpdate(
		ctx,
		payload,
		[]string{"u1", "u2", "u3", "u4", "u5"},
	)
	if err != nil {
		t.Fatalf("find recipients missing sync update: %v", err)
	}
	expected := []string{"u1", "u3", "u5"}
	if !reflect.DeepEqual(pending, expected) {
		t.Fatalf("expected pending recipients %#v, got %#v", expected, pending)
	}
}

func TestMongoIntegrationInsertSyncUpdatesTreatsDuplicateKeysAsIdempotent(t *testing.T) {
	executor, ctx := newMongoIntegrationExecutor(t)
	_, err := executor.updateLogs.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "userId", Value: 1},
			{Key: "updateId", Value: 1},
		},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		t.Fatalf("create unique update log index: %v", err)
	}

	inserted, err := executor.insertSyncUpdates(
		ctx,
		FanoutPayload{
			ChatID:    "chat-1",
			MessageID: "msg-1",
			Seq:       7,
		},
		[]syncUpdateReservation{
			{UserID: "u1", UpdateID: 1},
			{UserID: "u1", UpdateID: 1},
			{UserID: "u2", UpdateID: 2},
		},
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("insert sync updates: %v", err)
	}
	expectedInserted := []syncUpdateReservation{
		{UserID: "u1", UpdateID: 1},
		{UserID: "u2", UpdateID: 2},
	}
	if !reflect.DeepEqual(inserted, expectedInserted) {
		t.Fatalf("expected inserted reservations %#v, got %#v", expectedInserted, inserted)
	}

	count, err := executor.updateLogs.CountDocuments(ctx, bson.M{})
	if err != nil {
		t.Fatalf("count update logs: %v", err)
	}
	if count != int64(len(expectedInserted)) {
		t.Fatalf("expected %d update log documents, got %d", len(expectedInserted), count)
	}
}
