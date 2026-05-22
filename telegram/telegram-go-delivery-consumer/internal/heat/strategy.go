package heat

import "time"

// FanoutStrategy determines how to process message fan-out based on group heat.
type FanoutStrategy int

const (
	StrategySequential  FanoutStrategy = iota // Process chunks sequentially
	StrategyParallel                          // Process chunks in parallel with bounded concurrency
	StrategyPipelineBatch                     // Use Redis Pipeline for batch XADD
)

func (s FanoutStrategy) String() string {
	switch s {
	case StrategySequential:
		return "sequential"
	case StrategyParallel:
		return "parallel"
	case StrategyPipelineBatch:
		return "pipeline_batch"
	default:
		return "unknown"
	}
}

// StrategyConfig holds thresholds for strategy selection.
type StrategyConfig struct {
	ParallelThreshold     int64 // Message count to switch from sequential to parallel
	PipelineBatchThreshold int64 // Message count to switch from parallel to pipeline batch
	MaxParallelChunks     int   // Max concurrent chunk processing in parallel mode
}

// DefaultStrategyConfig returns sensible defaults.
func DefaultStrategyConfig() StrategyConfig {
	return StrategyConfig{
		ParallelThreshold:      10,
		PipelineBatchThreshold: 50,
		MaxParallelChunks:      8,
	}
}

// Selector selects a FanoutStrategy based on group heat level.
type Selector struct {
	cfg StrategyConfig
}

// NewSelector creates a new strategy Selector.
func NewSelector(cfg StrategyConfig) *Selector {
	return &Selector{cfg: cfg}
}

// Select returns the appropriate strategy for the given group heat.
func (s *Selector) Select(detector *Detector, groupID string, now time.Time) FanoutStrategy {
	level := detector.GetHeatLevel(groupID, now)

	switch level {
	case HeatLevelCritical:
		return StrategyPipelineBatch
	case HeatLevelHot:
		return StrategyParallel
	case HeatLevelWarm:
		return StrategyParallel
	default:
		return StrategySequential
	}
}

// SelectWithConcurrency returns the strategy and recommended concurrency level.
func (s *Selector) SelectWithConcurrency(detector *Detector, groupID string, now time.Time, chunkCount int) (FanoutStrategy, int) {
	strategy := s.Select(detector, groupID, now)

	switch strategy {
	case StrategyPipelineBatch:
		return strategy, 1 // Single pipeline call
	case StrategyParallel:
		concurrency := chunkCount
		if concurrency > s.cfg.MaxParallelChunks {
			concurrency = s.cfg.MaxParallelChunks
		}
		return strategy, concurrency
	default:
		return strategy, 1
	}
}
