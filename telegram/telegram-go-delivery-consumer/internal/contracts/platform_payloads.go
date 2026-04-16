package contracts

type SyncWakeRequestedPayload struct {
	UserID      string `json:"userId"`
	UpdateID    int64  `json:"updateId"`
	WakeChannel string `json:"wakeChannel"`
	Source      string `json:"source"`
}

type PresenceFanoutRequestedPayload struct {
	UserID   string  `json:"userId"`
	Status   string  `json:"status"`
	LastSeen *string `json:"lastSeen,omitempty"`
	Target   string  `json:"target"`
	TargetID string  `json:"targetId,omitempty"`
	Source   string  `json:"source"`
}

type NotificationDispatchRequestedPayload struct {
	UserID string                 `json:"userId"`
	Type   string                 `json:"type"`
	Title  string                 `json:"title"`
	Body   string                 `json:"body"`
	Data   map[string]interface{} `json:"data,omitempty"`
	Source string                 `json:"source"`
}
