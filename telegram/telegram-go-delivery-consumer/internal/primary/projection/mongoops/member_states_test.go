package mongoops

import (
	"testing"
	"time"
)

func TestBuildMemberStateModelsSkipsEmptyRecipients(t *testing.T) {
	models := BuildMemberStateModels(MemberStatePayload{ChatID: "chat-1", Seq: 7}, nil, time.Unix(1, 0))

	if len(models) != 0 {
		t.Fatalf("expected no models for empty recipients, got %d", len(models))
	}
}

func TestBuildMemberStateModelsCreatesOneModelPerRecipient(t *testing.T) {
	models := BuildMemberStateModels(MemberStatePayload{ChatID: "chat-1", Seq: 7}, []string{"u1", "u2"}, time.Unix(1, 0))

	if len(models) != 2 {
		t.Fatalf("expected two models, got %d", len(models))
	}
}
