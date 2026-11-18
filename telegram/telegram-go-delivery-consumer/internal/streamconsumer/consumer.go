package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/canary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/heat"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/shadow"
	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/telemetry"
)

type StreamClient interface {
	XGroupCreateMkStream(ctx context.Context, stream string, group string, start string) *redis.StatusCmd
	XReadGroup(ctx context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd
	XAutoClaim(ctx context.Context, a *redis.XAutoClaimArgs) *redis.XAutoClaimCmd
	XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
	XTrimMaxLenApprox(ctx context.Context, stream string, maxLen int64, limit int64) *redis.IntCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
}

type StreamConsumer struct {
	client             StreamClient
	cfg                config.Config
	state              *summary.Summary
	logger             *log.Logger
	shadow             *shadow.Tracker
	canary             *canary.Writer
	deliveryDLQ        *dlq.Writer
	platformDLQ        *dlq.Writer
	ackAggregator      *AckAggregator
	primary            primary.Executor
	platformDispatcher *platform.Dispatcher
	msgDispatcher      *MessageDispatcher
	heatDetector       *heat.Detector
	heatScorer         *heat.Scorer
	heatSelector       *heat.Selector
	reclaimCursors     *reclaimstate.CursorTracker
	reclaimScheduler   *reclaimstate.Scheduler
	trimmer            *StreamTrimmer
	trimCounter        int
	draining           atomic.Bool
	cycleHealthy       atomic.Bool
	consecutiveErrors  atomic.Int32
	fatalErrMu         sync.RWMutex
	fatalErr           string
	maxRecoveryBackoff time.Duration
	processDone        chan struct{}
	tracer             *telemetry.MessageTracer
	lifecycle          *StateTracker
	events             EventSink
	recipes            map[FailureScenario]RecoveryRecipe
	ledger             *RecoveryLedger
}

type Dependencies struct {
	PrimaryExecutor primary.Executor
	Dispatcher      *platform.Dispatcher
}

func New(client StreamClient, cfg config.Config, state *summary.Summary, logger *log.Logger) *StreamConsumer {
	return NewWithDeps(client, cfg, state, logger, Dependencies{})
}

func NewWithDeps(
	client StreamClient,
	cfg config.Config,
	state *summary.Summary,
	logger *log.Logger,
	deps Dependencies,
) *StreamConsumer {
	if state != nil {
		state.SetRuntimeConfig(summary.RuntimeConfig{
			WorkerLaneCount:      cfg.ConsumerWorkerCount,
			AckBatchSize:         cfg.AckBatchSize,
			ReservationMode:      cfg.ReservationMode,
			ReservationBatchSize: cfg.ReservationBatchSize,
			WakePublishMode:      cfg.WakePublishMode,
			WakeBatchSize:        cfg.WakeBatchSize,
			OutboxAggregateMode:  "incremental_reconcile",
		})
	}

	tracker := shadow.New()
	tracker.StartCleanup(context.Background(), time.Minute, 5*time.Minute)
	trimmer := NewStreamTrimmer(client, cfg.StreamTrimThreshold, logger, state)

	heatDetector := heat.NewDetector(heat.DefaultDetectorConfig())
	heatScorer := heat.NewScorer(heat.DefaultScoreConfig())
	heatSelector := heat.NewSelector(heat.DefaultStrategyConfig())

	c := &StreamConsumer{
		client:             client,
		cfg:                cfg,
		state:              state,
		logger:             logger,
		shadow:             tracker,
		canary:             canary.New(client, cfg.CanaryStreamKey),
		deliveryDLQ:        dlq.New(client, cfg.DLQStreamKey),
		platformDLQ:        dlq.New(client, cfg.PlatformDLQStreamKey),
		primary:            deps.PrimaryExecutor,
		platformDispatcher: deps.Dispatcher,
		ackAggregator:      NewAckAggregator(client, cfg.ConsumerGroup, cfg.AckBatchSize),
		heatDetector:       heatDetector,
		heatScorer:         heatScorer,
		heatSelector:       heatSelector,
		reclaimCursors:     reclaimstate.NewCursorTracker(),
		reclaimScheduler:   reclaimstate.NewScheduler(cfg.PendingClaimInterval),
		trimmer:            trimmer,
		maxRecoveryBackoff: defaultMaxRecoveryBackoff,
		processDone:        make(chan struct{}),
		tracer:             telemetry.NewMessageTracer(),
		lifecycle:          NewStateTracker(StateSpawning),
		events:             NewCompositeEventSink(NewLogEventSink(logger), NewOTelEventSink()),
		recipes:            defaultRecipes(),
		ledger:             NewRecoveryLedger(256),
	}
	c.cycleHealthy.Store(true)

	c.msgDispatcher = NewMessageDispatcher(
		DispatchConfig{WorkerCount: cfg.ConsumerWorkerCount},
		handleMessageWrapper(c),
		applyRecoveryWrapper(c),
	)

	return c
}

// Drain signals the consumer to stop accepting new messages and waits for the
// current processing cycle to complete. This ensures no messages are left in an
// incomplete state during shutdown.
func (c *StreamConsumer) Drain(ctx context.Context) {
	_ = c.lifecycle.Transition(StateDraining)
	c.draining.Store(true)
	c.events.Emit(ConsumerEvent{Type: EventDrainStarted, Timestamp: time.Now()})
	c.logger.Println("consumer drain initiated, waiting for in-flight processing...")
	select {
	case <-c.processDone:
		c.logger.Println("consumer drained successfully")
		_ = c.lifecycle.Transition(StateStopped)
		c.events.Emit(ConsumerEvent{Type: EventDrainCompleted, Timestamp: time.Now()})
	case <-ctx.Done():
		c.logger.Println("drain timeout reached, forcing shutdown")
		_ = c.lifecycle.Transition(StateStopped)
	}
}

// Healthy 校验主消费循环的真实存活健康态，供 /health 探针拦截假阳僵尸实例。
func (c *StreamConsumer) Healthy() error {
	if c == nil {
		return errors.New("stream_consumer_unavailable")
	}
	state := c.lifecycle.Current()
	switch state {
	case StateStopped:
		if fatalErr := c.lastFatalError(); fatalErr != "" {
			return fmt.Errorf("stream_consumer_stopped: %s", fatalErr)
		}
		return errors.New("stream_consumer_stopped")
	case StateDraining:
		return errors.New("stream_consumer_draining")
	case StateSpawning, StateConnecting, StateEnsuringGroup:
		return fmt.Errorf("stream_consumer_not_ready: %s", state)
	}
	if c.draining.Load() {
		return errors.New("stream_consumer_draining")
	}
	if !c.cycleHealthy.Load() {
		return errors.New("stream_consumer_cycle_unhealthy")
	}
	return nil
}

func (c *StreamConsumer) setFatalError(err error) {
	if err == nil {
		return
	}
	c.fatalErrMu.Lock()
	defer c.fatalErrMu.Unlock()
	c.fatalErr = err.Error()
}

func (c *StreamConsumer) lastFatalError() string {
	c.fatalErrMu.RLock()
	defer c.fatalErrMu.RUnlock()
	return c.fatalErr
}

// Snapshot 返回当前消费者生命周期与恢复快照，供 /ops/consumer 端点读取。
func (c *StreamConsumer) Snapshot() map[string]any {
	healthErr := c.Healthy()
	snapshot := map[string]any{
		"healthy":               healthErr == nil,
		"lifecycle":             c.lifecycle.Current().String(),
		"recoveryLedgerEntries": c.ledger.Len(),
		"consecutiveErrors":     c.consecutiveErrors.Load(),
		"draining":              c.draining.Load(),
	}
	if healthErr != nil {
		snapshot["healthError"] = healthErr.Error()
	}
	if fatalErr := c.lastFatalError(); fatalErr != "" {
		snapshot["lastFatalError"] = fatalErr
	}
	return snapshot
}

func handleMessageWrapper(c *StreamConsumer) func(ctx context.Context, streamKey string, message redis.XMessage) (MessageResult, error) {
	return func(ctx context.Context, streamKey string, message redis.XMessage) (MessageResult, error) {
		if streamKey == c.cfg.PlatformStreamKey {
			return c.handlePlatformMessage(ctx, message)
		}
		envelope, err := contracts.DecodeEnvelope(message)
		if err != nil {
			return c.handlePoisonMessage(ctx, streamKey, message, err)
		}
		if err := c.handleEnvelope(ctx, message, envelope); err != nil {
			return c.handlePoisonMessage(ctx, streamKey, message, err)
		}
		c.state.RecordConsumed(streamKey, envelope.Topic, message.ID, envelope.EmittedAt)
		return MessageResult{
			Disposition: DispositionAck,
			Ack: AckRequest{
				StreamKey: streamKey,
				MessageID: message.ID,
			},
		}, nil
	}
}

func applyRecoveryWrapper(c *StreamConsumer) func(ctx context.Context, err error, messageID string) {
	return func(ctx context.Context, err error, messageID string) {
		c.applyRecovery(ctx, err, messageID)
	}
}
