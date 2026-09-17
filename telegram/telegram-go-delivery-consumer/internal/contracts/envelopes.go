package contracts

import "encoding/json"

const (
	// DeliveryEventSpecVersion 是投递总线标准契约版本
	DeliveryEventSpecVersion = "chat.delivery.v1"
	// PlatformEventSpecVersion 是平台事件总线标准契约版本
	PlatformEventSpecVersion = "platform.event.v1"
)

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
