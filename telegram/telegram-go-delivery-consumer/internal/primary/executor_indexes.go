package primary

import (
	"context"
	"fmt"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/indexes"
)

func (e *MongoExecutor) EnsureIndexes(ctx context.Context) error {
	if e == nil || e.client == nil {
		return fmt.Errorf("mongo executor unavailable")
	}
	if e.cfg.MongoDatabase == "" {
		return fmt.Errorf("mongo database is required")
	}
	db := e.client.Database(e.cfg.MongoDatabase)
	for _, spec := range indexes.Specs(indexes.CollectionNames{
		MemberStates: e.cfg.MemberStateCollection,
		UpdateLogs:   e.cfg.UpdateLogCollection,
		Outboxes:     e.cfg.OutboxCollection,
	}) {
		if spec.Collection == "" || len(spec.Indexes) == 0 {
			continue
		}
		if _, err := db.Collection(spec.Collection).Indexes().CreateMany(ctx, spec.Indexes); err != nil {
			return fmt.Errorf("ensure indexes for %s: %w", spec.Collection, err)
		}
	}
	return nil
}
