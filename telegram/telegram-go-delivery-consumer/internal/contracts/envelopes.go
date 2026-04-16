package contracts

import "encoding/json"

type DeliveryEventEnvelope struct {
	SpecVersion  string          `json:"specVersion"`
	Producer     string          `json:"producer"`
	EventID      string          `json:"eventId"`
	Topic        string          `json:"topic"`
	EmittedAt    string          `json:"emittedAt"`
	PartitionKey string          `json:"partitionKey"`
	Payload      json.RawMessage `json:"payload"`
}

type PlatformEventEnvelope struct {
	SpecVersion  string          `json:"specVersion"`
	Producer     string          `json:"producer"`
	EventID      string          `json:"eventId"`
	Topic        string          `json:"topic"`
	EmittedAt    string          `json:"emittedAt"`
	PartitionKey string          `json:"partitionKey"`
	Payload      json.RawMessage `json:"payload"`
}
