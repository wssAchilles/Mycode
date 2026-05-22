package heat

import (
	"sync"
	"time"
)

// HeatLevel classifies group activity for strategy selection.
type HeatLevel int

const (
	HeatLevelCold     HeatLevel = iota // < 10 msg/min
	HeatLevelWarm                      // 10-50 msg/min
	HeatLevelHot                       // 50-100 msg/min
	HeatLevelCritical                  // > 100 msg/min
)

func (h HeatLevel) String() string {
	switch h {
	case HeatLevelCold:
		return "cold"
	case HeatLevelWarm:
		return "warm"
	case HeatLevelHot:
		return "hot"
	case HeatLevelCritical:
		return "critical"
	default:
		return "unknown"
	}
}

// GroupHeat tracks message activity for a single group within a sliding window.
type GroupHeat struct {
	GroupID       string
	MessageCount  int64
	WindowStart   time.Time
	LastMessageAt time.Time
}

// DetectorConfig holds configuration for the HotGroupDetector.
type DetectorConfig struct {
	WindowDuration    time.Duration // Sliding window duration (default: 1 minute)
	WarmThreshold     int64         // Messages per window to classify as warm
	HotThreshold      int64         // Messages per window to classify as hot
	CriticalThreshold int64         // Messages per window to classify as critical
	MaxTrackedGroups  int           // Maximum number of groups to track (eviction limit)
}

// DefaultDetectorConfig returns sensible defaults for heat detection.
func DefaultDetectorConfig() DetectorConfig {
	return DetectorConfig{
		WindowDuration:    time.Minute,
		WarmThreshold:     10,
		HotThreshold:      50,
		CriticalThreshold: 100,
		MaxTrackedGroups:  10000,
	}
}

// Detector tracks per-group message rates using a sliding window.
// Thread-safe: all operations are protected by a RWMutex.
type Detector struct {
	cfg    DetectorConfig
	mu     sync.RWMutex
	groups map[string]*GroupHeat
}

// NewDetector creates a new HotGroupDetector with the given configuration.
func NewDetector(cfg DetectorConfig) *Detector {
	return &Detector{
		cfg:    cfg,
		groups: make(map[string]*GroupHeat, cfg.MaxTrackedGroups/10),
	}
}

// RecordMessage increments the message count for a group and updates timestamps.
func (d *Detector) RecordMessage(groupID string, now time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()

	heat, exists := d.groups[groupID]
	if !exists {
		if len(d.groups) >= d.cfg.MaxTrackedGroups {
			d.evictOldest()
		}
		heat = &GroupHeat{
			GroupID:     groupID,
			WindowStart: now,
		}
		d.groups[groupID] = heat
	}

	if now.Sub(heat.WindowStart) >= d.cfg.WindowDuration {
		heat.MessageCount = 0
		heat.WindowStart = now
	}

	heat.MessageCount++
	heat.LastMessageAt = now
}

// GetHeatLevel returns the current heat level for a group.
func (d *Detector) GetHeatLevel(groupID string, now time.Time) HeatLevel {
	d.mu.RLock()
	defer d.mu.RUnlock()

	heat, exists := d.groups[groupID]
	if !exists {
		return HeatLevelCold
	}

	if now.Sub(heat.WindowStart) >= d.cfg.WindowDuration {
		return HeatLevelCold
	}

	return classifyLevel(heat.MessageCount, d.cfg)
}

// GetHeat returns the current heat data for a group (read-only snapshot).
func (d *Detector) GetHeat(groupID string, now time.Time) GroupHeat {
	d.mu.RLock()
	defer d.mu.RUnlock()

	heat, exists := d.groups[groupID]
	if !exists {
		return GroupHeat{GroupID: groupID}
	}

	if now.Sub(heat.WindowStart) >= d.cfg.WindowDuration {
		return GroupHeat{GroupID: groupID, WindowStart: now}
	}

	return *heat
}

func classifyLevel(count int64, cfg DetectorConfig) HeatLevel {
	switch {
	case count >= cfg.CriticalThreshold:
		return HeatLevelCritical
	case count >= cfg.HotThreshold:
		return HeatLevelHot
	case count >= cfg.WarmThreshold:
		return HeatLevelWarm
	default:
		return HeatLevelCold
	}
}

// evictOldest removes the group with the oldest LastMessageAt.
// Caller must hold d.mu write lock.
func (d *Detector) evictOldest() {
	var oldestKey string
	var oldestTime time.Time
	for key, heat := range d.groups {
		if oldestKey == "" || heat.LastMessageAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = heat.LastMessageAt
		}
	}
	if oldestKey != "" {
		delete(d.groups, oldestKey)
	}
}
