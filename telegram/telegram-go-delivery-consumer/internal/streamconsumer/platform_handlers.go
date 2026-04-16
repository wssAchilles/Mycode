package streamconsumer

import (
	"context"
	"fmt"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

func (c *StreamConsumer) handlePlatformEnvelope(
	ctx context.Context,
	message redis.XMessage,
	envelope contracts.PlatformEventEnvelope,
) error {
	switch envelope.Topic {
	case "sync_wake_requested":
		payload, err := contracts.DecodeSyncWakeRequestedPayload(envelope)
		if err != nil {
			return err
		}
		if c.dispatcher == nil {
			return fmt.Errorf("platform dispatcher unavailable")
		}
		result, err := c.dispatcher.DispatchSyncWake(ctx, payload)
		c.state.RecordPlatformExecution(envelope.Topic, result.Executed, result.Shadowed, result.Channel, result.Reason)
		return err
	case "presence_fanout_requested":
		payload, err := contracts.DecodePresenceFanoutRequestedPayload(envelope)
		if err != nil {
			return err
		}
		if c.dispatcher == nil {
			return fmt.Errorf("platform dispatcher unavailable")
		}
		result, err := c.dispatcher.DispatchPresenceFanout(ctx, payload)
		c.state.RecordPlatformExecution(envelope.Topic, result.Executed, result.Shadowed, result.Channel, result.Reason)
		return err
	case "notification_dispatch_requested":
		payload, err := contracts.DecodeNotificationDispatchRequestedPayload(envelope)
		if err != nil {
			return err
		}
		if c.dispatcher == nil {
			return fmt.Errorf("platform dispatcher unavailable")
		}
		result, err := c.dispatcher.DispatchNotification(ctx, payload)
		c.state.RecordPlatformExecution(envelope.Topic, result.Executed, result.Shadowed, result.Channel, result.Reason)
		return err
	default:
		return nil
	}
}
