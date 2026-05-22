package heat

import (
	"time"
)

// HeatScore is a normalized 0-100 score representing group activity intensity.
type HeatScore float64

// ScoreConfig holds parameters for score calculation.
type ScoreConfig struct {
	MaxMessagesPerWindow int64 // Saturation point for score normalization
}

// DefaultScoreConfig returns sensible defaults.
func DefaultScoreConfig() ScoreConfig {
	return ScoreConfig{
		MaxMessagesPerWindow: 200,
	}
}

// Scorer computes a normalized heat score for a group.
type Scorer struct {
	cfg ScoreConfig
}

// NewScorer creates a new HeatScorer.
func NewScorer(cfg ScoreConfig) *Scorer {
	return &Scorer{cfg: cfg}
}

// ComputeScore returns a HeatScore in [0, 100] based on the group's current heat.
func (s *Scorer) ComputeScore(heat GroupHeat, now time.Time, windowDuration time.Duration) HeatScore {
	if now.Sub(heat.WindowStart) >= windowDuration {
		return 0
	}

	if heat.MessageCount <= 0 {
		return 0
	}

	score := float64(heat.MessageCount) / float64(s.cfg.MaxMessagesPerWindow) * 100
	if score > 100 {
		score = 100
	}
	return HeatScore(score)
}
