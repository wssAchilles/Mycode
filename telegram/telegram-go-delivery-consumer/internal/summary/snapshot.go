package summary

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
	reclaimCursors := make(map[string]string, len(s.snapshot.PendingReclaimLastCursor))
	for key, value := range s.snapshot.PendingReclaimLastCursor {
		reclaimCursors[key] = value
	}
	reclaimStreams := make(map[string]PendingReclaimStream, len(s.snapshot.PendingReclaimStreams))
	for key, value := range s.snapshot.PendingReclaimStreams {
		reclaimStreams[key] = value
	}
	mongoFailureCategories := make(map[string]int, len(s.snapshot.PrimaryMongoFailureCategories))
	for key, value := range s.snapshot.PrimaryMongoFailureCategories {
		mongoFailureCategories[key] = value
	}
	skipReasons := make(map[string]int, len(s.snapshot.PrimarySkipReasons))
	for key, value := range s.snapshot.PrimarySkipReasons {
		skipReasons[key] = value
	}
	platformTopics := make(map[string]PlatformTopicSnapshot, len(s.snapshot.PlatformTopics))
	for key, value := range s.snapshot.PlatformTopics {
		platformTopics[key] = value
	}
	result := s.snapshot
	result.CountsByTopic = counts
	result.CountsByStream = streamCounts
	result.PendingReclaimLastCursor = reclaimCursors
	result.PendingReclaimStreams = reclaimStreams
	result.PrimaryMongoFailureCategories = mongoFailureCategories
	result.PrimarySkipReasons = skipReasons
	result.PlatformTopics = platformTopics
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
