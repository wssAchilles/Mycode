package summary

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
