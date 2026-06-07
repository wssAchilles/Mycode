package primary

import "time"

type outboxAggregateState struct {
	Status                  string
	QueuedChunkCount        int
	CompletedChunkCount     int
	FailedChunkCount        int
	ProjectedRecipientCount int
	ProjectedChunkCount     int
	QueuedJobIDs            []string
	LastCompletedAt         *time.Time
}

func summarizeOutboxChunks(chunks []outboxChunk) outboxAggregateState {
	state := outboxAggregateState{
		Status:       deriveOutboxStatus(chunks),
		QueuedJobIDs: make([]string, 0, len(chunks)),
	}
	for _, chunk := range chunks {
		switch chunk.Status {
		case "queued":
			state.QueuedChunkCount++
		case "completed":
			state.CompletedChunkCount++
		case "failed":
			state.FailedChunkCount++
		}
		if chunk.JobID != "" {
			state.QueuedJobIDs = append(state.QueuedJobIDs, chunk.JobID)
		}
		if chunk.Projection != nil {
			state.ProjectedRecipientCount += chunk.Projection.RecipientCount
			state.ProjectedChunkCount += positiveOrDefault(chunk.Projection.ChunkCount, 1)
		}
	}
	if state.Status == "completed" {
		now := time.Now().UTC()
		state.LastCompletedAt = &now
	}
	return state
}

func applyChunkStarted(doc *outboxDocument, chunkIndex int, jobID string) {
	for index := range doc.Chunks {
		if doc.Chunks[index].ChunkIndex != chunkIndex {
			continue
		}
		doc.Chunks[index].Status = "projecting"
		doc.Chunks[index].JobID = jobID
		return
	}
}

func applyChunkCompleted(doc *outboxDocument, chunkIndex int, jobID string, recipientCount int, projectionCount int) {
	for index := range doc.Chunks {
		if doc.Chunks[index].ChunkIndex != chunkIndex {
			continue
		}
		doc.Chunks[index].Status = "completed"
		doc.Chunks[index].JobID = jobID
		doc.Chunks[index].Projection = &outboxProjection{
			RecipientCount: recipientCount,
			ChunkCount:     projectionCount,
		}
		return
	}
}
