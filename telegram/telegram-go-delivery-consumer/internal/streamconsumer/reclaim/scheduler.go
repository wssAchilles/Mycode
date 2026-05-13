package reclaim

import "time"

type Scheduler struct {
	Interval time.Duration
	lastRun  time.Time
}

func NewScheduler(interval time.Duration) *Scheduler {
	return &Scheduler{Interval: interval}
}

func (s *Scheduler) Due(now time.Time) bool {
	if s == nil {
		return true
	}
	if s.Interval <= 0 {
		return false
	}
	return s.lastRun.IsZero() || now.Sub(s.lastRun) >= s.Interval
}

func (s *Scheduler) MarkRun(now time.Time) {
	if s == nil {
		return
	}
	s.lastRun = now
}
