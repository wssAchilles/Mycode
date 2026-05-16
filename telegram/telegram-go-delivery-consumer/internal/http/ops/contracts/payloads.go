package contracts

import (
	runtimesnapshot "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/observability/runtime"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/summary"
)

type ControlPlane struct {
	ContractVersion string         `json:"contractVersion"`
	Runtime         map[string]any `json:"runtime"`
	Throughput      map[string]any `json:"throughput"`
	Reclaim         map[string]any `json:"reclaim"`
	Primary         map[string]any `json:"primary"`
	Platform        map[string]any `json:"platform"`
	Mongo           map[string]any `json:"mongo"`
}

type PlatformProbe struct {
	OK                  bool                     `json:"ok"`
	Service             string                   `json:"service"`
	ContractVersion     string                   `json:"contractVersion"`
	CheckedAt           string                   `json:"checkedAt"`
	Consumer            summary.Snapshot         `json:"consumer"`
	Replay              any                      `json:"replay"`
	RuntimeStats        runtimesnapshot.Snapshot `json:"runtimeStats"`
	CheckedCapabilities []string                 `json:"checkedCapabilities"`
	Runtime             map[string]any           `json:"runtime"`
}
