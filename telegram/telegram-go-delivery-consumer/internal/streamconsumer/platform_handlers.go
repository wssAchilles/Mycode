package streamconsumer

import (
	"context"
	"fmt"

	redis "github.com/redis/go-redis/v9"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
)

func (c *StreamConsumer) handlePlatformEnvelope(
	ctx context.Context,
	_ redis.XMessage,
	envelope contracts.PlatformEventEnvelope,
) error {
	if c.dispatcher == nil {
		return fmt.Errorf("platform dispatcher unavailable")
	}
	result, err := c.dispatcher.Dispatch(ctx, envelope)
	recordPlatformResult(c.state, result)
	return err
}

func recordPlatformResult(state platformRecorder, result platformcontracts.DispatchResult) {
	state.RecordPlatformExecution(
		result.Topic,
		result.Executed,
		result.Shadowed,
		result.Fallback,
		result.Failed,
		result.Replayed,
		result.Channel,
		result.Reason,
		result.ReplayStream,
		result.ReplayID,
		result.LagMillis,
	)
}

type platformRecorder interface {
	RecordPlatformExecution(
		topic string,
		executed bool,
		shadowed bool,
		fallback bool,
		failed bool,
		replayed bool,
		channel string,
		reason string,
		replayStream string,
		replayID string,
		lagMillis int64,
	)
}
