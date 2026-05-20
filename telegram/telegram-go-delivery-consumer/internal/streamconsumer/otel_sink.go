package streamconsumer

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const eventTracerName = "delivery-consumer.events"

// OTelEventSink emits ConsumerEvents as OpenTelemetry spans.
type OTelEventSink struct {
	tracer trace.Tracer
}

func NewOTelEventSink() *OTelEventSink {
	return &OTelEventSink{tracer: otel.Tracer(eventTracerName)}
}

func (s *OTelEventSink) Emit(e ConsumerEvent) {
	_, span := s.tracer.Start(context.Background(), "consumer."+e.Type.String(),
		trace.WithTimestamp(e.Timestamp),
		trace.WithAttributes(
			attribute.String("consumer.event.type", e.Type.String()),
			attribute.String("consumer.stream_key", e.StreamKey),
			attribute.String("consumer.message_id", e.MessageID),
			attribute.String("consumer.topic", e.Topic),
			attribute.String("consumer.scenario", e.Scenario.String()),
		),
	)

	if e.Duration > 0 {
		span.SetAttributes(attribute.Int64("consumer.duration_ms", e.Duration.Milliseconds()))
	}

	if e.Error != nil {
		span.SetStatus(codes.Error, e.Error.Error())
		span.RecordError(e.Error)
	} else {
		span.SetStatus(codes.Ok, "")
	}

	span.End()
}

// CompositeEventSink fans out events to multiple sinks.
type CompositeEventSink struct {
	sinks []EventSink
}

func NewCompositeEventSink(sinks ...EventSink) *CompositeEventSink {
	return &CompositeEventSink{sinks: sinks}
}

func (c *CompositeEventSink) Emit(e ConsumerEvent) {
	for _, sink := range c.sinks {
		sink.Emit(e)
	}
}
