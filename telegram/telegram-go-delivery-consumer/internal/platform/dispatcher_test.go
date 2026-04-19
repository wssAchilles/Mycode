package platform

import (
	"context"
	"errors"
	"testing"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

type fakeTransport struct {
	publishRecords []fakePublishRecord
	replayRecords  []fakeReplayRecord
	publishErr     error
}

type fakePublishRecord struct {
	channel string
	message interface{}
}

type fakeReplayRecord struct {
	stream string
	values map[string]interface{}
}

func (f *fakeTransport) Publish(_ context.Context, channel string, message interface{}) *redis.IntCmd {
	cmd := redis.NewIntCmd(context.Background())
	if f.publishErr != nil {
		cmd.SetErr(f.publishErr)
		return cmd
	}
	f.publishRecords = append(f.publishRecords, fakePublishRecord{
		channel: channel,
		message: message,
	})
	cmd.SetVal(1)
	return cmd
}

func (f *fakeTransport) XAdd(_ context.Context, a *redis.XAddArgs) *redis.StringCmd {
	cmd := redis.NewStringCmd(context.Background())
	values, _ := a.Values.(map[string]interface{})
	f.replayRecords = append(f.replayRecords, fakeReplayRecord{
		stream: a.Stream,
		values: values,
	})
	cmd.SetVal("replay-1")
	return cmd
}

func TestDispatcherQueuesReplayWhenPresenceRunsInShadow(t *testing.T) {
	client := &fakeTransport{}
	dispatcher := NewDispatcher(client, config.Config{
		PresenceExecutionMode:   "shadow",
		PresenceOnlineChannel:   "user:online",
		PresenceOfflineChannel:  "user:offline",
		PlatformReplayStreamKey: "platform:events:replay:v1",
	})

	result, err := dispatcher.Dispatch(context.Background(), buscontracts.PlatformEventEnvelope{
		EventID:   "evt-1",
		Topic:     "presence_fanout_requested",
		EmittedAt: "2026-04-17T07:00:00Z",
		Payload:   []byte(`{"userId":"user-1","status":"online","target":"broadcast","source":"presence_service"}`),
	})
	if err != nil {
		t.Fatalf("dispatch returned error: %v", err)
	}
	if !result.Shadowed || !result.Replayed {
		t.Fatalf("expected shadowed replay result, got %#v", result)
	}
	if len(client.publishRecords) != 0 {
		t.Fatalf("expected no publish in shadow mode, got %#v", client.publishRecords)
	}
	if len(client.replayRecords) != 1 || client.replayRecords[0].stream != "platform:events:replay:v1" {
		t.Fatalf("expected one replay record, got %#v", client.replayRecords)
	}
	if client.replayRecords[0].values["status"] != "shadowed" {
		t.Fatalf("expected shadowed replay status, got %#v", client.replayRecords[0].values)
	}
	if client.replayRecords[0].values["attempt"] != 1 {
		t.Fatalf("expected replay attempt 1, got %#v", client.replayRecords[0].values)
	}
	if client.replayRecords[0].values["replay_kind"] != "automatic_fallback" {
		t.Fatalf("expected automatic fallback replay kind, got %#v", client.replayRecords[0].values)
	}
}

func TestDispatcherPublishesNotificationWhenPrimaryEnabled(t *testing.T) {
	client := &fakeTransport{}
	dispatcher := NewDispatcher(client, config.Config{
		NotificationExecutionMode: "publish",
		NotificationChannel:       "notification",
		PlatformReplayStreamKey:   "platform:events:replay:v1",
	})

	result, err := dispatcher.Dispatch(context.Background(), buscontracts.PlatformEventEnvelope{
		EventID:   "evt-2",
		Topic:     "notification_dispatch_requested",
		EmittedAt: "2026-04-17T07:00:00Z",
		Payload:   []byte(`{"userId":"user-1","type":"mention","title":"Hi","body":"hello","source":"notification_service"}`),
	})
	if err != nil {
		t.Fatalf("dispatch returned error: %v", err)
	}
	if !result.Executed || result.Replayed {
		t.Fatalf("expected executed non-replayed result, got %#v", result)
	}
	if len(client.publishRecords) != 1 || client.publishRecords[0].channel != "notification" {
		t.Fatalf("expected notification publish, got %#v", client.publishRecords)
	}
	if len(client.replayRecords) != 0 {
		t.Fatalf("expected no replay records, got %#v", client.replayRecords)
	}
}

func TestDispatcherFallsBackToReplayWhenPublishFails(t *testing.T) {
	client := &fakeTransport{publishErr: errors.New("redis offline")}
	dispatcher := NewDispatcher(client, config.Config{
		NotificationExecutionMode: "publish",
		NotificationChannel:       "notification",
		PlatformReplayStreamKey:   "platform:events:replay:v1",
	})

	result, err := dispatcher.Dispatch(context.Background(), buscontracts.PlatformEventEnvelope{
		EventID:   "evt-3",
		Topic:     "notification_dispatch_requested",
		EmittedAt: "2026-04-17T07:00:00Z",
		Payload:   []byte(`{"userId":"user-1","type":"mention","title":"Hi","body":"hello","source":"notification_service"}`),
	})
	if err != nil {
		t.Fatalf("expected replay-backed fallback instead of error, got %v", err)
	}
	if !result.Failed || !result.Fallback || !result.Replayed {
		t.Fatalf("expected failed+fallback+replayed result, got %#v", result)
	}
	if len(client.replayRecords) != 1 {
		t.Fatalf("expected replay record after publish failure, got %#v", client.replayRecords)
	}
	if client.replayRecords[0].values["status"] != "failed" {
		t.Fatalf("expected failed replay status, got %#v", client.replayRecords[0].values)
	}
}
