package indexes

import "testing"

func TestSpecsUseConfiguredCollectionNames(t *testing.T) {
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
}
