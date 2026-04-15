package summary

import "sync"

type Snapshot struct {
	StreamKey      string         `json:"streamKey"`
	ConsumerGroup  string         `json:"consumerGroup"`
	ConsumerName   string         `json:"consumerName"`
	DryRun         bool           `json:"dryRun"`
	EventsConsumed int            `json:"eventsConsumed"`
	ReadErrors     int            `json:"readErrors"`
	LastEventID    string         `json:"lastEventId,omitempty"`
	LastTopic      string         `json:"lastTopic,omitempty"`
	LastConsumedAt string         `json:"lastConsumedAt,omitempty"`
	LastError      string         `json:"lastError,omitempty"`
	CountsByTopic  map[string]int `json:"countsByTopic"`
}

type Summary struct {
	mu       sync.RWMutex
	snapshot Snapshot
}

func New(streamKey string, consumerGroup string, consumerName string, dryRun bool) *Summary {
	return &Summary{
		snapshot: Snapshot{
			StreamKey:     streamKey,
			ConsumerGroup: consumerGroup,
			ConsumerName:  consumerName,
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
