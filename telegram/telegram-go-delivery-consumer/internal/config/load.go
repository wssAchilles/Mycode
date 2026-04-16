package config

import (
	"os"
	"time"
)

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
	mongoURL := firstNonEmpty(
		os.Getenv("DELIVERY_CONSUMER_MONGO_URL"),
		os.Getenv("MONGODB_URI"),
		os.Getenv("MONGO_URL"),
	)
	mongoDatabase := firstNonEmpty(
		os.Getenv("DELIVERY_CONSUMER_MONGO_DATABASE"),
		os.Getenv("MONGODB_DATABASE"),
		os.Getenv("MONGO_DATABASE"),
		MongoDatabaseFromURL(mongoURL),
	)

	return Config{
		BindAddr:                firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_BIND_ADDR"), defaultBindAddr),
		RedisURL:                redisURL,
		StreamKey:               firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_STREAM_KEY"), defaultStreamKey),
		DLQStreamKey:            firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_DLQ_STREAM_KEY"), defaultDLQStreamKey),
		CanaryStreamKey:         firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_CANARY_STREAM_KEY"), defaultCanaryStreamKey),
		PlatformStreamKey:       firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_PLATFORM_STREAM_KEY"), defaultPlatformStreamKey),
		PlatformDLQStreamKey:    firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_PLATFORM_DLQ_STREAM_KEY"), defaultPlatformDLQStreamKey),
		ConsumerGroup:           firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_GROUP"), defaultConsumerGroup),
		ConsumerName:            consumerName,
		ExecutionMode:           executionMode,
		GoPrimaryReady:          readBool("DELIVERY_GO_PRIMARY_READY", false),
		MongoURL:                mongoURL,
		MongoDatabase:           mongoDatabase,
		MemberStateCollection:   firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_MEMBER_STATE_COLLECTION"), defaultMemberStateCollection),
		UpdateCounterCollection: firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_UPDATE_COUNTER_COLLECTION"), defaultUpdateCounterCollection),
		UpdateLogCollection:     firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_UPDATE_LOG_COLLECTION"), defaultUpdateLogCollection),
		OutboxCollection:        firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_OUTBOX_COLLECTION"), defaultOutboxCollection),
		WakePubSubChannel:       firstNonEmpty(os.Getenv("DELIVERY_CONSUMER_WAKE_PUBSUB_CHANNEL"), defaultWakePubSubChannel),
		SyncWakeExecutionMode:   readPlatformExecutionMode("DELIVERY_CONSUMER_SYNC_WAKE_EXECUTION_MODE", "publish"),
		PresenceExecutionMode:   readPlatformExecutionMode("DELIVERY_CONSUMER_PRESENCE_EXECUTION_MODE", "shadow"),
		NotificationExecutionMode: readPlatformExecutionMode(
			"DELIVERY_CONSUMER_NOTIFICATION_EXECUTION_MODE",
			"shadow",
		),
		PresenceOnlineChannel: firstNonEmpty(
			os.Getenv("DELIVERY_CONSUMER_PRESENCE_ONLINE_CHANNEL"),
			defaultPresenceOnlineChannel,
		),
		PresenceOfflineChannel: firstNonEmpty(
			os.Getenv("DELIVERY_CONSUMER_PRESENCE_OFFLINE_CHANNEL"),
			defaultPresenceOfflineChannel,
		),
		NotificationChannel: firstNonEmpty(
			os.Getenv("DELIVERY_CONSUMER_NOTIFICATION_CHANNEL"),
			defaultNotificationChannel,
		),
		MaxRecipientsPerChunk: readInt(
			"DELIVERY_CONSUMER_MAX_RECIPIENTS_PER_CHUNK",
			readInt("FANOUT_JOB_RECIPIENTS_MAX", defaultChunkMax, 100, 10000),
			100,
			10000,
		),
		CanaryMismatchThreshold: readInt(
			"DELIVERY_CONSUMER_CANARY_MISMATCH_THRESHOLD",
			defaultCanaryMismatchThreshold,
			1,
			1000,
		),
		CanaryDLQThreshold: readInt(
			"DELIVERY_CONSUMER_CANARY_DLQ_THRESHOLD",
			defaultCanaryDLQThreshold,
			1,
			1000,
		),
		ProjectionChunkSize: readInt(
			"DELIVERY_CONSUMER_PROJECTION_CHUNK_SIZE",
			readInt("FANOUT_MEMBERSTATE_CHUNK_SIZE", defaultProjectionChunkSize, 100, 5000),
			100,
			5000,
		),
		PrimaryMaxRecipients: readInt(
			"DELIVERY_CONSUMER_PRIMARY_MAX_RECIPIENTS",
			readInt("DELIVERY_GO_PRIMARY_MAX_RECIPIENTS", defaultPrimaryMaxRecipients, 1, 10000),
			1,
			10000,
		),
		PrimaryGroupMaxRecipients: readInt(
			"DELIVERY_CONSUMER_PRIMARY_GROUP_MAX_RECIPIENTS",
			readInt(
				"DELIVERY_GO_PRIMARY_GROUP_MAX_RECIPIENTS",
				readInt("DELIVERY_GO_PRIMARY_MAX_RECIPIENTS", defaultPrimaryMaxRecipients, 1, 10000),
				1,
				10000,
			),
			1,
			10000,
		),
		PrimaryMaxAttempts: readInt(
			"DELIVERY_CONSUMER_PRIMARY_MAX_ATTEMPTS",
			defaultPrimaryMaxAttempts,
			1,
			10,
		),
		PrimaryPrivateEnabled: readBool("DELIVERY_CONSUMER_PRIMARY_PRIVATE_ENABLED", readBool("DELIVERY_GO_PRIMARY_PRIVATE_ENABLED", true)),
		PrimaryGroupEnabled:   readBool("DELIVERY_CONSUMER_PRIMARY_GROUP_ENABLED", readBool("DELIVERY_GO_PRIMARY_GROUP_ENABLED", false)),
		PrimaryPrivateRolloutPercent: readInt(
			"DELIVERY_CONSUMER_PRIMARY_PRIVATE_ROLLOUT_PERCENT",
			readInt("DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT", 100, 0, 100),
			0,
			100,
		),
		PrimaryGroupRolloutPercent: readInt(
			"DELIVERY_CONSUMER_PRIMARY_GROUP_ROLLOUT_PERCENT",
			readInt("DELIVERY_GO_PRIMARY_GROUP_ROLLOUT_PERCENT", 100, 0, 100),
			0,
			100,
		),
		BlockDuration: time.Duration(readInt("DELIVERY_CONSUMER_BLOCK_MS", defaultBlockMS, 100, 30000)) * time.Millisecond,
		ReadCount:     int64(readInt("DELIVERY_CONSUMER_READ_COUNT", defaultReadCount, 1, 500)),
		DryRun:        executionMode == "dry-run",
	}
}
