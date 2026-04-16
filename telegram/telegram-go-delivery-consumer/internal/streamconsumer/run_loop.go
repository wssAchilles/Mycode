package streamconsumer

import (
	"context"
	"errors"
	"fmt"
	"strings"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

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
		Streams: []string{
			c.cfg.StreamKey,
			c.cfg.PlatformStreamKey,
			">",
			">",
		},
		Count: c.cfg.ReadCount,
		Block: c.cfg.BlockDuration,
		NoAck: false,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil
		}
		return err
	}

	for _, stream := range streams {
		for _, message := range stream.Messages {
			if err := c.handleMessage(ctx, stream.Stream, message); err != nil {
				c.state.RecordError(err.Error())
				c.logger.Printf("handle message %s failed: %v", message.ID, err)
			}
		}
	}

	return nil
}

func (c *StreamConsumer) ensureGroup(ctx context.Context) error {
	for _, stream := range c.streamKeys() {
		err := c.client.XGroupCreateMkStream(ctx, stream, c.cfg.ConsumerGroup, "$").Err()
		if err == nil || strings.Contains(err.Error(), "BUSYGROUP") {
			continue
		}
		return fmt.Errorf("create consumer group for %s: %w", stream, err)
	}
	return nil
}

func (c *StreamConsumer) handleMessage(ctx context.Context, streamKey string, message redis.XMessage) error {
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
	if err := c.client.XAck(ctx, streamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return fmt.Errorf("ack stream message: %w", err)
	}
	return nil
}

func (c *StreamConsumer) handlePlatformMessage(ctx context.Context, message redis.XMessage) error {
	envelope, err := contracts.DecodePlatformEnvelope(message)
	if err != nil {
		return c.handlePoisonMessage(ctx, c.cfg.PlatformStreamKey, message, err)
	}
	if err := c.handlePlatformEnvelope(ctx, message, envelope); err != nil {
		return c.handlePoisonMessage(ctx, c.cfg.PlatformStreamKey, message, err)
	}
	c.state.RecordConsumed(c.cfg.PlatformStreamKey, envelope.Topic, message.ID, envelope.EmittedAt)
	if err := c.client.XAck(ctx, c.cfg.PlatformStreamKey, c.cfg.ConsumerGroup, message.ID).Err(); err != nil {
		return fmt.Errorf("ack platform stream message: %w", err)
	}
	return nil
}

func (c *StreamConsumer) streamKeys() []string {
	keys := []string{c.cfg.StreamKey}
	if c.cfg.PlatformStreamKey != "" && c.cfg.PlatformStreamKey != c.cfg.StreamKey {
		keys = append(keys, c.cfg.PlatformStreamKey)
	}
	return keys
}
