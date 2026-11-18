package config

import "fmt"

// Validate 校验投递消费者启动配置，拦截未实现模式与缺失必填项。
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
	if _, err := BuildRedisOptions(c.RedisURL); err != nil {
		return fmt.Errorf("invalid redis URL: %w", err)
	}
	if c.PendingClaimCount <= 0 {
		return fmt.Errorf("pending claim count must be positive")
	}
	if c.PendingReclaimMaxBatches <= 0 {
		return fmt.Errorf("pending reclaim max batches must be positive")
	}
	if c.ReclaimCursorMode != "resume" && c.ReclaimCursorMode != "restart" {
		return fmt.Errorf("reclaim cursor mode must be resume or restart")
	}
	if c.ReservationConcurrency <= 0 || c.ReservationConcurrency > 64 {
		return fmt.Errorf("reservation concurrency must be 1-64")
	}
	if c.ReservationMode == ReservationModeBlock {
		return fmt.Errorf("reservation mode %q is not implemented; use %s", ReservationModeBlock, ReservationModeLegacyPerUser)
	}
	if c.ReservationMode != ReservationModeLegacyPerUser {
		return fmt.Errorf("reservation mode must be %s", ReservationModeLegacyPerUser)
	}
	if c.MongoInQueryChunkSize <= 0 {
		return fmt.Errorf("mongo in-query chunk size must be positive")
	}
	if c.ConsumerWorkerCount <= 0 {
		return fmt.Errorf("consumer worker count must be positive")
	}
	if c.AckBatchSize <= 0 {
		return fmt.Errorf("ack batch size must be positive")
	}
	return nil
}
