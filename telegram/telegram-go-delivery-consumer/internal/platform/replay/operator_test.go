package replay

import (
	"context"
	"fmt"
	"strconv"
	"testing"

	redis "github.com/redis/go-redis/v9"

	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
)

type fakeOperatorClient struct {
	streams      map[string][]redis.XMessage
	hashes       map[string]map[string]string
	nextSequence int64
}

func newFakeOperatorClient() *fakeOperatorClient {
	return &fakeOperatorClient{
		streams: make(map[string][]redis.XMessage),
		hashes:  make(map[string]map[string]string),
	}
}

func (f *fakeOperatorClient) XAdd(_ context.Context, a *redis.XAddArgs) *redis.StringCmd {
	cmd := redis.NewStringCmd(context.Background())
	f.nextSequence += 1
	id := "1713500000000-" + strconv.FormatInt(f.nextSequence, 10)
	values, _ := a.Values.(map[string]interface{})
	f.streams[a.Stream] = append(f.streams[a.Stream], redis.XMessage{
		ID:     id,
		Values: values,
	})
	cmd.SetVal(id)
	return cmd
}

func (f *fakeOperatorClient) XRange(_ context.Context, stream string, _, _ string) *redis.XMessageSliceCmd {
	cmd := redis.NewXMessageSliceCmd(context.Background())
	cmd.SetVal(append([]redis.XMessage(nil), f.streams[stream]...))
	return cmd
}

func (f *fakeOperatorClient) HExists(_ context.Context, key string, field string) *redis.BoolCmd {
	cmd := redis.NewBoolCmd(context.Background())
	_, exists := f.hashes[key][field]
	cmd.SetVal(exists)
	return cmd
}

func (f *fakeOperatorClient) HKeys(_ context.Context, key string) *redis.StringSliceCmd {
	cmd := redis.NewStringSliceCmd(context.Background())
	values := make([]string, 0, len(f.hashes[key]))
	for field := range f.hashes[key] {
		values = append(values, field)
	}
	cmd.SetVal(values)
	return cmd
}

func (f *fakeOperatorClient) HSet(_ context.Context, key string, values ...interface{}) *redis.IntCmd {
	cmd := redis.NewIntCmd(context.Background())
	if f.hashes[key] == nil {
		f.hashes[key] = make(map[string]string)
	}
	for index := 0; index+1 < len(values); index += 2 {
		field, _ := values[index].(string)
		f.hashes[key][field] = fmt.Sprint(values[index+1])
	}
	cmd.SetVal(1)
	return cmd
}

type fakeReplayDispatcher struct {
	calls int
}

func (f *fakeReplayDispatcher) DispatchReplay(
	_ context.Context,
	_ buscontracts.PlatformEventEnvelope,
	_ int,
) (platformcontracts.DispatchResult, error) {
	f.calls += 1
	return platformcontracts.DispatchResult{
		Executed: true,
	}, nil
}

func TestOperatorBuildSummaryAggregatesByTopic(t *testing.T) {
	client := newFakeOperatorClient()
	streamKey := "platform:events:replay:v1"
	writer := New(client, streamKey)
	completedKey := CompletedKey(streamKey)

	if _, err := writer.Write(context.Background(), buscontracts.PlatformEventEnvelope{
		SpecVersion: "platform.event.v1",
		Producer:    "test",
		EventID:     "evt-1",
		Topic:       "presence_fanout_requested",
		EmittedAt:   "2026-04-19T00:00:00Z",
		Payload:     []byte(`{"userId":"u1","status":"online","target":"broadcast","source":"test"}`),
	}, platformcontracts.DispatchResult{
		Topic:      "presence_fanout_requested",
		Status:     platformcontracts.ReplayStatusFailed,
		Failed:     true,
		Reason:     "presence_publish_failed",
		Attempt:    1,
		LagMillis:  34,
		ReplayKind: platformcontracts.ReplayKindAutomaticFallback,
	}); err != nil {
		t.Fatalf("write failed presence replay entry: %v", err)
	}
	if _, err := writer.Write(context.Background(), buscontracts.PlatformEventEnvelope{
		SpecVersion: "platform.event.v1",
		Producer:    "test",
		EventID:     "evt-2",
		Topic:       "notification_dispatch_requested",
		EmittedAt:   "2026-04-19T00:00:00Z",
		Payload:     []byte(`{"userId":"u1","type":"mention","title":"hi","body":"hello","source":"test"}`),
	}, platformcontracts.DispatchResult{
		Topic:      "notification_dispatch_requested",
		Status:     platformcontracts.ReplayStatusShadowed,
		Shadowed:   true,
		Reason:     "notification_shadow_mode",
		Attempt:    1,
		LagMillis:  12,
		ReplayKind: platformcontracts.ReplayKindAutomaticFallback,
	}); err != nil {
		t.Fatalf("write failed notification replay entry: %v", err)
	}
	if _, err := writer.Write(context.Background(), buscontracts.PlatformEventEnvelope{
		SpecVersion: "platform.event.v1",
		Producer:    "test",
		EventID:     "evt-3",
		Topic:       "presence_fanout_requested",
		EmittedAt:   "2026-04-19T00:00:00Z",
		Payload:     []byte(`{"userId":"u2","status":"offline","target":"broadcast","source":"test"}`),
	}, platformcontracts.DispatchResult{
		Topic:      "presence_fanout_requested",
		Status:     platformcontracts.ReplayStatusCompleted,
		Executed:   true,
		Attempt:    2,
		LagMillis:  8,
		ReplayKind: platformcontracts.ReplayKindManualDrain,
	}); err != nil {
		t.Fatalf("write failed completed replay entry: %v", err)
	}
	if err := client.HSet(context.Background(), completedKey, "presence_fanout_requested:evt-3", "2026-04-19T00:00:05Z").Err(); err != nil {
		t.Fatalf("seed completed key: %v", err)
	}

	operator := NewOperator(client, streamKey, &fakeReplayDispatcher{})
	summary, err := operator.BuildSummary(context.Background())
	if err != nil {
		t.Fatalf("build replay summary: %v", err)
	}

	if !summary.Available {
		t.Fatalf("expected available replay summary")
	}
	if summary.Totals.Backlog != 2 {
		t.Fatalf("expected backlog 2, got %#v", summary.Totals)
	}
	if summary.Totals.CompletedKeys != 1 {
		t.Fatalf("expected completed key count 1, got %#v", summary.Totals)
	}
	if summary.Totals.StatusCounts[platformcontracts.ReplayStatusFailed] != 1 {
		t.Fatalf("expected one failed status, got %#v", summary.Totals.StatusCounts)
	}
	if summary.Totals.StatusCounts[platformcontracts.ReplayStatusShadowed] != 1 {
		t.Fatalf("expected one shadowed status, got %#v", summary.Totals.StatusCounts)
	}
	if summary.Totals.StatusCounts[platformcontracts.ReplayStatusCompleted] != 1 {
		t.Fatalf("expected one completed status, got %#v", summary.Totals.StatusCounts)
	}

	presence := summary.Topics["presence_fanout_requested"]
	if presence.Backlog != 1 {
		t.Fatalf("expected presence backlog 1, got %#v", presence)
	}
	if presence.MaxAttempt != 2 || presence.LastAttempt != 2 {
		t.Fatalf("expected attempt tracking to reflect manual drain, got %#v", presence)
	}
	if presence.LastStatus != platformcontracts.ReplayStatusCompleted {
		t.Fatalf("expected latest presence status completed, got %#v", presence)
	}
	if presence.LastErrorClass != "presence_publish_failed" {
		t.Fatalf("expected retained last error class for topic, got %#v", presence)
	}
}

func TestOperatorDrainCompletesOnceAndHonorsIdempotency(t *testing.T) {
	client := newFakeOperatorClient()
	streamKey := "platform:events:replay:v1"
	writer := New(client, streamKey)
	dispatcher := &fakeReplayDispatcher{}

	if _, err := writer.Write(context.Background(), buscontracts.PlatformEventEnvelope{
		SpecVersion: "platform.event.v1",
		Producer:    "test",
		EventID:     "evt-1",
		Topic:       "presence_fanout_requested",
		EmittedAt:   "2026-04-19T00:00:00Z",
		Payload:     []byte(`{"userId":"u1","status":"online","target":"broadcast","source":"test"}`),
	}, platformcontracts.DispatchResult{
		Topic:      "presence_fanout_requested",
		Status:     platformcontracts.ReplayStatusFailed,
		Failed:     true,
		Reason:     "presence_publish_failed",
		Attempt:    1,
		LagMillis:  21,
		ReplayKind: platformcontracts.ReplayKindAutomaticFallback,
	}); err != nil {
		t.Fatalf("write failed replay entry: %v", err)
	}

	operator := NewOperator(client, streamKey, dispatcher)
	first, err := operator.Drain(context.Background(), DrainRequest{
		Topic:  "presence_fanout_requested",
		Status: platformcontracts.ReplayStatusFailed,
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("drain replay backlog: %v", err)
	}

	if first.Attempted != 1 || first.Completed != 1 || first.Replayed != 0 {
		t.Fatalf("expected completed manual drain, got %#v", first)
	}
	if dispatcher.calls != 1 {
		t.Fatalf("expected one dispatch replay call, got %d", dispatcher.calls)
	}
	if _, exists := client.hashes[CompletedKey(streamKey)]["presence_fanout_requested:evt-1"]; !exists {
		t.Fatalf("expected completed idempotency key to be recorded")
	}

	second, err := operator.Drain(context.Background(), DrainRequest{
		Topic:  "presence_fanout_requested",
		Status: platformcontracts.ReplayStatusFailed,
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("drain replay backlog second time: %v", err)
	}
	if second.Attempted != 0 {
		t.Fatalf("expected no second replay attempt after completion, got %#v", second)
	}
	if dispatcher.calls != 1 {
		t.Fatalf("expected idempotency to prevent extra dispatch calls, got %d", dispatcher.calls)
	}
}
