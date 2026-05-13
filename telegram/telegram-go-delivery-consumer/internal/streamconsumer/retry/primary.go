package retry

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

type PrimaryFanoutEnvelope struct {
	EventID  string
	RawEvent string
}

func BuildPrimaryFanoutEnvelope(
	envelope contracts.DeliveryEventEnvelope,
	payload contracts.FanoutRequestedPayload,
	nextAttempt int,
	emittedAt time.Time,
) (PrimaryFanoutEnvelope, error) {
	payload.PrimaryAttemptCount = nextAttempt
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return PrimaryFanoutEnvelope{}, fmt.Errorf("encode primary retry payload: %w", err)
	}

	retryEnvelope := envelope
	retryEnvelope.EventID = fmt.Sprintf("%s:retry:%d", envelope.EventID, nextAttempt)
	retryEnvelope.EmittedAt = emittedAt.UTC().Format(time.RFC3339Nano)
	retryEnvelope.Payload = rawPayload

	rawEnvelope, err := json.Marshal(retryEnvelope)
	if err != nil {
		return PrimaryFanoutEnvelope{}, fmt.Errorf("encode primary retry envelope: %w", err)
	}
	return PrimaryFanoutEnvelope{
		EventID:  retryEnvelope.EventID,
		RawEvent: string(rawEnvelope),
	}, nil
}
