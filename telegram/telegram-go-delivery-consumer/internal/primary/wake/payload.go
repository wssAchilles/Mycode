package wake

import "encoding/json"

type Payload struct {
	UserID   string `json:"userId"`
	UpdateID int64  `json:"updateId"`
}

func Encode(userID string, updateID int64) (string, error) {
	payload, err := json.Marshal(Payload{
		UserID:   userID,
		UpdateID: updateID,
	})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}
