package contracts

type FanoutRequestedPayload struct {
	MessageID           string   `json:"messageId"`
	ChatID              string   `json:"chatId"`
	ChatType            string   `json:"chatType"`
	Seq                 int64    `json:"seq"`
	SenderID            string   `json:"senderId"`
	RecipientIDs        []string `json:"recipientIds"`
	RecipientCount      int      `json:"recipientCount"`
	Topology            string   `json:"topology"`
	OutboxID            string   `json:"outboxId"`
	DispatchMode        string   `json:"dispatchMode"`
	JobIDs              []string `json:"jobIds"`
	PrimaryAttemptCount int      `json:"primaryAttemptCount,omitempty"`
}

type ProjectionMetrics struct {
	RecipientCount int `json:"recipientCount"`
	ChunkCount     int `json:"chunkCount"`
}

type ProjectionPayload struct {
	MessageID           string             `json:"messageId"`
	ChatID              string             `json:"chatId"`
	ChatType            string             `json:"chatType"`
	Seq                 int64              `json:"seq"`
	SenderID            string             `json:"senderId"`
	RecipientIDs        []string           `json:"recipientIds"`
	RecipientCount      int                `json:"recipientCount"`
	Topology            string             `json:"topology"`
	OutboxID            string             `json:"outboxId"`
	ChunkIndex          int                `json:"chunkIndex"`
	ChunkCount          int                `json:"chunkCount"`
	TotalRecipientCount int                `json:"totalRecipientCount"`
	JobID               string             `json:"jobId"`
	AttemptCount        int                `json:"attemptCount"`
	ReplayCount         int                `json:"replayCount"`
	Projection          *ProjectionMetrics `json:"projection,omitempty"`
	ErrorMessage        string             `json:"errorMessage,omitempty"`
	Terminal            bool               `json:"terminal,omitempty"`
}

func (p ProjectionPayload) ProjectionRecipientCount() int {
	if p.Projection == nil {
		return 0
	}
	return p.Projection.RecipientCount
}

func (p ProjectionPayload) ProjectionChunkCount() int {
	if p.Projection == nil {
		return 0
	}
	return p.Projection.ChunkCount
}

type ReplayChunk struct {
	ChunkIndex          int `json:"chunkIndex"`
	RecipientCount      int `json:"recipientCount"`
	ChunkCount          int `json:"chunkCount"`
	TotalRecipientCount int `json:"totalRecipientCount"`
}

type ReplayQueuedPayload struct {
	OutboxID           string        `json:"outboxId"`
	MessageID          string        `json:"messageId"`
	ChatID             string        `json:"chatId"`
	ChatType           string        `json:"chatType"`
	Seq                int64         `json:"seq"`
	ReplaySource       string        `json:"replaySource,omitempty"`
	ReplayedChunkCount int           `json:"replayedChunkCount"`
	ReplayCount        int           `json:"replayCount"`
	QueuedJobIDs       []string      `json:"queuedJobIds"`
	Chunks             []ReplayChunk `json:"chunks"`
}
