package wake

import "encoding/json"

type BatchPayload struct {
	Updates []Payload `json:"updates"`
}

func EncodeBatch(updates []Payload) (string, error) {
	payload, err := json.Marshal(BatchPayload{Updates: append([]Payload(nil), updates...)})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}
