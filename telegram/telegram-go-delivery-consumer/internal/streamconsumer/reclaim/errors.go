package reclaim

import (
	"errors"
	"fmt"
)

type AckError struct {
	StreamKey string
	MessageID string
	Err       error
}

func (e AckError) Error() string {
	if e.StreamKey == "" {
		return fmt.Sprintf("ack stream message %s: %v", e.MessageID, e.Err)
	}
	return fmt.Sprintf("ack stream message %s on %s: %v", e.MessageID, e.StreamKey, e.Err)
}

func (e AckError) Unwrap() error {
	return e.Err
}

func NewAckError(streamKey string, messageID string, err error) error {
	if err == nil {
		return nil
	}
	return AckError{StreamKey: streamKey, MessageID: messageID, Err: err}
}

func IsAckError(err error) bool {
	var ackErr AckError
	return errors.As(err, &ackErr)
}
