package common

import (
	"reflect"
	"testing"
)

func TestDedupeRecipientsRemovesDuplicates(t *testing.T) {
	input := []string{"u1", "u2", "u1", "u3", "u2"}
	expected := []string{"u1", "u2", "u3"}
	result := DedupeRecipients(input)
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestDedupeRecipientsSkipsEmptyStrings(t *testing.T) {
	input := []string{"u1", "", "u2", "", "u3"}
	expected := []string{"u1", "u2", "u3"}
	result := DedupeRecipients(input)
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestDedupeRecipientsPreservesOrder(t *testing.T) {
	input := []string{"u3", "u1", "u2", "u1", "u3"}
	expected := []string{"u3", "u1", "u2"}
	result := DedupeRecipients(input)
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestDedupeRecipientsHandlesEmptySlice(t *testing.T) {
	result := DedupeRecipients([]string{})
	if len(result) != 0 {
		t.Fatalf("expected empty result, got %v", result)
	}
}

func TestDedupeRecipientsHandlesAllEmptyStrings(t *testing.T) {
	result := DedupeRecipients([]string{"", "", ""})
	if len(result) != 0 {
		t.Fatalf("expected empty result, got %v", result)
	}
}

func TestDedupeRecipientsHandlesNoDuplicates(t *testing.T) {
	input := []string{"u1", "u2", "u3"}
	expected := []string{"u1", "u2", "u3"}
	result := DedupeRecipients(input)
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}
