package config

const (
	defaultBindAddr                = "0.0.0.0:4100"
	defaultRedisURL                = "redis://redis:6379/0"
	defaultStreamKey               = "chat:delivery:bus:v1"
	defaultDLQStreamKey            = "chat:delivery:bus:dlq:v1"
	defaultCanaryStreamKey         = "chat:delivery:canary:v1"
	defaultPlatformStreamKey       = "platform:events:v1"
	defaultPlatformDLQStreamKey    = "platform:events:dlq:v1"
	defaultPlatformReplayStreamKey = "platform:events:replay:v1"
	defaultConsumerGroup           = "go-delivery-dryrun"
	defaultExecutionMode           = "shadow"
	defaultBlockMS                 = 2000
	defaultReadCount               = 20
	defaultChunkMax                = 1500
	defaultCanaryMismatchThreshold = 5
	defaultCanaryDLQThreshold      = 3
	defaultPrimaryMaxRecipients    = 2
	defaultPrimaryMaxAttempts      = 3
	defaultProjectionChunkSize     = 1000
	defaultWakePubSubChannel       = "sync:update:wake:v1"
	defaultPresenceOnlineChannel   = "user:online"
	defaultPresenceOfflineChannel  = "user:offline"
	defaultNotificationChannel     = "notification"
	defaultMemberStateCollection   = "chatmemberstates"
	defaultUpdateCounterCollection = "updatecounters"
	defaultUpdateLogCollection     = "updatelogs"
	defaultOutboxCollection        = "chatdeliveryoutboxes"
)
