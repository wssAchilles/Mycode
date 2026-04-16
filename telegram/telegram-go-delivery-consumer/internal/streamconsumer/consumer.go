package streamconsumer

import (
	"context"
	"log"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/canary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/shadow"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type StreamClient interface {
	XGroupCreateMkStream(ctx context.Context, stream string, group string, start string) *redis.StatusCmd
	XReadGroup(ctx context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd
	XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd
	XAdd(ctx context.Context, a *redis.XAddArgs) *redis.StringCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
}

type StreamConsumer struct {
	client      StreamClient
	cfg         config.Config
	state       *summary.Summary
	logger      *log.Logger
	shadow      *shadow.Tracker
	canary      *canary.Writer
	deliveryDLQ *dlq.Writer
	platformDLQ *dlq.Writer
	primary     primary.Executor
	dispatcher  *platform.Dispatcher
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
	return &StreamConsumer{
		client:      client,
		cfg:         cfg,
		state:       state,
		logger:      logger,
		shadow:      shadow.New(),
		canary:      canary.New(client, cfg.CanaryStreamKey),
		deliveryDLQ: dlq.New(client, cfg.DLQStreamKey),
		platformDLQ: dlq.New(client, cfg.PlatformDLQStreamKey),
		primary:     deps.PrimaryExecutor,
		dispatcher:  deps.Dispatcher,
	}
}
