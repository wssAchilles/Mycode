package projection

func ChunkStrings(values []string, chunkSize int) [][]string {
	if len(values) == 0 {
		return nil
	}
	if chunkSize <= 0 {
		chunkSize = len(values)
	}
	chunks := make([][]string, 0, (len(values)+chunkSize-1)/chunkSize)
	for offset := 0; offset < len(values); offset += chunkSize {
		end := offset + chunkSize
		if end > len(values) {
			end = len(values)
		}
		chunks = append(chunks, values[offset:end])
	}
	return chunks
}

func PendingRecipients(recipients []string, existing map[string]struct{}) []string {
	pending := make([]string, 0, len(recipients))
	for _, userID := range recipients {
		if _, exists := existing[userID]; exists {
			continue
		}
		pending = append(pending, userID)
	}
	return pending
}
