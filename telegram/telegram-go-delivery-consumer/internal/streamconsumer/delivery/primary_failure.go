package delivery

import "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/primary/failures"

type PrimaryFailureDecision struct {
	Category   failures.Category
	Handled    bool
	QueueRetry bool
	Terminal   bool
}

func DecidePrimaryFailure(err error, attemptCount int, maxAttempts int) PrimaryFailureDecision {
	strategy := failures.StrategyFor(err)
	decision := PrimaryFailureDecision{
		Category: failures.CategoryOf(err),
		Handled:  strategy.Handled,
	}
	if decision.Handled {
		return decision
	}
	if strategy.Retryable && attemptCount < maxAttempts {
		decision.QueueRetry = true
		return decision
	}
	decision.Terminal = strategy.Terminal || !strategy.Retryable || attemptCount >= maxAttempts
	return decision
}
