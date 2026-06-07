package summary

import (
	"time"
)

func (s *Summary) RecordPelDrain(count int) {
	if count <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PelDrainedCount += count
}

func (s *Summary) SetRuntimeConfig(cfg RuntimeConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.WorkerLaneCount = cfg.WorkerLaneCount
	s.snapshot.AckBatchSize = cfg.AckBatchSize
	s.snapshot.ReservationMode = cfg.ReservationMode
	s.snapshot.ReservationBatchSize = cfg.ReservationBatchSize
	s.snapshot.WakePublishMode = cfg.WakePublishMode
	s.snapshot.WakeBatchSize = cfg.WakeBatchSize
	s.snapshot.OutboxAggregateMode = cfg.OutboxAggregateMode
}

func (s *Summary) RecordBatchAck(count int) {
	if count <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.BatchAckCount += count
}

func (s *Summary) RecordTrim(streamKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.LastTrimAt = time.Now().UTC().Format(time.RFC3339)
}

func (s *Summary) SetPlatformStreamKey(streamKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PlatformStreamKey = streamKey
}

func (s *Summary) SetPlatformReplayStreamKey(streamKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PlatformReplayStreamKey = streamKey
}

func (s *Summary) RecordConsumed(streamKey string, topic string, messageID string, consumedAt string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.EventsConsumed++
	s.snapshot.LastEventID = messageID
	s.snapshot.LastTopic = topic
	s.snapshot.LastStreamKey = streamKey
	s.snapshot.LastConsumedAt = consumedAt
	s.snapshot.CountsByTopic[topic]++
	s.snapshot.CountsByStream[streamKey]++
	s.snapshot.LastError = ""
}

func (s *Summary) RecordError(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.ReadErrors++
	s.snapshot.LastError = message
}

func (s *Summary) RecordPendingReclaim(streamKey string, claimed int, poison int, ackFailures int, lastCursor string) {
	s.RecordPendingReclaimDuration(streamKey, claimed, poison, ackFailures, lastCursor, 0)
}

func (s *Summary) RecordPendingReclaimDuration(
	streamKey string,
	claimed int,
	poison int,
	ackFailures int,
	lastCursor string,
	duration time.Duration,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PendingReclaimScans++
	s.snapshot.PendingReclaimClaimed += claimed
	s.snapshot.PendingReclaimPoison += poison
	s.snapshot.PendingReclaimAckFailures += ackFailures
	if s.snapshot.PendingReclaimLastCursor == nil {
		s.snapshot.PendingReclaimLastCursor = map[string]string{}
	}
	s.snapshot.PendingReclaimLastCursor[streamKey] = lastCursor
	if s.snapshot.PendingReclaimStreams == nil {
		s.snapshot.PendingReclaimStreams = map[string]PendingReclaimStream{}
	}
	stream := s.snapshot.PendingReclaimStreams[streamKey]
	stream.Scans++
	stream.Claimed += claimed
	stream.Poison += poison
	stream.AckFailures += ackFailures
	stream.LastCursor = lastCursor
	stream.LastDurationMs = duration.Milliseconds()
	s.snapshot.PendingReclaimStreams[streamKey] = stream
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
	s.snapshot.ShadowCompared++
	s.snapshot.ShadowPending = pending
	if matched {
		s.snapshot.ShadowMatched++
		return
	}
	s.snapshot.ShadowMismatches++
	s.snapshot.LastShadowMismatch = reason
}

func (s *Summary) RecordDeadLetter(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.DeadLetters++
	s.snapshot.LastDeadLetterReason = reason
}

func (s *Summary) RecordCanaryExecution(succeeded bool, eventID string, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.CanaryExecutions++
	s.snapshot.LastCanaryEventID = eventID
	if succeeded {
		s.snapshot.CanarySucceeded++
		s.snapshot.LastCanaryFailure = ""
		return
	}
	s.snapshot.CanaryFailed++
	s.snapshot.LastCanaryFailure = reason
}

func (s *Summary) RecordPrimaryExecution(succeeded bool, segment string, eventID string, outboxID string, recipientCount int, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimaryExecutions++
	s.snapshot.LastPrimaryEventID = eventID
	s.snapshot.LastPrimaryOutboxID = outboxID
	switch segment {
	case "group":
		s.snapshot.PrimaryGroupExecutions++
	default:
		s.snapshot.PrimaryPrivateExecutions++
	}
	if succeeded {
		s.snapshot.PrimarySucceeded++
		s.snapshot.PrimaryProjectedRecipients += recipientCount
		if segment == "group" {
			s.snapshot.PrimaryGroupSucceeded++
			s.snapshot.PrimaryGroupProjectedRecipients += recipientCount
		} else {
			s.snapshot.PrimaryPrivateSucceeded++
		}
		s.snapshot.LastPrimaryFailure = ""
		return
	}
	s.snapshot.PrimaryFailed++
	if segment == "group" {
		s.snapshot.PrimaryGroupFailed++
	} else {
		s.snapshot.PrimaryPrivateFailed++
	}
	s.snapshot.LastPrimaryFailure = reason
}

func (s *Summary) RecordPrimaryRetryQueued(eventID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimaryRetryQueued++
	s.snapshot.LastPrimaryEventID = eventID
}

func (s *Summary) RecordPrimaryFailureRecorded(terminal bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if terminal {
		s.snapshot.PrimaryTerminalFailures++
		return
	}
	s.snapshot.PrimaryRetryableFailures++
}

func (s *Summary) RecordPrimaryCompletedChunkSkips(count int) {
	if count <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimaryCompletedChunkSkips += count
}

func (s *Summary) RecordPrimaryMongoFailureCategory(category string) {
	if category == "" || category == "none" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.PrimaryMongoFailureCategories == nil {
		s.snapshot.PrimaryMongoFailureCategories = map[string]int{}
	}
	s.snapshot.PrimaryMongoFailureCategories[category]++
}

func (s *Summary) RecordPrimarySkipped(eventID string, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PrimarySkipped++
	s.snapshot.LastPrimaryEventID = eventID
	s.snapshot.LastPrimarySkipReason = reason
	s.snapshot.PrimarySkipReasons[reason]++
}

type PlatformExecutionRecord struct {
	Topic        string
	Executed     bool
	Shadowed     bool
	Fallback     bool
	Failed       bool
	Replayed     bool
	Channel      string
	Reason       string
	ReplayStream string
	ReplayID     string
	LagMillis    int64
}

func (s *Summary) RecordPlatformExecution(r PlatformExecutionRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.PlatformExecutions++
	s.snapshot.LastPlatformTopic = r.Topic
	s.snapshot.LastPlatformChannel = r.Channel
	topicState := s.snapshot.PlatformTopics[r.Topic]
	if r.Shadowed {
		s.snapshot.PlatformShadowed++
		topicState.Shadowed++
	}
	if r.Fallback {
		s.snapshot.PlatformFallbacks++
		topicState.Fallback++
	}
	if r.Replayed {
		s.snapshot.PlatformReplayed++
		s.snapshot.LastPlatformReplayStream = r.ReplayStream
		s.snapshot.LastPlatformReplayID = r.ReplayID
		topicState.Replayed++
		topicState.LastReplayStream = r.ReplayStream
		topicState.LastReplayID = r.ReplayID
	}
	if r.Executed {
		s.snapshot.PlatformSucceeded++
		topicState.Executed++
		s.snapshot.LastPlatformFailure = ""
	}
	if r.Failed {
		s.snapshot.PlatformFailed++
		topicState.Failed++
	}
	if r.Channel != "" {
		topicState.LastChannel = r.Channel
	}
	if r.Reason != "" {
		s.snapshot.LastPlatformFailure = r.Reason
		topicState.LastReason = r.Reason
	}
	if r.LagMillis > 0 {
		topicState.LastLagMillis = r.LagMillis
	}
	s.snapshot.PlatformTopics[r.Topic] = topicState
}
