package summary

import "sync"

type Snapshot struct {
	StreamKey                       string         `json:"streamKey"`
	PlatformStreamKey               string         `json:"platformStreamKey,omitempty"`
	ConsumerGroup                   string         `json:"consumerGroup"`
	ConsumerName                    string         `json:"consumerName"`
	ExecutionMode                   string         `json:"executionMode"`
	DryRun                          bool           `json:"dryRun"`
	EventsConsumed                  int            `json:"eventsConsumed"`
	ReadErrors                      int            `json:"readErrors"`
	ShadowPlanned                   int            `json:"shadowPlanned"`
	ShadowCompared                  int            `json:"shadowCompared"`
	ShadowMatched                   int            `json:"shadowMatched"`
	ShadowMismatches                int            `json:"shadowMismatches"`
	ShadowPending                   int            `json:"shadowPending"`
	DeadLetters                     int            `json:"deadLetters"`
	CanaryExecutions                int            `json:"canaryExecutions"`
	CanarySucceeded                 int            `json:"canarySucceeded"`
	CanaryFailed                    int            `json:"canaryFailed"`
	PrimaryExecutions               int            `json:"primaryExecutions"`
	PrimarySucceeded                int            `json:"primarySucceeded"`
	PrimaryFailed                   int            `json:"primaryFailed"`
	PrimaryPrivateExecutions        int            `json:"primaryPrivateExecutions"`
	PrimaryPrivateSucceeded         int            `json:"primaryPrivateSucceeded"`
	PrimaryPrivateFailed            int            `json:"primaryPrivateFailed"`
	PrimaryGroupExecutions          int            `json:"primaryGroupExecutions"`
	PrimaryGroupSucceeded           int            `json:"primaryGroupSucceeded"`
	PrimaryGroupFailed              int            `json:"primaryGroupFailed"`
	PrimarySkipped                  int            `json:"primarySkipped"`
	PrimaryRetryQueued              int            `json:"primaryRetryQueued"`
	PrimaryRetryableFailures        int            `json:"primaryRetryableFailures"`
	PrimaryTerminalFailures         int            `json:"primaryTerminalFailures"`
	PrimaryProjectedRecipients      int            `json:"primaryProjectedRecipients"`
	PrimaryGroupProjectedRecipients int            `json:"primaryGroupProjectedRecipients"`
	PlatformExecutions              int            `json:"platformExecutions"`
	PlatformSucceeded               int            `json:"platformSucceeded"`
	PlatformFailed                  int            `json:"platformFailed"`
	PlatformShadowed                int            `json:"platformShadowed"`
	LastEventID                     string         `json:"lastEventId,omitempty"`
	LastTopic                       string         `json:"lastTopic,omitempty"`
	LastStreamKey                   string         `json:"lastStreamKey,omitempty"`
	LastConsumedAt                  string         `json:"lastConsumedAt,omitempty"`
	LastError                       string         `json:"lastError,omitempty"`
	LastShadowMismatch              string         `json:"lastShadowMismatch,omitempty"`
	LastDeadLetterReason            string         `json:"lastDeadLetterReason,omitempty"`
	LastCanaryEventID               string         `json:"lastCanaryEventId,omitempty"`
	LastCanaryFailure               string         `json:"lastCanaryFailure,omitempty"`
	LastPrimaryEventID              string         `json:"lastPrimaryEventId,omitempty"`
	LastPrimaryOutboxID             string         `json:"lastPrimaryOutboxId,omitempty"`
	LastPrimaryFailure              string         `json:"lastPrimaryFailure,omitempty"`
	LastPrimarySkipReason           string         `json:"lastPrimarySkipReason,omitempty"`
	LastPlatformTopic               string         `json:"lastPlatformTopic,omitempty"`
	LastPlatformChannel             string         `json:"lastPlatformChannel,omitempty"`
	LastPlatformFailure             string         `json:"lastPlatformFailure,omitempty"`
	CountsByTopic                   map[string]int `json:"countsByTopic"`
	CountsByStream                  map[string]int `json:"countsByStream"`
	PrimarySkipReasons              map[string]int `json:"primarySkipReasons"`
	Derived                         Derived        `json:"derived"`
}

type Derived struct {
	CanaryMatchRate           float64 `json:"canaryMatchRate"`
	PrimarySuccessRate        float64 `json:"primarySuccessRate"`
	PrivatePrimarySuccessRate float64 `json:"privatePrimarySuccessRate"`
	GroupPrimarySuccessRate   float64 `json:"groupPrimarySuccessRate"`
}

type Summary struct {
	mu       sync.RWMutex
	snapshot Snapshot
}

func New(streamKey string, consumerGroup string, consumerName string, executionMode string, dryRun bool) *Summary {
	return &Summary{
		snapshot: Snapshot{
			StreamKey:          streamKey,
			ConsumerGroup:      consumerGroup,
			ConsumerName:       consumerName,
			ExecutionMode:      executionMode,
			DryRun:             dryRun,
			CountsByTopic:      map[string]int{},
			CountsByStream:     map[string]int{},
			PrimarySkipReasons: map[string]int{},
		},
	}
}

func (s *Summary) SetPlatformStreamKey(streamKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PlatformStreamKey = streamKey
}

func (s *Summary) RecordConsumed(streamKey string, topic string, messageID string, consumedAt string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.EventsConsumed += 1
	s.snapshot.LastEventID = messageID
	s.snapshot.LastTopic = topic
	s.snapshot.LastStreamKey = streamKey
	s.snapshot.LastConsumedAt = consumedAt
	s.snapshot.CountsByTopic[topic] += 1
	s.snapshot.CountsByStream[streamKey] += 1
	s.snapshot.LastError = ""
}

func (s *Summary) RecordError(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.ReadErrors += 1
	s.snapshot.LastError = message
}

func (s *Summary) RecordShadowPlanned(planned int, pending int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.ShadowPlanned += planned
	s.snapshot.ShadowPending = pending
}

func (s *Summary) RecordShadowCompared(matched bool, reason string, pending int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.ShadowCompared += 1
	s.snapshot.ShadowPending = pending
	if matched {
		s.snapshot.ShadowMatched += 1
		return
	}
	s.snapshot.ShadowMismatches += 1
	s.snapshot.LastShadowMismatch = reason
}

func (s *Summary) RecordDeadLetter(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.DeadLetters += 1
	s.snapshot.LastDeadLetterReason = reason
}

func (s *Summary) RecordCanaryExecution(succeeded bool, eventID string, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.CanaryExecutions += 1
	s.snapshot.LastCanaryEventID = eventID
	if succeeded {
		s.snapshot.CanarySucceeded += 1
		s.snapshot.LastCanaryFailure = ""
		return
	}
	s.snapshot.CanaryFailed += 1
	s.snapshot.LastCanaryFailure = reason
}

func (s *Summary) RecordPrimaryExecution(succeeded bool, segment string, eventID string, outboxID string, recipientCount int, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimaryExecutions += 1
	s.snapshot.LastPrimaryEventID = eventID
	s.snapshot.LastPrimaryOutboxID = outboxID
	switch segment {
	case "group":
		s.snapshot.PrimaryGroupExecutions += 1
	default:
		s.snapshot.PrimaryPrivateExecutions += 1
	}
	if succeeded {
		s.snapshot.PrimarySucceeded += 1
		s.snapshot.PrimaryProjectedRecipients += recipientCount
		if segment == "group" {
			s.snapshot.PrimaryGroupSucceeded += 1
			s.snapshot.PrimaryGroupProjectedRecipients += recipientCount
		} else {
			s.snapshot.PrimaryPrivateSucceeded += 1
		}
		s.snapshot.LastPrimaryFailure = ""
		return
	}
	s.snapshot.PrimaryFailed += 1
	if segment == "group" {
		s.snapshot.PrimaryGroupFailed += 1
	} else {
		s.snapshot.PrimaryPrivateFailed += 1
	}
	s.snapshot.LastPrimaryFailure = reason
}

func (s *Summary) RecordPrimaryRetryQueued(eventID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimaryRetryQueued += 1
	s.snapshot.LastPrimaryEventID = eventID
}

func (s *Summary) RecordPrimaryFailureRecorded(terminal bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if terminal {
		s.snapshot.PrimaryTerminalFailures += 1
		return
	}
	s.snapshot.PrimaryRetryableFailures += 1
}

func (s *Summary) RecordPrimarySkipped(eventID string, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimarySkipped += 1
	s.snapshot.LastPrimaryEventID = eventID
	s.snapshot.LastPrimarySkipReason = reason
	s.snapshot.PrimarySkipReasons[reason] += 1
}

func (s *Summary) RecordPlatformExecution(topic string, executed bool, shadowed bool, channel string, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PlatformExecutions += 1
	s.snapshot.LastPlatformTopic = topic
	s.snapshot.LastPlatformChannel = channel
	if shadowed {
		s.snapshot.PlatformShadowed += 1
	}
	if executed {
		s.snapshot.PlatformSucceeded += 1
		s.snapshot.LastPlatformFailure = ""
		return
	}
	if reason == "" {
		reason = "platform_dispatch_failed"
	}
	s.snapshot.PlatformFailed += 1
	s.snapshot.LastPlatformFailure = reason
}

func (s *Summary) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	counts := make(map[string]int, len(s.snapshot.CountsByTopic))
	for key, value := range s.snapshot.CountsByTopic {
		counts[key] = value
	}
	streamCounts := make(map[string]int, len(s.snapshot.CountsByStream))
	for key, value := range s.snapshot.CountsByStream {
		streamCounts[key] = value
	}
	skipReasons := make(map[string]int, len(s.snapshot.PrimarySkipReasons))
	for key, value := range s.snapshot.PrimarySkipReasons {
		skipReasons[key] = value
	}
	result := s.snapshot
	result.CountsByTopic = counts
	result.CountsByStream = streamCounts
	result.PrimarySkipReasons = skipReasons
	result.Derived = Derived{
		CanaryMatchRate:           ratio(s.snapshot.ShadowMatched, s.snapshot.ShadowCompared),
		PrimarySuccessRate:        ratio(s.snapshot.PrimarySucceeded, s.snapshot.PrimaryExecutions),
		PrivatePrimarySuccessRate: ratio(s.snapshot.PrimaryPrivateSucceeded, s.snapshot.PrimaryPrivateExecutions),
		GroupPrimarySuccessRate:   ratio(s.snapshot.PrimaryGroupSucceeded, s.snapshot.PrimaryGroupExecutions),
	}
	return result
}

func ratio(numerator int, denominator int) float64 {
	if denominator <= 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}
