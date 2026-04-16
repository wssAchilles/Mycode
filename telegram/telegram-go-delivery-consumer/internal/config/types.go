package config

import "time"

type Config struct {
	BindAddr                     string
	RedisURL                     string
	StreamKey                    string
	DLQStreamKey                 string
	CanaryStreamKey              string
	PlatformStreamKey            string
	PlatformDLQStreamKey         string
	ConsumerGroup                string
	ConsumerName                 string
	ExecutionMode                string
	GoPrimaryReady               bool
	MongoURL                     string
	MongoDatabase                string
	MemberStateCollection        string
	UpdateCounterCollection      string
	UpdateLogCollection          string
	OutboxCollection             string
	WakePubSubChannel            string
	SyncWakeExecutionMode        string
	PresenceExecutionMode        string
	NotificationExecutionMode    string
	PresenceOnlineChannel        string
	PresenceOfflineChannel       string
	NotificationChannel          string
	MaxRecipientsPerChunk        int
	CanaryMismatchThreshold      int
	CanaryDLQThreshold           int
	ProjectionChunkSize          int
	PrimaryMaxRecipients         int
	PrimaryGroupMaxRecipients    int
	PrimaryMaxAttempts           int
	PrimaryPrivateEnabled        bool
	PrimaryGroupEnabled          bool
	PrimaryPrivateRolloutPercent int
	PrimaryGroupRolloutPercent   int
	BlockDuration                time.Duration
	ReadCount                    int64
	DryRun                       bool
}
