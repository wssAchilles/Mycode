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

func TestSummarizeOutboxChunksMatchesCompletedRepairView(t *testing.T) {
	chunks := []outboxChunk{
		{ChunkIndex: 0, Status: "completed", JobID: "job-0", Projection: &outboxProjection{RecipientCount: 2, ChunkCount: 1}},
		{ChunkIndex: 1, Status: "failed", JobID: "job-1"},
		{ChunkIndex: 2, Status: "queued"},
	}

	state := summarizeOutboxChunks(chunks)

	if state.Status != "failed" {
		t.Fatalf("expected failed aggregate status, got %#v", state)
	}
	if state.CompletedChunkCount != 1 || state.FailedChunkCount != 1 || state.QueuedChunkCount != 1 {
		t.Fatalf("unexpected chunk counters: %#v", state)
	}
	if state.ProjectedRecipientCount != 2 || state.ProjectedChunkCount != 1 {
		t.Fatalf("unexpected projection counters: %#v", state)
	}
	if len(state.QueuedJobIDs) != 2 || state.QueuedJobIDs[0] != "job-0" || state.QueuedJobIDs[1] != "job-1" {
		t.Fatalf("unexpected job ids: %#v", state.QueuedJobIDs)
	}
}

func TestChunkAggregateViewAppliesStateTransitionsWithoutDrift(t *testing.T) {
	doc := outboxDocument{Chunks: []outboxChunk{
		{ChunkIndex: 0, Status: "queued", JobID: "old-job"},
		{ChunkIndex: 1, Status: "queued"},
	}}

	applyChunkStarted(&doc, 0, "job-0")
	started := summarizeOutboxChunks(doc.Chunks)
	if started.Status != "projecting" || started.QueuedChunkCount != 1 || started.CompletedChunkCount != 0 {
		t.Fatalf("unexpected started aggregate: %#v", started)
	}
	if len(started.QueuedJobIDs) != 1 || started.QueuedJobIDs[0] != "job-0" {
		t.Fatalf("expected current job id only after start, got %#v", started.QueuedJobIDs)
	}

	applyChunkCompleted(&doc, 0, "job-0", 10, 1)
	applyChunkCompleted(&doc, 0, "job-0-retry", 10, 1)
	completed := summarizeOutboxChunks(doc.Chunks)
	if completed.Status != "partially_completed" || completed.QueuedChunkCount != 1 || completed.CompletedChunkCount != 1 {
		t.Fatalf("unexpected completed aggregate: %#v", completed)
	}
	if completed.ProjectedRecipientCount != 10 || completed.ProjectedChunkCount != 1 {
		t.Fatalf("projection counters drifted after repeated completion: %#v", completed)
	}
	if len(completed.QueuedJobIDs) != 1 || completed.QueuedJobIDs[0] != "job-0-retry" {
		t.Fatalf("expected latest chunk job id only after repeated completion, got %#v", completed.QueuedJobIDs)
	}
}
