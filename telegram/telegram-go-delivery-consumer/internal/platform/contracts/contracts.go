package contracts

type DispatchResult struct {
	Topic        string `json:"topic"`
	Executed     bool   `json:"executed"`
	Shadowed     bool   `json:"shadowed"`
	Fallback     bool   `json:"fallback"`
	Failed       bool   `json:"failed"`
	Replayed     bool   `json:"replayed"`
	Channel      string `json:"channel,omitempty"`
	Reason       string `json:"reason,omitempty"`
	ReplayStream string `json:"replayStream,omitempty"`
	ReplayID     string `json:"replayId,omitempty"`
	LagMillis    int64  `json:"lagMillis,omitempty"`
}

type ReplayRecord struct {
	Stream string
	ID     string
}
