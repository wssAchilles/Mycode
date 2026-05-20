package streamconsumer

import (
	"fmt"
	"sync/atomic"
)

// ConsumerState represents the lifecycle state of the StreamConsumer.
type ConsumerState int32

const (
	StateSpawning       ConsumerState = iota // constructor called, not yet running
	StateConnecting                          // Redis connection established
	StateEnsuringGroup                       // consumer group creation/verification
	StateDrainingPEL                         // processing own pending entries
	StateRunning                             // normal message consumption
	StateDraining                            // graceful shutdown in progress
	StateStopped                             // fully stopped
)

func (s ConsumerState) String() string {
	switch s {
	case StateSpawning:
		return "spawning"
	case StateConnecting:
		return "connecting"
	case StateEnsuringGroup:
		return "ensuring_group"
	case StateDrainingPEL:
		return "draining_pel"
	case StateRunning:
		return "running"
	case StateDraining:
		return "draining"
	case StateStopped:
		return "stopped"
	default:
		return "unknown"
	}
}

// StateTracker provides atomic lifecycle state transitions.
type StateTracker struct {
	state atomic.Int32
}

func NewStateTracker(initial ConsumerState) *StateTracker {
	t := &StateTracker{}
	t.state.Store(int32(initial))
	return t
}

func (t *StateTracker) Current() ConsumerState {
	return ConsumerState(t.state.Load())
}

// Transition moves to the new state. Returns an error if the transition is invalid.
func (t *StateTracker) Transition(next ConsumerState) error {
	for {
		cur := t.state.Load()
		if !validTransition(ConsumerState(cur), next) {
			return fmt.Errorf("invalid state transition: %s -> %s", ConsumerState(cur), next)
		}
		if t.state.CompareAndSwap(cur, int32(next)) {
			return nil
		}
	}
}

func validTransition(from, to ConsumerState) bool {
	switch from {
	case StateSpawning:
		return to == StateConnecting
	case StateConnecting:
		return to == StateEnsuringGroup || to == StateStopped
	case StateEnsuringGroup:
		return to == StateDrainingPEL || to == StateRunning || to == StateStopped
	case StateDrainingPEL:
		return to == StateRunning || to == StateStopped
	case StateRunning:
		return to == StateDraining || to == StateStopped
	case StateDraining:
		return to == StateStopped
	case StateStopped:
		return false // terminal state
	default:
		return false
	}
}
