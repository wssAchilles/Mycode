package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBindAddr      = "0.0.0.0:4100"
	defaultRedisURL      = "redis://redis:6379/0"
	defaultStreamKey     = "chat:delivery:bus:v1"
	defaultDLQStreamKey  = "chat:delivery:bus:dlq:v1"
	defaultConsumerGroup = "go-delivery-dryrun"
	defaultExecutionMode = "shadow"
	defaultBlockMS       = 2000
	defaultReadCount     = 20
	defaultChunkMax      = 1500
)

type Config struct {
	BindAddr              string
	RedisURL              string
	StreamKey             string
	DLQStreamKey          string
	ConsumerGroup         string
	ConsumerName          string
	ExecutionMode         string
	MaxRecipientsPerChunk int
	BlockDuration         time.Duration
	ReadCount             int64
	DryRun                bool
}

func Load() Config {
	redisURL := firstNonEmpty(
		os.Getenv("DELIVERY_CONSUMER_REDIS_URL"),
		os.Getenv("REDIS_URL"),
		defaultRedisURL,
	)
	consumerName := os.Getenv("DELIVERY_CONSUMER_CONSUMER_NAME")
	if consumerName == "" {
		host, _ := os.Hostname()
		consumerName = host + "-dryrun"
	}
	executionMode := readExecutionMode()

	return Config{
		BindAddr:      firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_BIND_ADDR"), defaultBindAddr),
		RedisURL:      redisURL,
		StreamKey:     firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_STREAM_KEY"), defaultStreamKey),
		DLQStreamKey:  firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_DLQ_STREAM_KEY"), defaultDLQStreamKey),
		ConsumerGroup: firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_GROUP"), defaultConsumerGroup),
		ConsumerName:  consumerName,
		ExecutionMode: executionMode,
		MaxRecipientsPerChunk: readInt(
			"DELIVERY_CONSUMER_MAX_RECIPIENTS_PER_CHUNK",
			readInt("FANOUT_JOB_RECIPIENTS_MAX", defaultChunkMax, 100, 10000),
			100,
			10000,
		),
		BlockDuration: time.Duration(readInt("DELIVERY_CONSUMER_BLOCK_MS", defaultBlockMS, 100, 30000)) * time.Millisecond,
		ReadCount:     int64(readInt("DELIVERY_CONSUMER_READ_COUNT", defaultReadCount, 1, 500)),
		DryRun:        executionMode == "dry-run",
	}
}

func RedisAddress(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return "redis:6379"
	}
	return parsed.Host
}

func RedisPassword(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User == nil {
		return ""
	}
	password, _ := parsed.User.Password()
	return password
}

func RedisDB(rawURL string) int {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return 0
	}
	path := strings.TrimPrefix(parsed.Path, "/")
	if path == "" {
		return 0
	}
	value, err := strconv.Atoi(path)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func readInt(name string, fallback int, min int, max int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func readBool(name string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func readExecutionMode() string {
	value := strings.TrimSpace(strings.ToLower(os.Getenv("DELIVERY_CONSUMER_EXECUTION_MODE")))
	switch value {
	case "dry-run", "shadow", "primary":
		return value
	}
	if readBool("DELIVERY_CONSUMER_DRY_RUN", true) {
		return "dry-run"
	}
	return defaultExecutionMode
}
