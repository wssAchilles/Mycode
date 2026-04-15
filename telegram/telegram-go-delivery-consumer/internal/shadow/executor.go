package shadow

import (
	"fmt"
	"sync"
)

type TrackedPlan struct {
	MessageID              string
	OutboxID               string
	ChunkIndex             int
	ExpectedRecipientCount int
	ExpectedChunkCount     int
}

type ProjectionResult struct {
	MessageID      string
	OutboxID       string
	ChunkIndex     int
	RecipientCount int
	ChunkCount     int
}

type ComparisonResult struct {
	Compared bool
	Matched  bool
	Reason   string
}

type Tracker struct {
	mu    sync.Mutex
	items map[string]TrackedPlan
}

func New() *Tracker {
	return &Tracker{
		items: map[string]TrackedPlan{},
	}
}

func (t *Tracker) Track(plan TrackedPlan) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.items[keyFor(plan.OutboxID, plan.MessageID, plan.ChunkIndex)] = plan
}

func (t *Tracker) Compare(result ProjectionResult) ComparisonResult {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := keyFor(result.OutboxID, result.MessageID, result.ChunkIndex)
	expected, exists := t.items[key]
	if !exists {
		return ComparisonResult{
			Compared: false,
			Matched:  false,
			Reason:   "missing_shadow_plan",
		}
	}
	delete(t.items, key)

	if expected.ExpectedRecipientCount != result.RecipientCount {
		return ComparisonResult{
			Compared: true,
			Matched:  false,
			Reason:   fmt.Sprintf("recipient_count_mismatch expected=%d actual=%d", expected.ExpectedRecipientCount, result.RecipientCount),
		}
	}
	if expected.ExpectedChunkCount != result.ChunkCount {
		return ComparisonResult{
			Compared: true,
			Matched:  false,
			Reason:   fmt.Sprintf("chunk_count_mismatch expected=%d actual=%d", expected.ExpectedChunkCount, result.ChunkCount),
		}
	}

	return ComparisonResult{
		Compared: true,
		Matched:  true,
	}
}

func (t *Tracker) Fail(result ProjectionResult, errorMessage string) ComparisonResult {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := keyFor(result.OutboxID, result.MessageID, result.ChunkIndex)
	if _, exists := t.items[key]; !exists {
		return ComparisonResult{
			Compared: false,
			Matched:  false,
			Reason:   "missing_shadow_plan",
		}
	}
	delete(t.items, key)
	return ComparisonResult{
		Compared: true,
		Matched:  false,
		Reason:   fmt.Sprintf("projection_failed %s", errorMessage),
	}
}

func (t *Tracker) Pending() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.items)
}

func keyFor(outboxID string, messageID string, chunkIndex int) string {
	identity := outboxID
	if identity == "" {
		identity = messageID
	}
	return fmt.Sprintf("%s:%d", identity, chunkIndex)
}
