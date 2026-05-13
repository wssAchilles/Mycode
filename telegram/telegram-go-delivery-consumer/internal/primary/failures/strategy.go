package failures

type Strategy struct {
	Retryable bool
	Terminal  bool
	Handled   bool
}

func StrategyFor(err error) Strategy {
	switch Classify(err).Category {
	case CategoryDuplicateKey, CategoryNone:
		return Strategy{Handled: true}
	case CategoryTerminalWrite:
		return Strategy{Terminal: true}
	case CategoryWriteConcern, CategoryNetwork, CategoryTimeout, CategoryContextCanceled, CategoryUnknown:
		return Strategy{Retryable: true}
	default:
		return Strategy{Retryable: true}
	}
}
