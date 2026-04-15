package primary

import (
	"context"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

type FanoutPayload struct {
	EventID         string
	SourceMessageID string
	MessageID       string
	ChatID          string
	ChatType        string
	Seq             int64
	SenderID        string
	RecipientIDs    []string
	OutboxID        string
	DispatchMode    string
	AttemptCount    int
}

type ExecutionResult struct {
	OutboxID        string
	RecipientCount  int
	ProjectionCount int
}

type Eligibility struct {
	Eligible bool
	Reason   string
	Segment  string
}

type Executor interface {
	ExecuteFanout(ctx context.Context, payload FanoutPayload) (ExecutionResult, error)
}

type FailureRecorder interface {
	RecordFailure(ctx context.Context, payload FanoutPayload, reason string, terminal bool) error
}

func FromEnvelope(
	sourceMessageID string,
	envelope contracts.DeliveryEventEnvelope,
	payload contracts.FanoutRequestedPayload,
) FanoutPayload {
	attemptCount := payload.PrimaryAttemptCount
	if attemptCount <= 0 {
		attemptCount = 1
	}
	return FanoutPayload{
		EventID:         envelope.EventID,
		SourceMessageID: sourceMessageID,
		MessageID:       payload.MessageID,
		ChatID:          payload.ChatID,
		ChatType:        payload.ChatType,
		Seq:             payload.Seq,
		SenderID:        payload.SenderID,
		RecipientIDs:    append([]string(nil), payload.RecipientIDs...),
		OutboxID:        payload.OutboxID,
		DispatchMode:    payload.DispatchMode,
		AttemptCount:    attemptCount,
	}
}

func CheckEligibility(cfg config.Config, payload FanoutPayload) Eligibility {
	if cfg.ExecutionMode != "primary" {
		return Eligibility{Eligible: false, Reason: "not_primary_mode"}
	}
	if !cfg.GoPrimaryReady {
		return Eligibility{Eligible: false, Reason: "primary_not_ready"}
	}
	if payload.OutboxID == "" {
		return Eligibility{Eligible: false, Reason: "missing_outbox"}
	}
	if payload.DispatchMode != "go_primary" {
		return Eligibility{Eligible: false, Reason: "dispatch_mode_not_primary"}
	}
	segment := "private"
	if payload.ChatType == "group" {
		segment = "group"
	}
	if segment == "private" && !cfg.PrimaryPrivateEnabled {
		return Eligibility{Eligible: false, Reason: "segment_not_enabled", Segment: segment}
	}
	if segment == "group" && !cfg.PrimaryGroupEnabled {
		return Eligibility{Eligible: false, Reason: "segment_not_enabled", Segment: segment}
	}
	if cfg.PrimaryMaxRecipients > 0 && len(dedupeRecipients(payload.RecipientIDs)) > cfg.PrimaryMaxRecipients {
		return Eligibility{Eligible: false, Reason: "recipient_limit_exceeded", Segment: segment}
	}
	return Eligibility{Eligible: true, Reason: "eligible", Segment: segment}
}

func dedupeRecipients(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
