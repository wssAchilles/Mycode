package replay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"

	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
)

type operationLog struct {
	mu    sync.Mutex
	items []string
}

func (l *operationLog) add(operation string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.items = append(l.items, operation)
}

func (l *operationLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.items...)
}

type fakeWorkerClient struct {
	log              *operationLog
	fail             string
	completed        bool
	completedByField map[string]bool
	completedFields  []string
	completionValues []interface{}
	auditKinds       []string
	auditRunIDs      []string
	claimed          []redis.XMessage
	reads            []redis.XStream
}

type scriptedGroupClient struct {
	*fakeWorkerClient
	readSteps   chan error
	readStarted chan struct{}
	groupCalls  chan struct{}
}

func (f *scriptedGroupClient) XGroupCreateMkStream(context.Context, string, string, string) *redis.StatusCmd {
	f.log.add("group")
	f.groupCalls <- struct{}{}
	cmd := redis.NewStatusCmd(context.Background())
	cmd.SetVal("OK")
	return cmd
}

func (f *scriptedGroupClient) XReadGroup(ctx context.Context, _ *redis.XReadGroupArgs) *redis.XStreamSliceCmd {
	f.log.add("xreadgroup")
	f.readStarted <- struct{}{}
	cmd := redis.NewXStreamSliceCmd(context.Background())
	select {
	case err := <-f.readSteps:
		if err != nil {
			cmd.SetErr(err)
		} else {
			cmd.SetVal(nil)
		}
	case <-ctx.Done():
		cmd.SetErr(ctx.Err())
	}
	return cmd
}

func (f *fakeWorkerClient) Ping(context.Context) *redis.StatusCmd {
	f.log.add("ping")
	cmd := redis.NewStatusCmd(context.Background())
	if f.fail == "ping" {
		cmd.SetErr(errors.New("redis unavailable"))
	} else {
		cmd.SetVal("PONG")
	}
	return cmd
}

func (f *fakeWorkerClient) XGroupCreateMkStream(context.Context, string, string, string) *redis.StatusCmd {
	f.log.add("group")
	cmd := redis.NewStatusCmd(context.Background())
	if f.fail == "group" {
		cmd.SetErr(errors.New("group unavailable"))
	} else {
		cmd.SetVal("OK")
	}
	return cmd
}

func (f *fakeWorkerClient) XReadGroup(context.Context, *redis.XReadGroupArgs) *redis.XStreamSliceCmd {
	f.log.add("xreadgroup")
	cmd := redis.NewXStreamSliceCmd(context.Background())
	if f.fail == "xreadgroup" {
		cmd.SetErr(errors.New("read unavailable"))
	} else {
		cmd.SetVal(append([]redis.XStream(nil), f.reads...))
	}
	return cmd
}

func (f *fakeWorkerClient) XAutoClaim(context.Context, *redis.XAutoClaimArgs) *redis.XAutoClaimCmd {
	f.log.add("xautoclaim")
	cmd := redis.NewXAutoClaimCmd(context.Background())
	if f.fail == "xautoclaim" {
		cmd.SetErr(errors.New("claim unavailable"))
	} else {
		cmd.SetVal(append([]redis.XMessage(nil), f.claimed...), "0-0")
		f.claimed = nil
	}
	return cmd
}

func (f *fakeWorkerClient) XAck(context.Context, string, string, ...string) *redis.IntCmd {
	f.log.add("ack")
	cmd := redis.NewIntCmd(context.Background())
	if f.fail == "ack" {
		cmd.SetErr(errors.New("ack unavailable"))
	} else {
		cmd.SetVal(1)
	}
	return cmd
}

func (f *fakeWorkerClient) XAdd(_ context.Context, args *redis.XAddArgs) *redis.StringCmd {
	operation := "audit"
	if strings.Contains(args.Stream, ":dlq:") {
		operation = "dlq"
	}
	f.log.add(operation)
	if values, ok := args.Values.(map[string]interface{}); ok {
		f.auditKinds = append(f.auditKinds, fmt.Sprint(values["replay_kind"]))
		f.auditRunIDs = append(f.auditRunIDs, fmt.Sprint(values["run_id"]))
	}
	cmd := redis.NewStringCmd(context.Background())
	if f.fail == "audit" {
		cmd.SetErr(errors.New("audit unavailable"))
	} else {
		cmd.SetVal("audit-1")
	}
	return cmd
}

func (f *fakeWorkerClient) HExists(_ context.Context, _ string, field string) *redis.BoolCmd {
	f.log.add("completed")
	f.completedFields = append(f.completedFields, field)
	cmd := redis.NewBoolCmd(context.Background())
	if f.fail == "completed" {
		cmd.SetErr(errors.New("completed lookup unavailable"))
	} else {
		completed := f.completed
		if f.completedByField != nil {
			completed = f.completedByField[field]
		}
		cmd.SetVal(completed)
	}
	return cmd
}

func (f *fakeWorkerClient) HSet(_ context.Context, _ string, values ...interface{}) *redis.IntCmd {
	f.log.add("persist")
	f.completionValues = append(f.completionValues, values...)
	cmd := redis.NewIntCmd(context.Background())
	if f.fail == "persist" {
		cmd.SetErr(errors.New("completion unavailable"))
	} else {
		cmd.SetVal(1)
	}
	return cmd
}

type fakeReplayDispatcher struct {
	log    *operationLog
	fail   bool
	called chan struct{}
}

func (f *fakeReplayDispatcher) DispatchReplay(
	context.Context,
	buscontracts.PlatformEventEnvelope,
	int,
) (platformcontracts.DispatchResult, error) {
	f.log.add("side_effect")
	if f.called != nil {
		select {
		case f.called <- struct{}{}:
		default:
		}
	}
	if f.fail {
		return platformcontracts.DispatchResult{}, errors.New("side effect unavailable")
	}
	return platformcontracts.DispatchResult{Executed: true}, nil
}

func replayTestMessage(id string, eventID string) redis.XMessage {
	return replayTestMessageForTopic(id, eventID, "presence_fanout_requested")
}

func replayTestMessageForTopic(id string, eventID string, topic string) redis.XMessage {
	return redis.XMessage{
		ID: id,
		Values: map[string]interface{}{
			"event":   `{"specVersion":"platform.event.v1","producer":"test","eventId":"` + eventID + `","topic":"` + topic + `","emittedAt":"2026-04-19T00:00:00Z","partitionKey":"user-1","payload":{"userId":"u1","status":"online","target":"broadcast","source":"test"}}`,
			"attempt": 1,
		},
	}
}

func newTestWorker(client WorkerClient, dispatcher *fakeReplayDispatcher) *Worker {
	return NewWorker(client, WorkerConfig{
		StreamKey:                "platform:events:replay:v1",
		ConsumerGroup:            "go-delivery",
		ConsumerName:             "worker-a",
		ReadCount:                10,
		BlockDuration:            time.Millisecond,
		PendingIdleDuration:      time.Minute,
		PendingClaimCount:        10,
		PendingClaimInterval:     time.Minute,
		PendingReclaimMaxBatches: 4,
		ReclaimCursorMode:        "resume",
		DeadLetterStreamKey:      "platform:events:dlq:v1",
	}, dispatcher, log.New(io.Discard, "", 0))
}

func waitSignal(t *testing.T, signal <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", name)
	}
}

func TestWorkerProcessesReplayInCommitOrderAndNeverAcksAfterFailure(t *testing.T) {
	tests := []struct {
		name       string
		fail       string
		want       []string
		dispatcher bool
	}{
		{name: "completed lookup", fail: "completed", want: []string{"completed"}},
		{name: "side effect", dispatcher: true, want: []string{"completed", "side_effect"}},
		{name: "audit append", fail: "audit", want: []string{"completed", "side_effect", "audit"}},
		{name: "completion persistence", fail: "persist", want: []string{"completed", "side_effect", "audit", "persist"}},
		{name: "ack", fail: "ack", want: []string{"completed", "side_effect", "audit", "persist", "ack"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operations := &operationLog{}
			client := &fakeWorkerClient{log: operations, fail: tt.fail}
			dispatcher := &fakeReplayDispatcher{log: operations, fail: tt.dispatcher}
			worker := newTestWorker(client, dispatcher)

			if err := worker.processMessage(context.Background(), replayTestMessage("1-0", "evt-1")); err == nil {
				t.Fatalf("expected %s failure", tt.name)
			}
			if got := operations.snapshot(); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("unexpected operation order: got %#v want %#v", got, tt.want)
			}
		})
	}

	operations := &operationLog{}
	client := &fakeWorkerClient{log: operations}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})
	if err := worker.processMessage(context.Background(), replayTestMessage("1-0", "evt-1")); err != nil {
		t.Fatalf("process replay: %v", err)
	}
	want := []string{"completed", "side_effect", "audit", "persist", "ack"}
	if got := operations.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected success order: got %#v want %#v", got, want)
	}
	if got, want := client.auditKinds, []string{platformcontracts.ReplayKindAutomaticFallback}; !reflect.DeepEqual(got, want) {
		t.Fatalf("continuous replay audit kind: got %#v want %#v", got, want)
	}
	if got, want := client.completionValues, []interface{}{"presence_fanout_requested:evt-1", platformcontracts.ReplayStatusCompleted}; !reflect.DeepEqual(got, want) {
		t.Fatalf("legacy completion contract drifted: got %#v want %#v", got, want)
	}
}

func TestWorkerAcksCompletedEventIDWithoutRepeatingSideEffect(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{log: operations, completed: true}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})

	if err := worker.processMessage(context.Background(), replayTestMessage("1-0", "evt-stable")); err != nil {
		t.Fatalf("process completed replay: %v", err)
	}
	if got, want := operations.snapshot(), []string{"completed", "ack"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("completed event repeated work: got %#v want %#v", got, want)
	}
	if got, want := client.completedFields, []string{"presence_fanout_requested:evt-stable"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("completion lookup must preserve legacy topic:event_id scope: got %#v want %#v", got, want)
	}
}

func TestWorkerCompletionDoesNotCollideAcrossTopics(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{
		log: operations,
		completedByField: map[string]bool{
			"presence_fanout_requested:evt-shared": true,
		},
	}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})

	if err := worker.processMessage(context.Background(), replayTestMessageForTopic("2-0", "evt-shared", "notification_dispatch_requested")); err != nil {
		t.Fatalf("process same event id for another topic: %v", err)
	}
	if got, want := client.completedFields, []string{"notification_dispatch_requested:evt-shared"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("completion field collided across topics: got %#v want %#v", got, want)
	}
	if got := operations.snapshot(); !slices.Contains(got, "side_effect") {
		t.Fatalf("other topic side effect was incorrectly skipped: %#v", got)
	}
}

func TestWorkerCycleUsesReclaimScannerBeforeReadingNewMessages(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{
		log:     operations,
		claimed: []redis.XMessage{replayTestMessage("1-0", "evt-reclaimed")},
	}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})
	worker.scheduler.MarkRun(time.Now())

	if err := worker.runCycle(context.Background(), cycleRequest{limit: 1, manual: true, runID: "manual-1"}); err != nil {
		t.Fatalf("run replay cycle: %v", err)
	}
	want := []string{"xautoclaim", "completed", "side_effect", "audit", "persist", "ack"}
	if got := operations.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("expected reclaimed message before new read: got %#v want %#v", got, want)
	}
	if got, want := client.auditKinds, []string{platformcontracts.ReplayKindManualDrain}; !reflect.DeepEqual(got, want) {
		t.Fatalf("manual replay audit kind: got %#v want %#v", got, want)
	}
	if got, want := client.auditRunIDs, []string{"manual-1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("manual replay run id: got %#v want %#v", got, want)
	}
}

func TestWorkerCyclePropagatesMessageFailureToHealthBoundary(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{log: operations, reads: []redis.XStream{{Messages: []redis.XMessage{replayTestMessage("3-0", "evt-fail")}}}}
	dispatcher := &fakeReplayDispatcher{log: operations, fail: true, called: make(chan struct{}, 1)}
	worker := newTestWorker(client, dispatcher)
	worker.scheduler.MarkRun(time.Now())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	waitSignal(t, dispatcher.called, "failed replay dispatch")
	deadline := time.Now().Add(time.Second)
	for {
		if err := worker.Ready(context.Background()); errors.Is(err, ErrWorkerUnavailable) {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			<-done
			t.Fatal("message failure was swallowed as a healthy cycle")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("stop replay worker: %v", err)
	}
}

func TestWorkerDeadLettersMalformedReplayBeforeAck(t *testing.T) {
	malformed := redis.XMessage{ID: "4-0", Values: map[string]interface{}{"event": "{"}}
	tests := []struct {
		name    string
		fail    string
		wantErr bool
		want    []string
	}{
		{name: "success", want: []string{"dlq", "ack"}},
		{name: "DLQ failure", fail: "audit", wantErr: true, want: []string{"dlq"}},
		{name: "ACK failure", fail: "ack", wantErr: true, want: []string{"dlq", "ack"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operations := &operationLog{}
			client := &fakeWorkerClient{log: operations, fail: tt.fail}
			worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})
			err := worker.processMessage(context.Background(), malformed)
			if (err != nil) != tt.wantErr {
				t.Fatalf("unexpected malformed replay error: %v", err)
			}
			if got := operations.snapshot(); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("malformed replay lifecycle: got %#v want %#v", got, tt.want)
			}
		})
	}
}

func TestWorkerAcceptsConcurrentWakeupsAsSerializedLimitedCycles(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{log: operations}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})
	worker.running.Store(true)

	const wakeups = 16
	results := make(chan DrainResult, wakeups)
	errorsByWakeup := make(chan error, wakeups)
	var group sync.WaitGroup
	for limit := 1; limit <= wakeups; limit++ {
		limit := limit
		group.Add(1)
		go func() {
			defer group.Done()
			result, err := worker.Drain(context.Background(), DrainRequest{Limit: limit})
			results <- result
			errorsByWakeup <- err
		}()
	}
	group.Wait()
	close(results)
	close(errorsByWakeup)

	for err := range errorsByWakeup {
		if err != nil {
			t.Fatalf("concurrent wakeup failed: %v", err)
		}
	}
	runIDs := map[string]struct{}{}
	for result := range results {
		if result.RunID == "" {
			t.Fatalf("accepted wakeup missing run id")
		}
		runIDs[result.RunID] = struct{}{}
	}
	if len(runIDs) != wakeups || len(worker.wakes) != wakeups {
		t.Fatalf("concurrent wakeups were lost: runIds=%d queued=%d", len(runIDs), len(worker.wakes))
	}
	seenLimits := map[int]struct{}{}
	for index := 0; index < wakeups; index++ {
		request := <-worker.wakes
		if !request.manual {
			t.Fatalf("drain wakeup did not request one manual cycle")
		}
		seenLimits[request.limit] = struct{}{}
	}
	if len(seenLimits) != wakeups {
		t.Fatalf("cycle limits were lost: %#v", seenLimits)
	}
}

func TestWorkerFailsClosedWhenStartupOrReadinessPingFails(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{log: operations, fail: "ping"}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})

	if err := worker.Run(context.Background()); !errors.Is(err, ErrRedisUnavailable) {
		t.Fatalf("expected startup redis failure, got %v", err)
	}
	if got, want := operations.snapshot(), []string{"ping"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("startup continued after failed ping: got %#v want %#v", got, want)
	}
	client.fail = ""
	retryCtx, cancelRetry := context.WithCancel(context.Background())
	cancelRetry()
	if err := worker.Run(retryCtx); !errors.Is(err, context.Canceled) {
		t.Fatalf("startup failure permanently latched worker: %v", err)
	}

	operations = &operationLog{}
	client = &fakeWorkerClient{log: operations, fail: "ping"}
	worker = newTestWorker(client, &fakeReplayDispatcher{log: operations})
	worker.running.Store(true)
	if _, err := worker.Drain(context.Background(), DrainRequest{Limit: 1}); !errors.Is(err, ErrRedisUnavailable) {
		t.Fatalf("expected readiness redis failure, got %v", err)
	}
	if len(worker.wakes) != 0 {
		t.Fatalf("redis failure queued replay work")
	}
}

func TestWorkerReadinessRecoversConsumerGroupBeforeReturningHealthy(t *testing.T) {
	operations := &operationLog{}
	client := &scriptedGroupClient{
		fakeWorkerClient: &fakeWorkerClient{log: operations},
		readSteps:        make(chan error, 3),
		readStarted:      make(chan struct{}, 3),
		groupCalls:       make(chan struct{}, 2),
	}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	defer func() {
		cancel()
		<-done
	}()

	waitSignal(t, client.groupCalls, "startup group creation")
	waitSignal(t, client.readStarted, "initial replay read")
	if err := worker.Ready(context.Background()); err != nil {
		t.Fatalf("expected initial worker readiness, got %v", err)
	}

	client.readSteps <- errors.New("NOGROUP No such key or consumer group")
	waitSignal(t, client.readStarted, "read after group loss")
	if err := worker.Ready(context.Background()); !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatalf("expected fail-closed readiness after group loss, got %v", err)
	}
	waitSignal(t, client.groupCalls, "consumer group recovery")

	client.readSteps <- redis.Nil
	waitSignal(t, client.readStarted, "viable read after group recovery")
	if err := worker.Ready(context.Background()); err != nil {
		t.Fatalf("expected readiness after viable recovered cycle, got %v", err)
	}
}

func TestWorkerRejectsDrainLimitAboveMaximum(t *testing.T) {
	operations := &operationLog{}
	client := &fakeWorkerClient{log: operations}
	worker := newTestWorker(client, &fakeReplayDispatcher{log: operations})
	worker.running.Store(true)

	if _, err := worker.Drain(context.Background(), DrainRequest{Limit: 201}); !errors.Is(err, ErrInvalidReplayLimit) {
		t.Fatalf("expected bounded drain limit error, got %v", err)
	}
	if len(worker.wakes) != 0 {
		t.Fatalf("over-limit drain request queued work")
	}
}
