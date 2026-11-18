package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"reflect"
	"sync"
	"testing"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type pelDrainMockClient struct {
	*fakeStreamClient
	mu             sync.Mutex
	readGroupArgs  [][]string
	pendingEntries []redis.XMessage
	xaddErr        error
}

func (m *pelDrainMockClient) XReadGroup(_ context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.readGroupArgs = append(m.readGroupArgs, append([]string(nil), a.Streams...))

	cmd := redis.NewXStreamSliceCmd(context.Background())
	if len(a.Streams) < 2 {
		cmd.SetVal(nil)
		return cmd
	}
	streamKey := a.Streams[0]
	cursor := a.Streams[1]
	if cursor == ">" {
		cmd.SetErr(redis.Nil)
		return cmd
	}

	// 严格模拟 Redis XREADGROUP 非 ">" 游标语义：返回 PEL 中 ID > cursor 的消息
	var matched []redis.XMessage
	for _, msg := range m.pendingEntries {
		if cursor == "0" || cursor == "0-0" || msg.ID > cursor {
			matched = append(matched, msg)
			if a.Count > 0 && int64(len(matched)) >= a.Count {
				break
			}
		}
	}
	cmd.SetVal([]redis.XStream{{Stream: streamKey, Messages: matched}})
	return cmd
}

func (m *pelDrainMockClient) XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd {
	m.mu.Lock()
	ackedSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		ackedSet[id] = struct{}{}
	}
	filtered := m.pendingEntries[:0]
	for _, entry := range m.pendingEntries {
		if _, removed := ackedSet[entry.ID]; !removed {
			filtered = append(filtered, entry)
		}
	}
	m.pendingEntries = filtered
	m.mu.Unlock()
	return m.fakeStreamClient.XAck(ctx, stream, group, ids...)
}

func (m *pelDrainMockClient) XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd {
	if m.xaddErr != nil {
		cmd := redis.NewStringCmd(context.Background())
		cmd.SetErr(m.xaddErr)
		return cmd
	}
	return m.fakeStreamClient.XAdd(ctx, a)
}

// TestPlatformStreamPELAndReclaimAcknowledgesMessages 验证平台事件在 PEL 排空与 XAUTOCLAIM 回收路径中必须执行 XACK。
func TestPlatformStreamPELAndReclaimAcknowledgesMessages(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	state.SetPlatformStreamKey("platform:events:v1")

	validPlatformMsg := func(id string, eventID string) redis.XMessage {
		return redis.XMessage{
			ID: id,
			Values: map[string]interface{}{
				"event": fmt.Sprintf(`{"specVersion":"platform.event.v1","producer":"node-backend","eventId":%q,"topic":"sync_wake_requested","emittedAt":"2026-04-16T00:00:00Z","partitionKey":"user-1","payload":{"userId":"user-1","updateId":42,"wakeChannel":"sync:update:wake:v1","source":"update_service"}}`, eventID),
			},
		}
	}

	baseClient := &fakeStreamClient{
		claimedMessages: []redis.XMessage{validPlatformMsg("20-0", "evt-reclaim-1")},
	}
	mockClient := &pelDrainMockClient{
		fakeStreamClient: baseClient,
		pendingEntries: []redis.XMessage{
			validPlatformMsg("10-0", "evt-pel-1"),
			validPlatformMsg("11-0", "evt-pel-2"),
		},
	}

	cfg := config.Config{
		StreamKey:             "chat:delivery:bus:v1",
		PlatformStreamKey:     "platform:events:v1",
		DLQStreamKey:          "chat:delivery:bus:dlq:v1",
		PlatformDLQStreamKey:  "platform:events:dlq:v1",
		ConsumerGroup:         "go-primary",
		ConsumerName:          "consumer-a",
		ExecutionMode:         "primary",
		SyncWakeExecutionMode: "publish",
		WakePubSubChannel:     "sync:update:wake:v1",
		BlockDuration:         10 * time.Millisecond,
		ReadCount:             1,
		PendingIdleDuration:   time.Minute,
		PendingClaimCount:     10,
		PendingClaimInterval:  time.Hour,
	}
	consumer := NewWithDeps(mockClient, cfg, state, log.New(io.Discard, "", 0), Dependencies{
		Dispatcher: platform.NewDispatcher(mockClient, cfg),
	})

	drained, err := consumer.drainStreamPending(context.Background(), "platform:events:v1")
	if err != nil {
		t.Fatalf("drain platform PEL failed: %v", err)
	}
	if drained != 2 {
		t.Fatalf("expected 2 drained platform messages, got %d", drained)
	}
	if err := consumer.reclaimPendingStream(context.Background(), "platform:events:v1"); err != nil {
		t.Fatalf("reclaim platform PEL failed: %v", err)
	}

	wantAcked := []string{"10-0", "11-0", "20-0"}
	if !reflect.DeepEqual(baseClient.ackedIDs, wantAcked) {
		t.Fatalf("platform PEL messages were not XACKed: got %#v want %#v", baseClient.ackedIDs, wantAcked)
	}
	for _, call := range baseClient.ackCalls {
		if call.stream != "platform:events:v1" {
			t.Fatalf("expected XACK on platform:events:v1, got %s", call.stream)
		}
	}
	if state.Snapshot().BatchAckCount != 3 {
		t.Fatalf("expected 3 batch acks recorded, got %d", state.Snapshot().BatchAckCount)
	}
}

// TestDrainStreamPendingAdvancesCursorPastUnackedPoisonMessage 验证 PEL 存在未确认毒丸时游标仍向前推进并正常退出排空阶段。
func TestDrainStreamPendingAdvancesCursorPastUnackedPoisonMessage(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-shadow", "consumer-a", "shadow", false)
	baseClient := &fakeStreamClient{}
	mockClient := &pelDrainMockClient{
		fakeStreamClient: baseClient,
		xaddErr:          errors.New("redis dlq write OOM"),
		pendingEntries: []redis.XMessage{
			{ID: "1-0", Values: map[string]interface{}{"event": "{malformed-poison"}},
			{ID: "2-0", Values: map[string]interface{}{"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-2","topic":"message_written","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"chat-1","payload":{"messageId":"msg-2"}}`}},
			{ID: "3-0", Values: map[string]interface{}{"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-3","topic":"message_written","emittedAt":"2026-04-15T00:00:01Z","partitionKey":"chat-1","payload":{"messageId":"msg-3"}}`}},
		},
	}

	consumer := New(mockClient, config.Config{
		StreamKey:     "chat:delivery:bus:v1",
		DLQStreamKey:  "chat:delivery:bus:dlq:v1",
		ConsumerGroup: "go-shadow",
		ConsumerName:  "consumer-a",
		ExecutionMode: "dry-run",
		BlockDuration: 5 * time.Millisecond,
		ReadCount:     2,
		DryRun:        true,
	}, state, log.New(io.Discard, "", 0))
	consumer.maxRecoveryBackoff = 2 * time.Millisecond

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	drained, err := consumer.drainStreamPending(ctx, "chat:delivery:bus:v1")
	if err != nil {
		t.Fatalf("drainStreamPending did not exit cleanly: %v", err)
	}
	if drained != 3 {
		t.Fatalf("expected 3 PEL entries visited once without infinite loop, got %d", drained)
	}
	// 1-0 因 DLQ 写入失败必须留在 PEL（严禁 XACK），2-0 与 3-0 正常 XACK
	wantAcked := []string{"2-0", "3-0"}
	if !reflect.DeepEqual(baseClient.ackedIDs, wantAcked) {
		t.Fatalf("unexpected acked IDs: got %#v want %#v", baseClient.ackedIDs, wantAcked)
	}
	if len(mockClient.pendingEntries) != 1 || mockClient.pendingEntries[0].ID != "1-0" {
		t.Fatalf("expected unacked poison entry 1-0 to remain in PEL, got %#v", mockClient.pendingEntries)
	}
	// 验证游标从 "0" 推进到了上一批末尾 "2-0"
	if len(mockClient.readGroupArgs) != 2 || mockClient.readGroupArgs[0][1] != "0" || mockClient.readGroupArgs[1][1] != "2-0" {
		t.Fatalf("expected advancing PEL cursors [0 -> 2-0], got %#v", mockClient.readGroupArgs)
	}
}

// TestPoisonMessageNeverAcksWhenDLQWriteFails 验证批分发链路中 DLQ 写入失败时绝不调用 XACK 且记录 ScenarioDLQWriteFailed。
func TestPoisonMessageNeverAcksWhenDLQWriteFails(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-shadow", "consumer-a", "shadow", false)
	baseClient := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{ID: "99-0", Values: map[string]interface{}{"event": "not-json"}},
				},
			},
		},
	}
	mockClient := &pelDrainMockClient{
		fakeStreamClient: baseClient,
		xaddErr:          errors.New("redis maxmemory reached"),
	}
	consumer := New(mockClient, config.Config{
		StreamKey:     "chat:delivery:bus:v1",
		DLQStreamKey:  "chat:delivery:bus:dlq:v1",
		ConsumerGroup: "go-shadow",
		ConsumerName:  "consumer-a",
		ExecutionMode: "shadow",
		BlockDuration: 5 * time.Millisecond,
		ReadCount:     10,
	}, state, log.New(io.Discard, "", 0))
	consumer.maxRecoveryBackoff = 2 * time.Millisecond

	// 直接覆盖批分发器使用的 fake streams
	mockClient.streams = baseClient.streams
	result := consumer.msgDispatcher.Dispatch(context.Background(), baseClient.streams)
	if result.Errors != 1 || len(result.Acks) != 0 {
		t.Fatalf("expected dispatch error with zero acks, got %#v", result)
	}
	if len(baseClient.ackedIDs) != 0 {
		t.Fatalf("poison message was XACKed despite DLQ failure: %#v", baseClient.ackedIDs)
	}
	if state.Snapshot().DeadLetters != 0 {
		t.Fatalf("dead-letter counter must not increment when DLQ write failed")
	}
	entries := consumer.ledger.Entries()
	if len(entries) != 1 || entries[0].Scenario != ScenarioDLQWriteFailed {
		t.Fatalf("expected ScenarioDLQWriteFailed in recovery ledger, got %#v", entries)
	}
}

type noGroupScriptedClient struct {
	*fakeStreamClient
	mu          sync.Mutex
	groupStarts []string
	readSteps   []error
	readIndex   int
	healthyRead chan struct{}
}

func (n *noGroupScriptedClient) XGroupCreateMkStream(_ context.Context, _ string, _ string, start string) *redis.StatusCmd {
	n.mu.Lock()
	n.groupStarts = append(n.groupStarts, start)
	n.mu.Unlock()
	cmd := redis.NewStatusCmd(context.Background())
	cmd.SetVal("OK")
	return cmd
}

func (n *noGroupScriptedClient) XReadGroup(_ context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd {
	cmd := redis.NewXStreamSliceCmd(context.Background())
	if len(a.Streams) >= 2 && a.Streams[len(a.Streams)-1] != ">" {
		cmd.SetErr(redis.Nil)
		return cmd
	}
	n.mu.Lock()
	idx := n.readIndex
	n.readIndex++
	var stepErr error
	if idx < len(n.readSteps) {
		stepErr = n.readSteps[idx]
	} else {
		stepErr = redis.Nil
	}
	notifyHealthy := idx > len(n.readSteps)
	n.mu.Unlock()

	if notifyHealthy && n.healthyRead != nil {
		select {
		case n.healthyRead <- struct{}{}:
		default:
		}
	}
	if stepErr != nil {
		cmd.SetErr(stepErr)
		return cmd
	}
	cmd.SetVal(nil)
	return cmd
}

// TestRunRecoversFromNoGroupWithBackoffAndRestoresHealth 验证 NOGROUP 自动重建消费组、指数退避休眠与健康态恢复。
func TestRunRecoversFromNoGroupWithBackoffAndRestoresHealth(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &noGroupScriptedClient{
		fakeStreamClient: &fakeStreamClient{},
		readSteps: []error{
			errors.New("NOGROUP No such key 'chat:delivery:bus:v1' or consumer group 'go-primary'"),
			errors.New("i/o timeout"),
			redis.Nil,
		},
		healthyRead: make(chan struct{}, 1),
	}
	consumer := New(client, config.Config{
		StreamKey:     "chat:delivery:bus:v1",
		DLQStreamKey:  "chat:delivery:bus:dlq:v1",
		ConsumerGroup: "go-primary",
		ConsumerName:  "consumer-a",
		ExecutionMode: "dry-run",
		BlockDuration: 5 * time.Millisecond,
		ReadCount:     10,
		DryRun:        true,
	}, state, log.New(io.Discard, "", 0))
	consumer.recipes[ScenarioConsumerGroupMissing] = RecoveryRecipe{
		Scenario:    ScenarioConsumerGroupMissing,
		MaxAttempts: 5,
		Escalation:  EscalationAlertHuman,
		BackoffBase: 10 * time.Millisecond,
	}
	consumer.recipes[ScenarioStreamReadFailed] = RecoveryRecipe{
		Scenario:    ScenarioStreamReadFailed,
		MaxAttempts: 5,
		Escalation:  EscalationAlertHuman,
		BackoffBase: 10 * time.Millisecond,
	}
	consumer.maxRecoveryBackoff = 50 * time.Millisecond

	startedAt := time.Now()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- consumer.Run(ctx)
	}()

	select {
	case <-client.healthyRead:
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("timed out waiting for consumer to self-heal after NOGROUP")
	}

	elapsed := time.Since(startedAt)
	// 第 1 次 10ms + 第 2 次指数翻倍 20ms = 至少 25ms，证明无 0ms 紧循环空转
	if elapsed < 25*time.Millisecond {
		cancel()
		<-done
		t.Fatalf("expected exponential backoff >= 25ms across two failures, got %v", elapsed)
	}
	if err := consumer.Healthy(); err != nil {
		cancel()
		<-done
		t.Fatalf("expected consumer to be healthy after recovery, got %v", err)
	}

	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on shutdown, got %v", err)
	}
	if err := consumer.Healthy(); err == nil {
		t.Fatalf("expected stopped consumer to report unhealthy for /health probe")
	}

	client.mu.Lock()
	starts := append([]string(nil), client.groupStarts...)
	client.mu.Unlock()
	// 启动建组使用 "$"，NOGROUP 运行期恢复使用 "0"
	if !reflect.DeepEqual(starts, []string{"$", "0"}) {
		t.Fatalf("expected group creation cursors [$ 0], got %#v", starts)
	}
}

// TestPrimaryFanoutHandlesGateDriftWithoutBlackhole 验证 Node 已委托为 go_primary 的事件在软阈值漂移时继续安全投影。
func TestPrimaryFanoutHandlesGateDriftWithoutBlackhole(t *testing.T) {
	state := summary.New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)
	client := &fakeStreamClient{
		streams: []redis.XStream{
			{
				Stream: "chat:delivery:bus:v1",
				Messages: []redis.XMessage{
					{
						ID: "50-0",
						Values: map[string]interface{}{
							"event": `{"specVersion":"chat.delivery.v1","producer":"node-backend","eventId":"evt-drift","topic":"fanout_requested","emittedAt":"2026-04-15T00:00:00Z","partitionKey":"group-drift","payload":{"messageId":"msg-drift","chatId":"group-drift","chatType":"group","seq":1,"senderId":"u1","recipientIds":["u1","u2","u3","u4","u5"],"recipientCount":5,"outboxId":"outbox-drift","dispatchMode":"go_primary"}}`,
						},
					},
				},
			},
		},
	}
	primaryExecutor := &fakePrimaryExecutor{
		result: primary.ExecutionResult{
			OutboxID:        "outbox-drift",
			RecipientCount:  5,
			ProjectionCount: 1,
		},
	}
	consumer := NewWithDeps(client, config.Config{
		StreamKey:                 "chat:delivery:bus:v1",
		DLQStreamKey:              "chat:delivery:bus:dlq:v1",
		ConsumerGroup:             "go-primary",
		ConsumerName:              "consumer-a",
		ExecutionMode:             "primary",
		GoPrimaryReady:            true,
		PrimaryGroupEnabled:       true,
		PrimaryGroupMaxRecipients: 2, // 本地阈值小于 Node 发来的 5 人群
		MaxRecipientsPerChunk:     100,
		BlockDuration:             time.Second,
		ReadCount:                 10,
	}, state, log.New(io.Discard, "", 0), Dependencies{
		PrimaryExecutor: primaryExecutor,
	})

	if err := consumer.ConsumeOnce(context.Background()); err != nil {
		t.Fatalf("consume once failed: %v", err)
	}
	if primaryExecutor.calls != 1 {
		t.Fatalf("expected drifted go_primary event to execute projection instead of blackhole drop, calls=%d", primaryExecutor.calls)
	}
	if len(client.ackedIDs) != 1 || client.ackedIDs[0] != "50-0" {
		t.Fatalf("expected projected message to be acked, got %#v", client.ackedIDs)
	}
}
