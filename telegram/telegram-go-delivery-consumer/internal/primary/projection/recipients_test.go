package projection

import "testing"

func TestChunkStringsSplitsRecipients(t *testing.T) {
	chunks := ChunkStrings([]string{"u1", "u2", "u3", "u4", "u5"}, 2)

	if len(chunks) != 3 {
		t.Fatalf("expected three chunks, got %#v", chunks)
	}
	if len(chunks[0]) != 2 || len(chunks[1]) != 2 || len(chunks[2]) != 1 {
		t.Fatalf("unexpected chunk sizes: %#v", chunks)
	}
}

func TestPendingRecipientsFiltersExistingUsers(t *testing.T) {
	pending := PendingRecipients([]string{"u1", "u2", "u3"}, map[string]struct{}{"u2": {}})

	if len(pending) != 2 || pending[0] != "u1" || pending[1] != "u3" {
		t.Fatalf("unexpected pending recipients: %#v", pending)
	}
}
