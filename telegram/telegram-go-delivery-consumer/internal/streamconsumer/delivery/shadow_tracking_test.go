package delivery

import (
	"testing"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
)

func TestBuildFanoutShadowTracksUsesPlannerChunks(t *testing.T) {
	tracks := BuildFanoutShadowTracks(contracts.FanoutRequestedPayload{
		MessageID:    "msg-1",
		ChatID:       "chat-1",
		OutboxID:     "outbox-1",
		RecipientIDs: []string{"u1", "u2", "u3"},
	}, 2)

	if len(tracks) != 2 {
		t.Fatalf("expected two tracked chunks, got %#v", tracks)
	}
	if tracks[0].ChunkIndex != 0 || tracks[0].ExpectedRecipientCount != 2 || tracks[0].ExpectedChunkCount != 2 {
		t.Fatalf("unexpected first fanout track: %#v", tracks[0])
	}
	if tracks[1].ChunkIndex != 1 || tracks[1].ExpectedRecipientCount != 1 || tracks[1].ExpectedChunkCount != 2 {
		t.Fatalf("unexpected second fanout track: %#v", tracks[1])
	}
}

func TestBuildReplayShadowTracksUsesReplayChunks(t *testing.T) {
	tracks := BuildReplayShadowTracks(contracts.ReplayQueuedPayload{
		MessageID: "msg-2",
		OutboxID:  "outbox-2",
		Chunks: []contracts.ReplayChunk{
			{ChunkIndex: 3, RecipientCount: 7, ChunkCount: 5},
		},
	})

	if len(tracks) != 1 {
		t.Fatalf("expected one replay track, got %#v", tracks)
	}
	if tracks[0].MessageID != "msg-2" || tracks[0].OutboxID != "outbox-2" ||
		tracks[0].ChunkIndex != 3 || tracks[0].ExpectedRecipientCount != 7 || tracks[0].ExpectedChunkCount != 5 {
		t.Fatalf("unexpected replay track: %#v", tracks[0])
	}
}
