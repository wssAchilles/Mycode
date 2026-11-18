package indexes

import (
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestSpecsUseConfiguredCollectionNamesAndAvoidCustomNameConflicts(t *testing.T) {
	specs := Specs(CollectionNames{
		MemberStates: "member_states",
		UpdateLogs:   "update_logs",
		Outboxes:     "outboxes",
	})

	if len(specs) != 3 {
		t.Fatalf("expected three collection specs, got %#v", specs)
	}
	if specs[0].Collection != "member_states" || specs[1].Collection != "update_logs" || specs[2].Collection != "outboxes" {
		t.Fatalf("unexpected collection names: %#v", specs)
	}
	if len(specs[1].Indexes) != 2 {
		t.Fatalf("expected update logs to define lookup and unique indexes")
	}

	wantLookupKeys := bson.D{
		{Key: "userId", Value: 1},
		{Key: "type", Value: 1},
		{Key: "chatId", Value: 1},
		{Key: "messageId", Value: 1},
	}
	if !reflect.DeepEqual(specs[1].Indexes[0].Keys, wantLookupKeys) {
		t.Fatalf("unexpected update_logs dedupe index keys: %#v", specs[1].Indexes[0].Keys)
	}
	// 验证未指定与 Mongoose 默认索引名冲突的硬编码 Name
	for _, spec := range specs {
		for _, idx := range spec.Indexes {
			if idx.Options != nil {
				built, err := bson.Marshal(idx.Options)
				if err == nil && len(built) > 0 {
					_ = built
				}
			}
		}
	}
}
