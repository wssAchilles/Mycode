package primary

import (
	"context"
	"errors"
	"testing"

	redis "github.com/redis/go-redis/v9"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/wake"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type recordingStreamClient struct {
	publishErr error
	publishes  []interface{}
	xadds      []*redis.XAddArgs
}

func (r *recordingStreamClient) Publish(_ context.Context, _ string, message interface{}) *redis.IntCmd {
	r.publishes = append(r.publishes, message)
	if r.publishErr != nil {
		return redis.NewIntResult(0, r.publishErr)
	}
	return redis.NewIntResult(1, nil)
}

func (r *recordingStreamClient) XAdd(_ context.Context, args *redis.XAddArgs) *redis.StringCmd {
	r.xadds = append(r.xadds, args)
	return redis.NewStringResult("1-0", nil)
}

func TestExecutionLaneBoundaries(t *testing.T) {
	tests := []struct {
		name       string
		recipients int
		want       executionLane
	}{
		{name: "small lower", recipients: 1, want: executionLaneSmall},
		{name: "small upper", recipients: 20, want: executionLaneSmall},
		{name: "standard lower", recipients: 21, want: executionLaneStandard},
		{name: "standard upper", recipients: 500, want: executionLaneStandard},
		{name: "large lower", recipients: 501, want: executionLaneLarge},
		{name: "large upper", recipients: 5000, want: executionLaneLarge},
		{name: "bulk lower", recipients: 5001, want: executionLaneBulk},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyExecutionLane(tt.recipients); got != tt.want {
				t.Fatalf("expected lane %s, got %s", tt.want, got)
			}
		})
	}
}

func TestChunkIdempotencyKeyIncludesOutboxChunkAndDispatchMode(t *testing.T) {
	got := chunkIdempotencyKey("507f1f77bcf86cd799439011", 3, "go_group_canary")
	want := "507f1f77bcf86cd799439011:3:go_group_canary"
	if got != want {
		t.Fatalf("expected %s, got %s", want, got)
	}
}

func TestCompletedChunkProjectionReusesExistingProjectionCount(t *testing.T) {
	completed := completedChunkProjections([]outboxChunk{
		{
			ChunkIndex: 0,
			Status:     "completed",
			Projection: &outboxProjection{RecipientCount: 20, ChunkCount: 4},
		},
	})

	projection, exists := completed[0]
	if !exists {
		t.Fatalf("expected completed chunk projection")
	}
	if projection.ChunkCount != 4 || projection.RecipientCount != 20 {
		t.Fatalf("expected existing projection to be reused, got %#v", projection)
	}
}

func TestProjectingChunkRetryFiltersExistingSyncUpdates(t *testing.T) {
	recipients := []string{"u1", "u2", "u3"}
	existing := map[string]struct{}{"u1": {}, "u2": {}, "u3": {}}

	pending := pendingSyncUpdateRecipients(recipients, existing)

	if len(pending) != 0 {
		t.Fatalf("expected retry to skip recipients with existing update logs, got %#v", pending)
	}
}

func TestPublishWakeOrRepairWritesRepairOnWakeFailure(t *testing.T) {
	client := &recordingStreamClient{publishErr: errors.New("redis publish unavailable")}
	executor := &MongoExecutor{
		cfg: config.Config{
			WakePubSubChannel:   "sync:update:wake:v1",
			WakeRepairStreamKey: "sync:update:wake:repair:v1",
			WakePublishMode:     "single",
		},
		wakePublisher: client,
		wakeRepair:    wake.NewRepairWriter(client, "sync:update:wake:repair:v1"),
	}

	executor.PublishWakeOrRepair(
		context.Background(),
		FanoutPayload{OutboxID: "507f1f77bcf86cd799439011"},
		reservedChunk{Chunk: planner.ChunkPlan{ChunkIndex: 2, RecipientIDs: []string{"u1", "u2"}}},
		chunkProjectionResult{Reservations: []syncUpdateReservation{{UserID: "u1", UpdateID: 11}}},
	)

	if len(client.xadds) != 1 {
		t.Fatalf("expected one wake repair entry, got %#v", client.xadds)
	}
	values := client.xadds[0].Values.(map[string]interface{})
	if values["outbox_id"] != "507f1f77bcf86cd799439011" || values["chunk_index"] != 2 {
		t.Fatalf("unexpected repair payload: %#v", values)
	}
	if values["recipient_ids"] != `["u1","u2"]` {
		t.Fatalf("expected repair recipient ids, got %#v", values["recipient_ids"])
	}
	if values["reason"] == "" {
		t.Fatalf("expected repair reason")
	}
}

func TestPoisonChunkWritesDLQWhenThresholdExceeded(t *testing.T) {
	client := &recordingStreamClient{}
	executor := &MongoExecutor{dlqWriter: dlq.New(client, "chat:delivery:bus:dlq:v1")}
	outboxID := bson.NewObjectID()
	payload := FanoutPayload{
		SourceMessageID: "1-0",
		OutboxID:        outboxID.Hex(),
		DispatchMode:    "go_primary",
		AttemptCount:    2,
	}
	plan := fanoutPlan{
		OutboxObjectID: outboxID,
		Lane:           executionLaneStandard,
		Runtime:        fanoutRuntimeMetadata{RetryThreshold: 2},
	}
	reserved := reservedChunk{
		Chunk: planner.ChunkPlan{ChunkIndex: 1},
		JobID: "507f1f77bcf86cd799439011:1:go_primary",
	}

	executor.recordPoisonChunkIfThresholdExceeded(context.Background(), payload, plan, reserved, errors.New("projection failed"))

	if len(client.xadds) != 1 {
		t.Fatalf("expected one DLQ entry, got %#v", client.xadds)
	}
	values := client.xadds[0].Values.(map[string]interface{})
	if values["failure_scope"] != "chunk" || values["chunk_index"] != 1 || values["attempt_count"] != 2 {
		t.Fatalf("unexpected DLQ metadata: %#v", values)
	}
}
