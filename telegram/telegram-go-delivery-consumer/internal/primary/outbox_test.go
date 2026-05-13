package primary

import "testing"

func TestCompletedChunkProjectionsKeepsOnlyCompletedChunks(t *testing.T) {
	completed := completedChunkProjections([]outboxChunk{
		{
			ChunkIndex: 0,
			Status:     "completed",
			Projection: &outboxProjection{RecipientCount: 2, ChunkCount: 1},
		},
		{
			ChunkIndex: 1,
			Status:     "projecting",
			Projection: &outboxProjection{RecipientCount: 3, ChunkCount: 1},
		},
		{
			ChunkIndex: 2,
			Status:     "completed",
		},
	})

	if len(completed) != 2 {
		t.Fatalf("expected two completed chunks, got %#v", completed)
	}
	if completed[0].RecipientCount != 2 || completed[0].ChunkCount != 1 {
		t.Fatalf("unexpected chunk 0 projection: %#v", completed[0])
	}
	if _, exists := completed[1]; exists {
		t.Fatalf("expected projecting chunk to be absent: %#v", completed)
	}
	if completed[2].ChunkCount != 1 {
		t.Fatalf("expected missing legacy projection to count as one chunk, got %#v", completed[2])
	}
}
