package mongoops

import (
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestBuildSyncUpdateDocumentsCreatesStableDocuments(t *testing.T) {
	documents := BuildSyncUpdateDocuments(
		SyncUpdatePayload{ChatID: "chat-1", Seq: 9, MessageID: "msg-1"},
		[]SyncUpdateReservation{{UserID: "u1", UpdateID: 42}},
		time.Unix(1, 0),
	)

	if len(documents) != 1 {
		t.Fatalf("expected one document, got %#v", documents)
	}
	document, ok := documents[0].(bson.M)
	if !ok {
		t.Fatalf("expected bson.M document, got %#v", documents[0])
	}
	if document["userId"] != "u1" || document["updateId"] != int64(42) || document["chatId"] != "chat-1" {
		t.Fatalf("unexpected document: %#v", document)
	}
}
