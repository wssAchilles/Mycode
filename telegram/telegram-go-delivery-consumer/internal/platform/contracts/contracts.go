package contracts

const (
	ReplayStatusShadowed  = "shadowed"
	ReplayStatusFallback  = "fallback"
	ReplayStatusFailed    = "failed"
	ReplayStatusReplayed  = "replayed"
	ReplayStatusCompleted = "completed"

	ReplayKindAutomaticFallback = "automatic_fallback"
	ReplayKindManualDrain       = "manual_drain"
)

type DispatchResult struct {
	Topic        string `json:"topic"`
	Status       string `json:"status,omitempty"`
	Executed     bool   `json:"executed"`
	Shadowed     bool   `json:"shadowed"`
	Fallback     bool   `json:"fallback"`
	Failed       bool   `json:"failed"`
	Replayed     bool   `json:"replayed"`
	Channel      string `json:"channel,omitempty"`
	Reason       string `json:"reason,omitempty"`
	ReplayStream string `json:"replayStream,omitempty"`
	ReplayID     string `json:"replayId,omitempty"`
	ReplayKind   string `json:"replayKind,omitempty"`
	PartitionKey string `json:"partitionKey,omitempty"`
	Attempt      int    `json:"attempt,omitempty"`
	LagMillis    int64  `json:"lagMillis,omitempty"`
}

type ReplayRecord struct {
	Stream       string
	ID           string
	Topic        string
	EventID      string
	Status       string
	ReplayKind   string
	Attempt      int
	PartitionKey string
}

func ReplayStatusForResult(result DispatchResult) string {
	if result.Status != "" {
		return result.Status
	}
	switch {
	case result.Failed:
		return ReplayStatusFailed
	case result.Fallback:
		return ReplayStatusFallback
	case result.Shadowed:
		return ReplayStatusShadowed
	case result.Replayed:
		return ReplayStatusReplayed
	case result.Executed:
		return ReplayStatusCompleted
	default:
		return ""
	}
}
