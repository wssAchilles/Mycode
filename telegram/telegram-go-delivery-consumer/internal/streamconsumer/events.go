package streamconsumer

import (
	"time"
)

// ConsumerEventType enumerates the structured events emitted during the consumer lifecycle.
type ConsumerEventType int

const (
	EventStarted          ConsumerEventType = iota // consumer process started
	EventGroupEnsured                              // consumer group created/verified
	EventPELDrainStarted                           // PEL drain phase started
	EventPELDrainCompleted                         // PEL drain phase completed
	EventRunning                                   // entered normal consumption loop
	EventMessageConsumed                           // message processed successfully
	EventMessageDeadLettered                       // message sent to DLQ
	EventRecoveryAttempted                         // recovery recipe applied
	EventTrimCompleted                             // stream trim completed
	EventDrainStarted                              // graceful shutdown initiated
	EventDrainCompleted                            // graceful shutdown completed
	EventError                                     // non-fatal error occurred
	EventFatal                                     // fatal error — consumer stopping
)

func (t ConsumerEventType) String() string {
	switch t {
	case EventStarted:
		return "started"
	case EventGroupEnsured:
		return "group_ensured"
	case EventPELDrainStarted:
		return "pel_drain_started"
	case EventPELDrainCompleted:
		return "pel_drain_completed"
	case EventRunning:
		return "running"
	case EventMessageConsumed:
		return "message_consumed"
	case EventMessageDeadLettered:
		return "message_dead_lettered"
	case EventRecoveryAttempted:
		return "recovery_attempted"
	case EventTrimCompleted:
		return "trim_completed"
	case EventDrainStarted:
		return "drain_started"
	case EventDrainCompleted:
		return "drain_completed"
	case EventError:
		return "error"
	case EventFatal:
		return "fatal"
	default:
		return "unknown"
	}
}

// ConsumerEvent is a structured event for the consumer lifecycle.
type ConsumerEvent struct {
	Type      ConsumerEventType
	StreamKey string
	MessageID string
	Topic     string
	Scenario  FailureScenario // only relevant for recovery events
	Error     error
	Duration  time.Duration
	Timestamp time.Time
}

// EventSink receives structured events. Implementations may forward to OTel, log, or metrics.
type EventSink interface {
	Emit(event ConsumerEvent)
}

// LogEventSink emits events as structured log lines.
type LogEventSink struct {
	logger interface{ Printf(string, ...any) }
}

func NewLogEventSink(logger interface{ Printf(string, ...any) }) *LogEventSink {
	return &LogEventSink{logger: logger}
}

func (s *LogEventSink) Emit(e ConsumerEvent) {
	if e.Error != nil {
		s.logger.Printf("[event] %s stream=%s msg=%s err=%v dur=%s",
			e.Type, e.StreamKey, e.MessageID, e.Error, e.Duration)
	} else {
		s.logger.Printf("[event] %s stream=%s msg=%s dur=%s",
			e.Type, e.StreamKey, e.MessageID, e.Duration)
	}
}
