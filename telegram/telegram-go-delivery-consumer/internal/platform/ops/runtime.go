package ops

import "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/config"

type TopicRuntime struct {
	Owner         string   `json:"owner"`
	Mode          string   `json:"mode"`
	Channels      []string `json:"channels,omitempty"`
	ReplayEnabled bool     `json:"replayEnabled"`
}

func TopicModes(cfg config.Config) map[string]string {
	return map[string]string{
		"sync_wake_requested":             cfg.SyncWakeExecutionMode,
		"presence_fanout_requested":       cfg.PresenceExecutionMode,
		"notification_dispatch_requested": cfg.NotificationExecutionMode,
	}
}

func TopicCatalog(cfg config.Config) map[string]TopicRuntime {
	return map[string]TopicRuntime{
		"sync_wake_requested": {
			Owner:         "go",
			Mode:          cfg.SyncWakeExecutionMode,
			Channels:      nonEmpty(cfg.WakePubSubChannel),
			ReplayEnabled: cfg.PlatformReplayStreamKey != "",
		},
		"presence_fanout_requested": {
			Owner:         "go",
			Mode:          cfg.PresenceExecutionMode,
			Channels:      nonEmpty(cfg.PresenceOnlineChannel, cfg.PresenceOfflineChannel),
			ReplayEnabled: cfg.PlatformReplayStreamKey != "",
		},
		"notification_dispatch_requested": {
			Owner:         "go",
			Mode:          cfg.NotificationExecutionMode,
			Channels:      nonEmpty(cfg.NotificationChannel),
			ReplayEnabled: cfg.PlatformReplayStreamKey != "",
		},
	}
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}
