package streamconsumer

import (
	"sync"
	"time"

	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
)

// FailureScenario enumerates distinct failure modes the consumer can encounter.
type FailureScenario int

const (
	ScenarioRedisTimeout   FailureScenario = iota // transient Redis network error
	ScenarioPoisonMessage                         // unprocessable message (decode/validation failure)
	ScenarioDLQWriteFailed                        // DLQ write failed — message at risk of loss
	ScenarioAckFailed                             // XACK failed — message will be re-delivered
	ScenarioStreamReadFailed                      // XREADGROUP failed
)

func (s FailureScenario) String() string {
	switch s {
	case ScenarioRedisTimeout:
		return "redis_timeout"
	case ScenarioPoisonMessage:
		return "poison_message"
	case ScenarioDLQWriteFailed:
		return "dlq_write_failed"
	case ScenarioAckFailed:
		return "ack_failed"
	case ScenarioStreamReadFailed:
		return "stream_read_failed"
	default:
		return "unknown"
	}
}

// EscalationPolicy defines what happens when retries are exhausted.
type EscalationPolicy int

const (
	EscalationLogAndContinue EscalationPolicy = iota // log and skip the message
	EscalationAlertHuman                             // log at ERROR level, metric increment
	EscalationAbort                                  // terminate the consumer
)

func (p EscalationPolicy) String() string {
	switch p {
	case EscalationLogAndContinue:
		return "log_and_continue"
	case EscalationAlertHuman:
		return "alert_human"
	case EscalationAbort:
		return "abort"
	default:
		return "unknown"
	}
}

// RecoveryRecipe defines how the consumer should respond to a specific failure scenario.
type RecoveryRecipe struct {
	Scenario    FailureScenario
	MaxAttempts int
	Escalation  EscalationPolicy
	BackoffBase time.Duration
}

// defaultRecipes returns the built-in recovery recipes.
func defaultRecipes() map[FailureScenario]RecoveryRecipe {
	return map[FailureScenario]RecoveryRecipe{
		ScenarioRedisTimeout: {
			Scenario:    ScenarioRedisTimeout,
			MaxAttempts: 5,
			Escalation:  EscalationAlertHuman,
			BackoffBase: 200 * time.Millisecond,
		},
		ScenarioPoisonMessage: {
			Scenario:    ScenarioPoisonMessage,
			MaxAttempts: 1, // no retry — send to DLQ immediately
			Escalation:  EscalationLogAndContinue,
			BackoffBase: 0,
		},
		ScenarioDLQWriteFailed: {
			Scenario:    ScenarioDLQWriteFailed,
			MaxAttempts: 3,
			Escalation:  EscalationAlertHuman,
			BackoffBase: 500 * time.Millisecond,
		},
		ScenarioAckFailed: {
			Scenario:    ScenarioAckFailed,
			MaxAttempts: 3,
			Escalation:  EscalationLogAndContinue,
			BackoffBase: 100 * time.Millisecond,
		},
		ScenarioStreamReadFailed: {
			Scenario:    ScenarioStreamReadFailed,
			MaxAttempts: 10,
			Escalation:  EscalationAbort,
			BackoffBase: 1 * time.Second,
		},
	}
}

// ClassifyError maps an error to a FailureScenario.
func ClassifyError(err error) FailureScenario {
	if err == nil {
		return ScenarioPoisonMessage // unreachable, but safe default
	}
	if reclaimstate.IsAckError(err) {
		return ScenarioAckFailed
	}
	// Poison messages are detected by the caller (decode/validation errors).
	// This function is called for unexpected errors from the handler pipeline.
	return ScenarioRedisTimeout
}

// RecoveryLedgerEntry records a single recovery attempt.
type RecoveryLedgerEntry struct {
	Scenario  FailureScenario
	MessageID string
	Attempt   int
	Action    EscalationPolicy
	Timestamp time.Time
	Error     string
}

// RecoveryLedger tracks recovery attempts for observability.
type RecoveryLedger struct {
	mu      sync.Mutex
	entries []RecoveryLedgerEntry
	maxSize int
}

func NewRecoveryLedger(maxSize int) *RecoveryLedger {
	return &RecoveryLedger{
		entries: make([]RecoveryLedgerEntry, 0, maxSize),
		maxSize: maxSize,
	}
}

func (l *RecoveryLedger) Record(entry RecoveryLedgerEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) >= l.maxSize {
		// Drop oldest entry to prevent unbounded growth.
		copy(l.entries, l.entries[1:])
		l.entries = l.entries[:len(l.entries)-1]
	}
	l.entries = append(l.entries, entry)
}

func (l *RecoveryLedger) Entries() []RecoveryLedgerEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]RecoveryLedgerEntry, len(l.entries))
	copy(out, l.entries)
	return out
}

func (l *RecoveryLedger) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}
