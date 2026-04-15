package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type StreamClient interface {
	XGroupCreateMkStream(ctx context.Context, stream string, group string, start string) *redis.StatusCmd
	XReadGroup(ctx context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd
	XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd
}

type StreamConsumer struct {
	client StreamClient
	cfg    config.Config
	state  *summary.Summary
	logger *log.Logger
}

func New(client StreamClient, cfg config.Config, state *summary.Summary, logger *log.Logger) *StreamConsumer {
	return &StreamConsumer{
		client: client,
		cfg:    cfg,
		state:  state,
		logger: logger,
	}
}

func (c *StreamConsumer) Run(ctx context.Context) error {
	if err := c.ensureGroup(ctx); err != nil {
		return err
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := c.ConsumeOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			c.state.RecordError(err.Error())
			c.logger.Printf("consume iteration failed: %v", err)
		}
	}
}

func (c *StreamConsumer) ConsumeOnce(ctx context.Context) error {
	streams, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    c.cfg.ConsumerGroup,
		Consumer: c.cfg.ConsumerName,
		Streams:  []string{c.cfg.StreamKey, ">"},
		Count:    c.cfg.ReadCount,
		Block:    c.cfg.BlockDuration,
		NoAck:    false,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil
		}
		return err
	}

	for _, stream := range streams {
		for _, message := range stream.Messages {
			if err := c.handleMessage(ctx, message); err != nil {
				c.state.RecordError(err.Error())
				c.logger.Printf("handle message %s failed: %v", message.ID, err)
			}
		}
	}

	return nil
}

func (c *StreamConsumer) ensureGroup(ctx context.Context) error {
	err := c.client.XGroupCreateMkStream(ctx, c.cfg.StreamKey, c.cfg.ConsumerGroup, "$").Err()
	if err == nil || strings.Contains(err.Error(), "BUSYGROUP") {
		return nil
	}
	return fmt.Errorf("create consumer group: %w", err)
}

func (c *StreamConsumer) handleMessage(ctx context.Context, message redis.XMessage) error {
	envelope, err := contracts.DecodeEnvelope(message)
	if err != nil {
		_ = c.client.XAck(ctx, c.cfg.StreamKey, c.cfg.ConsumerGroup, message.ID).Err()
		return err
	}

	c.state.RecordConsumed(envelope.Topic, message.ID, envelope.EmittedAt)
	if err := c.client.XAck(ctx, c.cfg.StreamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return fmt.Errorf("ack stream message: %w", err)
	}
	return nil
}
