package telemetry

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "delivery-consumer"

// MessageHandler processes a single message from a Redis stream.
type MessageHandler func(ctx context.Context, streamKey string, messageID string, topic string) error

// MessageTracer wraps message handling with OpenTelemetry spans.
type MessageTracer struct {
	tracer trace.Tracer
}

// NewMessageTracer creates a MessageTracer using the global TracerProvider.
func NewMessageTracer() *MessageTracer {
	return &MessageTracer{
		tracer: otel.Tracer(tracerName),
	}
}

// WrapHandler returns a MessageHandler that creates a span around the inner handler.
func (t *MessageTracer) WrapHandler(next MessageHandler) MessageHandler {
	return func(ctx context.Context, streamKey, messageID, topic string) error {
		ctx, span := t.tracer.Start(ctx, "process_message",
			trace.WithAttributes(
				AttrStreamKey.String(streamKey),
				AttrMessageID.String(messageID),
				AttrTopic.String(topic),
			),
		)
		defer span.End()

		start := time.Now()
		err := next(ctx, streamKey, messageID, topic)
		elapsed := time.Since(start)

		span.SetAttributes(
			attribute.Int64("messaging.duration_ms", elapsed.Milliseconds()),
		)

		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			span.RecordError(err)
			span.SetAttributes(AttrStatus.String(StatusError))
		} else {
			span.SetStatus(codes.Ok, "")
			span.SetAttributes(AttrStatus.String(StatusSuccess))
		}
		return err
	}
}
