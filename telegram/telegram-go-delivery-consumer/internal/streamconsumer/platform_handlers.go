package streamconsumer

import (
	"context"
	"fmt"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

func (c *StreamConsumer) handlePlatformEnvelope(
	ctx context.Context,
	_ redis.XMessage,
	envelope contracts.PlatformEventEnvelope,
) error {
	if c.platformDispatcher == nil {
		return fmt.Errorf("platform dispatcher unavailable")
	}
	result, err := c.platformDispatcher.Dispatch(ctx, envelope)
	recordPlatformResult(c.state, result)
	return err
}

func recordPlatformResult(state platformRecorder, result platformcontracts.DispatchResult) {
	state.RecordPlatformExecution(summary.PlatformExecutionRecord{
		Topic:        result.Topic,
		Executed:     result.Executed,
		Shadowed:     result.Shadowed,
		Fallback:     result.Fallback,
		Failed:       result.Failed,
		Replayed:     result.Replayed,
		Channel:      result.Channel,
		Reason:       result.Reason,
		ReplayStream: result.ReplayStream,
		ReplayID:     result.ReplayID,
		LagMillis:    result.LagMillis,
	})
}

type platformRecorder interface {
	RecordPlatformExecution(summary.PlatformExecutionRecord)
}
