package primary

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/indexes"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// EnsureIndexes 幂等创建主投影所需索引；若目标集合已存在相同键序列的索引（如 Mongoose 创建），自动跳过以避免命名冲突。
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
		coll := db.Collection(spec.Collection)
		existingSpecs, err := coll.Indexes().ListSpecifications(ctx)
		if err != nil {
			return fmt.Errorf("list existing indexes for %s: %w", spec.Collection, err)
		}
		existingKeys := make(map[string]struct{}, len(existingSpecs))
		for _, item := range existingSpecs {
			if sig := indexKeySignature(item.KeysDocument); sig != "" {
				existingKeys[sig] = struct{}{}
			}
		}
		for _, model := range spec.Indexes {
			sig := indexModelSignature(model.Keys)
			if sig != "" {
				if _, exists := existingKeys[sig]; exists {
					continue
				}
			}
			if _, err := coll.Indexes().CreateOne(ctx, model); err != nil {
				if isEquivalentIndexConflict(err) {
					continue
				}
				return fmt.Errorf("ensure index for %s: %w", spec.Collection, err)
			}
			if sig != "" {
				existingKeys[sig] = struct{}{}
			}
		}
	}
	return nil
}

func indexModelSignature(keys any) string {
	switch typed := keys.(type) {
	case bson.D:
		return formatBsonKeyElements(typed)
	case bson.Raw:
		var doc bson.D
		if err := bson.Unmarshal(typed, &doc); err == nil {
			return formatBsonKeyElements(doc)
		}
	}
	raw, err := bson.Marshal(keys)
	if err != nil {
		return ""
	}
	var doc bson.D
	if err := bson.Unmarshal(raw, &doc); err != nil {
		return ""
	}
	return formatBsonKeyElements(doc)
}

func indexKeySignature(raw bson.Raw) string {
	if len(raw) == 0 {
		return ""
	}
	var doc bson.D
	if err := bson.Unmarshal(raw, &doc); err != nil {
		return ""
	}
	return formatBsonKeyElements(doc)
}

func formatBsonKeyElements(doc bson.D) string {
	if len(doc) == 0 {
		return ""
	}
	parts := make([]string, 0, len(doc))
	for _, elem := range doc {
		parts = append(parts, fmt.Sprintf("%s:%v", elem.Key, elem.Value))
	}
	return strings.Join(parts, ",")
}

func isEquivalentIndexConflict(err error) bool {
	var cmdErr mongo.CommandError
	if errors.As(err, &cmdErr) {
		// 兼容同键索引并发创建或历史命名差异触发的 Code 85 与 Code 86 冲突码
		return cmdErr.Code == 85 || cmdErr.Code == 86
	}
	return false
}
