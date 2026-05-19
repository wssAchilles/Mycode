package telemetry

import "go.opentelemetry.io/otel/attribute"

const (
	AttrStreamKey  = attribute.Key("messaging.stream.key")
	AttrMessageID  = attribute.Key("messaging.message.id")
	AttrTopic      = attribute.Key("messaging.message.topic")
	AttrStatus     = attribute.Key("messaging.message.status")
	AttrConsumerID = attribute.Key("messaging.consumer.id")

	StatusSuccess = "success"
	StatusError   = "error"
	StatusPoison  = "poison"
)
