package primary

import (
	"testing"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

func TestCheckEligibilityHonorsHardGateAndSegment(t *testing.T) {
	payload := FanoutPayload{
		ChatType:     "private",
		OutboxID:     "507f1f77bcf86cd799439011",
		DispatchMode: "go_primary",
		RecipientIDs: []string{"u1", "u2"},
	}

	offGate := CheckEligibility(config.Config{
		ExecutionMode:         "primary",
		GoPrimaryReady:        false,
		PrimaryPrivateEnabled: true,
		PrimaryMaxRecipients:  2,
	}, payload)
	if offGate.Eligible || offGate.Reason != "primary_not_ready" {
		t.Fatalf("expected hard gate rejection, got %#v", offGate)
	}

	eligible := CheckEligibility(config.Config{
		ExecutionMode:         "primary",
		GoPrimaryReady:        true,
		PrimaryPrivateEnabled: true,
		PrimaryMaxRecipients:  2,
	}, payload)
	if !eligible.Eligible || eligible.Segment != "private" {
		t.Fatalf("expected private payload to be eligible, got %#v", eligible)
	}

	queuedPayload := payload
	queuedPayload.DispatchMode = "queued"
	queued := CheckEligibility(config.Config{
		ExecutionMode:         "primary",
		GoPrimaryReady:        true,
		PrimaryPrivateEnabled: true,
		PrimaryMaxRecipients:  2,
	}, queuedPayload)
	if queued.Eligible || queued.Reason != "dispatch_mode_not_primary" {
		t.Fatalf("expected queued events to be rejected, got %#v", queued)
	}

	groupPayload := FanoutPayload{
		ChatType:     "group",
		OutboxID:     "507f1f77bcf86cd799439011",
		DispatchMode: "go_group_canary",
		RecipientIDs: []string{"u1", "u2", "u3"},
	}
	groupEligible := CheckEligibility(config.Config{
		ExecutionMode:             "primary",
		GoPrimaryReady:            true,
		PrimaryGroupEnabled:       true,
		PrimaryGroupMaxRecipients: 4,
	}, groupPayload)
	if !groupEligible.Eligible || groupEligible.Segment != "group" {
		t.Fatalf("expected group canary payload to be eligible, got %#v", groupEligible)
	}

	groupLimited := CheckEligibility(config.Config{
		ExecutionMode:             "primary",
		GoPrimaryReady:            true,
		PrimaryGroupEnabled:       true,
		PrimaryGroupMaxRecipients: 2,
	}, groupPayload)
	if groupLimited.Eligible || groupLimited.Reason != "recipient_limit_exceeded" {
		t.Fatalf("expected group max recipients to be enforced, got %#v", groupLimited)
	}
}

func TestFromEnvelopeDefaultsPrimaryAttemptCount(t *testing.T) {
	envelope := contracts.DeliveryEventEnvelope{EventID: "evt-1"}
	payload := contracts.FanoutRequestedPayload{
		MessageID:    "msg-1",
		ChatID:       "chat-1",
		ChatType:     "private",
		RecipientIDs: []string{"u1"},
		OutboxID:     "507f1f77bcf86cd799439011",
		DispatchMode: "go_primary",
	}

	result := FromEnvelope("1-0", envelope, payload)

	if result.AttemptCount != 1 {
		t.Fatalf("expected default attempt count 1, got %d", result.AttemptCount)
	}
	if result.SourceMessageID != "1-0" || result.EventID != "evt-1" {
		t.Fatalf("unexpected envelope mapping: %#v", result)
	}
}
