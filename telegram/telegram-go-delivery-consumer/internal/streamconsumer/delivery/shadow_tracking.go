package delivery

import (
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/planner"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/shadow"
)

func BuildFanoutShadowTracks(payload contracts.FanoutRequestedPayload, maxRecipientsPerChunk int) []shadow.TrackedPlan {
	plan := planner.BuildShadowPlan(planner.FanoutRequest{
		MessageID:    payload.MessageID,
		ChatID:       payload.ChatID,
		OutboxID:     payload.OutboxID,
		RecipientIDs: payload.RecipientIDs,
	}, maxRecipientsPerChunk)

	tracks := make([]shadow.TrackedPlan, 0, len(plan.Chunks))
	for _, chunk := range plan.Chunks {
		tracks = append(tracks, shadow.TrackedPlan{
			MessageID:              plan.MessageID,
			OutboxID:               plan.OutboxID,
			ChunkIndex:             chunk.ChunkIndex,
			ExpectedRecipientCount: chunk.RecipientCount,
			ExpectedChunkCount:     plan.ChunkCount,
		})
	}
	return tracks
}

func BuildReplayShadowTracks(payload contracts.ReplayQueuedPayload) []shadow.TrackedPlan {
	tracks := make([]shadow.TrackedPlan, 0, len(payload.Chunks))
	for _, chunk := range payload.Chunks {
		tracks = append(tracks, shadow.TrackedPlan{
			MessageID:              payload.MessageID,
			OutboxID:               payload.OutboxID,
			ChunkIndex:             chunk.ChunkIndex,
			ExpectedRecipientCount: chunk.RecipientCount,
			ExpectedChunkCount:     chunk.ChunkCount,
		})
	}
	return tracks
}
