package summary

import "sync"

type Snapshot struct {
	StreamKey                       string         `json:"streamKey"`
	PlatformStreamKey               string         `json:"platformStreamKey,omitempty"`
	ConsumerGroup                   string         `json:"consumerGroup"`
	ConsumerName                    string         `json:"consumerName"`
	ExecutionMode                   string         `json:"executionMode"`
	DryRun                          bool           `json:"dryRun"`
	EventsConsumed                  int            `json:"eventsConsumed"`
	ReadErrors                      int            `json:"readErrors"`
	ShadowPlanned                   int            `json:"shadowPlanned"`
	ShadowCompared                  int            `json:"shadowCompared"`
	ShadowMatched                   int            `json:"shadowMatched"`
	ShadowMismatches                int            `json:"shadowMismatches"`
	ShadowPending                   int            `json:"shadowPending"`
	DeadLetters                     int            `json:"deadLetters"`
	CanaryExecutions                int            `json:"canaryExecutions"`
	CanarySucceeded                 int            `json:"canarySucceeded"`
	CanaryFailed                    int            `json:"canaryFailed"`
	PrimaryExecutions               int            `json:"primaryExecutions"`
	PrimarySucceeded                int            `json:"primarySucceeded"`
	PrimaryFailed                   int            `json:"primaryFailed"`
	PrimaryPrivateExecutions        int            `json:"primaryPrivateExecutions"`
	PrimaryPrivateSucceeded         int            `json:"primaryPrivateSucceeded"`
	PrimaryPrivateFailed            int            `json:"primaryPrivateFailed"`
	PrimaryGroupExecutions          int            `json:"primaryGroupExecutions"`
	PrimaryGroupSucceeded           int            `json:"primaryGroupSucceeded"`
	PrimaryGroupFailed              int            `json:"primaryGroupFailed"`
	PrimarySkipped                  int            `json:"primarySkipped"`
	PrimaryRetryQueued              int            `json:"primaryRetryQueued"`
	PrimaryRetryableFailures        int            `json:"primaryRetryableFailures"`
	PrimaryTerminalFailures         int            `json:"primaryTerminalFailures"`
	PrimaryProjectedRecipients      int            `json:"primaryProjectedRecipients"`
	PrimaryGroupProjectedRecipients int            `json:"primaryGroupProjectedRecipients"`
	PlatformExecutions              int            `json:"platformExecutions"`
	PlatformSucceeded               int            `json:"platformSucceeded"`
	PlatformFailed                  int            `json:"platformFailed"`
	PlatformShadowed                int            `json:"platformShadowed"`
	LastEventID                     string         `json:"lastEventId,omitempty"`
	LastTopic                       string         `json:"lastTopic,omitempty"`
	LastStreamKey                   string         `json:"lastStreamKey,omitempty"`
	LastConsumedAt                  string         `json:"lastConsumedAt,omitempty"`
	LastError                       string         `json:"lastError,omitempty"`
	LastShadowMismatch              string         `json:"lastShadowMismatch,omitempty"`
	LastDeadLetterReason            string         `json:"lastDeadLetterReason,omitempty"`
	LastCanaryEventID               string         `json:"lastCanaryEventId,omitempty"`
	LastCanaryFailure               string         `json:"lastCanaryFailure,omitempty"`
	LastPrimaryEventID              string         `json:"lastPrimaryEventId,omitempty"`
	LastPrimaryOutboxID             string         `json:"lastPrimaryOutboxId,omitempty"`
	LastPrimaryFailure              string         `json:"lastPrimaryFailure,omitempty"`
	LastPrimarySkipReason           string         `json:"lastPrimarySkipReason,omitempty"`
	LastPlatformTopic               string         `json:"lastPlatformTopic,omitempty"`
	LastPlatformChannel             string         `json:"lastPlatformChannel,omitempty"`
	LastPlatformFailure             string         `json:"lastPlatformFailure,omitempty"`
	CountsByTopic                   map[string]int `json:"countsByTopic"`
	CountsByStream                  map[string]int `json:"countsByStream"`
	PrimarySkipReasons              map[string]int `json:"primarySkipReasons"`
	Derived                         Derived        `json:"derived"`
}

type Derived struct {
	CanaryMatchRate           float64 `json:"canaryMatchRate"`
	PrimarySuccessRate        float64 `json:"primarySuccessRate"`
	PrivatePrimarySuccessRate float64 `json:"privatePrimarySuccessRate"`
	GroupPrimarySuccessRate   float64 `json:"groupPrimarySuccessRate"`
}

type Summary struct {
	mu       sync.RWMutex
	snapshot Snapshot
}

func New(streamKey string, consumerGroup string, consumerName string, executionMode string, dryRun bool) *Summary {
	return &Summary{
		snapshot: Snapshot{
			StreamKey:          streamKey,
			ConsumerGroup:      consumerGroup,
			ConsumerName:       consumerName,
			ExecutionMode:      executionMode,
			DryRun:             dryRun,
			CountsByTopic:      map[string]int{},
			CountsByStream:     map[string]int{},
			PrimarySkipReasons: map[string]int{},
		},
	}
}
