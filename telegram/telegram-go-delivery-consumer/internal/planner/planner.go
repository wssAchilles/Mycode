package planner

type FanoutRequest struct {
	MessageID    string
	ChatID       string
	OutboxID     string
	RecipientIDs []string
}

type ChunkPlan struct {
	ChunkIndex     int
	RecipientIDs   []string
	RecipientCount int
}

type ShadowPlan struct {
	MessageID           string
	ChatID              string
	OutboxID            string
	TotalRecipientCount int
	ChunkCount          int
	Chunks              []ChunkPlan
}

func BuildShadowPlan(request FanoutRequest, maxRecipientsPerChunk int) ShadowPlan {
	recipients := dedupeRecipients(request.RecipientIDs)
	if maxRecipientsPerChunk <= 0 {
		maxRecipientsPerChunk = 1
	}

	chunkCount := 0
	if len(recipients) > 0 {
		chunkCount = (len(recipients) + maxRecipientsPerChunk - 1) / maxRecipientsPerChunk
	}

	chunks := make([]ChunkPlan, 0, chunkCount)
	for offset, chunkIndex := 0, 0; offset < len(recipients); offset, chunkIndex = offset+maxRecipientsPerChunk, chunkIndex+1 {
		end := offset + maxRecipientsPerChunk
		if end > len(recipients) {
			end = len(recipients)
		}
		chunkRecipients := append([]string(nil), recipients[offset:end]...)
		chunks = append(chunks, ChunkPlan{
			ChunkIndex:     chunkIndex,
			RecipientIDs:   chunkRecipients,
			RecipientCount: len(chunkRecipients),
		})
	}

	return ShadowPlan{
		MessageID:           request.MessageID,
		ChatID:              request.ChatID,
		OutboxID:            request.OutboxID,
		TotalRecipientCount: len(recipients),
		ChunkCount:          chunkCount,
		Chunks:              chunks,
	}
}

func dedupeRecipients(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
