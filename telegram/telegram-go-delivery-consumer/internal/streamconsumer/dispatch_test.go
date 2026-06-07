package streamconsumer

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"
)

func TestMessageDispatcherPreservesOrderingWithinKey(t *testing.T) {
	var (
		mu    sync.Mutex
		order []string
	)

	dispatcher := NewMessageDispatcher(
		DispatchConfig{WorkerCount: 4},
		func(_ context.Context, streamKey string, message redis.XMessage) (MessageResult, error) {
			mu.Lock()
			order = append(order, streamKey+":"+message.ID)
			mu.Unlock()
			return MessageResult{Disposition: DispositionAck, Ack: AckRequest{StreamKey: streamKey, MessageID: message.ID}}, nil
		},
		func(context.Context, error, string) {},
	)

	streams := []redis.XStream{{
		Stream: "chat",
		Messages: []redis.XMessage{
			{ID: "1", Values: map[string]any{"event": `{"payload":{"chatId":"same"}}`}},
			{ID: "2", Values: map[string]any{"event": `{"payload":{"chatId":"same"}}`}},
			{ID: "3", Values: map[string]any{"event": `{"payload":{"chatId":"same"}}`}},
		},
	}}

	dispatcher.Dispatch(context.Background(), streams)

	if got := len(order); got != 3 {
		t.Fatalf("expected 3 messages, got %d", got)
	}
	for i, id := range []string{"chat:1", "chat:2", "chat:3"} {
		if order[i] != id {
			t.Fatalf("expected ordering %v, got %v", []string{"chat:1", "chat:2", "chat:3"}, order)
		}
	}
}

func TestMessageDispatcherRunsDifferentKeysConcurrently(t *testing.T) {
	var inFlight int32
	started := make(chan string, 2)
	release := make(chan struct{})

	dispatcher := NewMessageDispatcher(
		DispatchConfig{WorkerCount: 8},
		func(_ context.Context, streamKey string, message redis.XMessage) (MessageResult, error) {
			if atomic.AddInt32(&inFlight, 1) > 1 {
				started <- message.ID
			}
			started <- message.ID
			<-release
			atomic.AddInt32(&inFlight, -1)
			return MessageResult{Disposition: DispositionAck, Ack: AckRequest{StreamKey: streamKey, MessageID: message.ID}}, nil
		},
		func(context.Context, error, string) {},
	)

	done := make(chan struct{})
	go func() {
		defer close(done)
		dispatcher.Dispatch(context.Background(), []redis.XStream{{
			Stream: "chat",
			Messages: []redis.XMessage{
				{ID: "1", Values: map[string]any{"event": `{"payload":{"chatId":"a"}}`}},
				{ID: "2", Values: map[string]any{"event": `{"payload":{"chatId":"b"}}`}},
			},
		}})
	}()

	timeout := time.After(2 * time.Second)
	seen := 0
	for seen < 2 {
		select {
		case <-started:
			seen++
		case <-timeout:
			t.Fatal("expected concurrent handlers to start")
		}
	}
	close(release)
	<-done
}

func TestAckAggregatorBatchesPerStream(t *testing.T) {
	client := &fakeStreamClient{}
	aggregator := NewAckAggregator(client, "group-a", 2)

	err := aggregator.Ack(context.Background(), []AckRequest{
		{StreamKey: "stream-a", MessageID: "1"},
		{StreamKey: "stream-a", MessageID: "2"},
		{StreamKey: "stream-a", MessageID: "3"},
		{StreamKey: "stream-b", MessageID: "4"},
	})
	if err != nil {
		t.Fatalf("unexpected ack error: %v", err)
	}

	if len(client.ackCalls) != 3 {
		t.Fatalf("expected 3 ack calls, got %#v", client.ackCalls)
	}
	if client.ackCalls[0].stream != "stream-a" || len(client.ackCalls[0].ids) != 2 {
		t.Fatalf("unexpected first ack call: %#v", client.ackCalls[0])
	}
	if client.ackCalls[1].stream != "stream-a" || len(client.ackCalls[1].ids) != 1 {
		t.Fatalf("unexpected second ack call: %#v", client.ackCalls[1])
	}
	if client.ackCalls[2].stream != "stream-b" || len(client.ackCalls[2].ids) != 1 {
		t.Fatalf("unexpected third ack call: %#v", client.ackCalls[2])
	}
}
