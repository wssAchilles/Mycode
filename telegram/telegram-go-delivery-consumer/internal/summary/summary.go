package summary

import "sync"

type Snapshot struct {
	StreamKey            string         `json:"streamKey"`
	ConsumerGroup        string         `json:"consumerGroup"`
	ConsumerName         string         `json:"consumerName"`
	ExecutionMode        string         `json:"executionMode"`
	DryRun               bool           `json:"dryRun"`
	EventsConsumed       int            `json:"eventsConsumed"`
	ReadErrors           int            `json:"readErrors"`
	ShadowPlanned        int            `json:"shadowPlanned"`
	ShadowCompared       int            `json:"shadowCompared"`
	ShadowMatched        int            `json:"shadowMatched"`
	ShadowMismatches     int            `json:"shadowMismatches"`
	ShadowPending        int            `json:"shadowPending"`
	DeadLetters          int            `json:"deadLetters"`
	LastEventID          string         `json:"lastEventId,omitempty"`
	LastTopic            string         `json:"lastTopic,omitempty"`
	LastConsumedAt       string         `json:"lastConsumedAt,omitempty"`
	LastError            string         `json:"lastError,omitempty"`
	LastShadowMismatch   string         `json:"lastShadowMismatch,omitempty"`
	LastDeadLetterReason string         `json:"lastDeadLetterReason,omitempty"`
	CountsByTopic        map[string]int `json:"countsByTopic"`
}

type Summary struct {
	mu       sync.RWMutex
	snapshot Snapshot
}

func New(streamKey string, consumerGroup string, consumerName string, executionMode string, dryRun bool) *Summary {
	return &Summary{
		snapshot: Snapshot{
			StreamKey:     streamKey,
			ConsumerGroup: consumerGroup,
			ConsumerName:  consumerName,
			ExecutionMode: executionMode,
			DryRun:        dryRun,
			CountsByTopic: map[string]int{},
		},
	}
}

func (s *Summary) RecordConsumed(topic string, messageID string, consumedAt string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.EventsConsumed += 1
	s.snapshot.LastEventID = messageID
	s.snapshot.LastTopic = topic
	s.snapshot.LastConsumedAt = consumedAt
	s.snapshot.CountsByTopic[topic] += 1
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

func (s *Summary) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	counts := make(map[string]int, len(s.snapshot.CountsByTopic))
	for key, value := range s.snapshot.CountsByTopic {
		counts[key] = value
	}
	result := s.snapshot
	result.CountsByTopic = counts
	return result
}
