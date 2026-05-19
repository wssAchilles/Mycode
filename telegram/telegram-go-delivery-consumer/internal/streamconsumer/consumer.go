package streamconsumer

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/canary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
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
	client           StreamClient
	cfg              config.Config
	state            *summary.Summary
	logger           *log.Logger
	shadow           *shadow.Tracker
	canary           *canary.Writer
	deliveryDLQ      *dlq.Writer
	platformDLQ      *dlq.Writer
	primary          primary.Executor
	dispatcher       *platform.Dispatcher
	reclaimCursors   *reclaimstate.CursorTracker
	reclaimScheduler *reclaimstate.Scheduler
	trimmer          *StreamTrimmer
	trimCounter      int
	draining         atomic.Bool
	processDone      chan struct{}
	tracer           *telemetry.MessageTracer
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
	tracker := shadow.New()
	tracker.StartCleanup(context.Background(), time.Minute, 5*time.Minute)
	trimmer := NewStreamTrimmer(client, cfg.StreamTrimThreshold, logger, state)
	return &StreamConsumer{
		client:         client,
		cfg:            cfg,
		state:          state,
		logger:         logger,
		shadow:         tracker,
		canary:         canary.New(client, cfg.CanaryStreamKey),
		deliveryDLQ:    dlq.New(client, cfg.DLQStreamKey),
		platformDLQ:    dlq.New(client, cfg.PlatformDLQStreamKey),
		primary:        deps.PrimaryExecutor,
		dispatcher:     deps.Dispatcher,
		reclaimCursors: reclaimstate.NewCursorTracker(),
		reclaimScheduler: reclaimstate.NewScheduler(
			cfg.PendingClaimInterval,
		),
		trimmer:     trimmer,
		processDone: make(chan struct{}),
		tracer:      telemetry.NewMessageTracer(),
	}
}

// Drain signals the consumer to stop accepting new messages and waits for the
// current processing cycle to complete. This ensures no messages are left in an
// incomplete state during shutdown.
func (c *StreamConsumer) Drain(ctx context.Context) {
	c.draining.Store(true)
	c.logger.Println("consumer drain initiated, waiting for in-flight processing...")
	select {
	case <-c.processDone:
		c.logger.Println("consumer drained successfully")
	case <-ctx.Done():
		c.logger.Println("drain timeout reached, forcing shutdown")
	}
}
