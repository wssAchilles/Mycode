package config

import "fmt"

func (c Config) Validate() error {
	if c.ExecutionMode == "primary" && c.MongoURL == "" {
		return fmt.Errorf("primary mode requires DELIVERY_CONSUMER_MONGO_URL")
	}
	if c.PrimaryPrivateRolloutPercent < 0 || c.PrimaryPrivateRolloutPercent > 100 {
		return fmt.Errorf("primary private rollout percent must be 0-100, got %d", c.PrimaryPrivateRolloutPercent)
	}
	if c.PrimaryGroupRolloutPercent < 0 || c.PrimaryGroupRolloutPercent > 100 {
		return fmt.Errorf("primary group rollout percent must be 0-100, got %d", c.PrimaryGroupRolloutPercent)
	}
	if c.RedisURL == "" {
		return fmt.Errorf("redis URL is required")
	}
	if c.PendingClaimCount <= 0 {
		return fmt.Errorf("pending claim count must be positive")
	}
	if c.PendingReclaimMaxBatches <= 0 {
		return fmt.Errorf("pending reclaim max batches must be positive")
	}
	if c.ReservationConcurrency <= 0 || c.ReservationConcurrency > 64 {
		return fmt.Errorf("reservation concurrency must be 1-64")
	}
	if c.MongoInQueryChunkSize <= 0 {
		return fmt.Errorf("mongo in-query chunk size must be positive")
	}
	if c.PlatformReplayScanCount <= 0 {
		return fmt.Errorf("platform replay scan count must be positive")
	}
	return nil
}
