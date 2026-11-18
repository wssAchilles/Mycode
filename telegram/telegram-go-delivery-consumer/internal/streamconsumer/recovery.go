package streamconsumer

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	reclaimstate "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
)

const (
	defaultMinRecoveryBackoff = 50 * time.Millisecond
	defaultMaxRecoveryBackoff = 5 * time.Second
)

// FailureScenario 枚举消费者在运行期可识别的故障场景。
type FailureScenario int

const (
	ScenarioRedisTimeout         FailureScenario = iota // Redis 瞬态网络或超时错误
	ScenarioPoisonMessage                               // 无法解析或处理的毒丸消息
	ScenarioDLQWriteFailed                              // 死信队列写入失败，禁止确认原消息
	ScenarioAckFailed                                   // XACK 确认失败，等待重投或回收
	ScenarioStreamReadFailed                            // XREADGROUP 读取失败
	ScenarioConsumerGroupMissing                        // Redis NOGROUP 消费组丢失，需自动重建
)

func (s FailureScenario) String() string {
	switch s {
	case ScenarioRedisTimeout:
		return "redis_timeout"
	case ScenarioPoisonMessage:
		return "poison_message"
	case ScenarioDLQWriteFailed:
		return "dlq_write_failed"
	case ScenarioAckFailed:
		return "ack_failed"
	case ScenarioStreamReadFailed:
		return "stream_read_failed"
	case ScenarioConsumerGroupMissing:
		return "consumer_group_missing"
	default:
		return "unknown"
	}
}

// DLQWriteError 封装死信流写入失败错误，用于阻断 XACK 并触发 ScenarioDLQWriteFailed 恢复策略。
type DLQWriteError struct {
	StreamKey   string
	MessageID   string
	Err         error
	OriginalErr error
}

func (e DLQWriteError) Error() string {
	if e.OriginalErr != nil {
		return fmt.Sprintf("dlq write failed for message %s on %s: %v (cause: %v)", e.MessageID, e.StreamKey, e.Err, e.OriginalErr)
	}
	return fmt.Sprintf("dlq write failed for message %s on %s: %v", e.MessageID, e.StreamKey, e.Err)
}

func (e DLQWriteError) Unwrap() error {
	return e.Err
}

// NewDLQWriteError 构造类型化的死信写入失败错误。
func NewDLQWriteError(streamKey string, messageID string, err error, originalErr error) error {
	if err == nil {
		return nil
	}
	return DLQWriteError{
		StreamKey:   streamKey,
		MessageID:   messageID,
		Err:         err,
		OriginalErr: originalErr,
	}
}

// IsDLQWriteError 判断错误是否为死信写入失败。
func IsDLQWriteError(err error) bool {
	var dlqErr DLQWriteError
	return errors.As(err, &dlqErr)
}

// StreamReadError 封装流读取阶段错误。
type StreamReadError struct {
	StreamKey string
	Err       error
}

func (e StreamReadError) Error() string {
	if e.StreamKey == "" {
		return fmt.Sprintf("stream read failed: %v", e.Err)
	}
	return fmt.Sprintf("stream read failed on %s: %v", e.StreamKey, e.Err)
}

func (e StreamReadError) Unwrap() error {
	return e.Err
}

// NewStreamReadError 构造类型化流读取错误。
func NewStreamReadError(streamKey string, err error) error {
	if err == nil {
		return nil
	}
	return StreamReadError{StreamKey: streamKey, Err: err}
}

// IsStreamReadError 判断是否为流读取阶段错误。
func IsStreamReadError(err error) bool {
	var readErr StreamReadError
	return errors.As(err, &readErr)
}

// IsNoGroupError 识别 Redis NOGROUP 错误（流键被驱逐或实例重启导致消费组缺失）。
func IsNoGroupError(err error) bool {
	return err != nil && strings.Contains(strings.ToUpper(err.Error()), "NOGROUP")
}

// EscalationPolicy defines what happens when retries are exhausted.
type EscalationPolicy int

const (
	EscalationLogAndContinue EscalationPolicy = iota // log and skip the message
	EscalationAlertHuman                             // log at ERROR level, metric increment
	EscalationAbort                                  // terminate the consumer
)

func (p EscalationPolicy) String() string {
	switch p {
	case EscalationLogAndContinue:
		return "log_and_continue"
	case EscalationAlertHuman:
		return "alert_human"
	case EscalationAbort:
		return "abort"
	default:
		return "unknown"
	}
}

// RecoveryRecipe defines how the consumer should respond to a specific failure scenario.
type RecoveryRecipe struct {
	Scenario    FailureScenario
	MaxAttempts int
	Escalation  EscalationPolicy
	BackoffBase time.Duration
}

// defaultRecipes returns the built-in recovery recipes.
func defaultRecipes() map[FailureScenario]RecoveryRecipe {
	return map[FailureScenario]RecoveryRecipe{
		ScenarioRedisTimeout: {
			Scenario:    ScenarioRedisTimeout,
			MaxAttempts: 5,
			Escalation:  EscalationAlertHuman,
			BackoffBase: 200 * time.Millisecond,
		},
		ScenarioPoisonMessage: {
			Scenario:    ScenarioPoisonMessage,
			MaxAttempts: 1, // no retry — send to DLQ immediately
			Escalation:  EscalationLogAndContinue,
			BackoffBase: 0,
		},
		ScenarioDLQWriteFailed: {
			Scenario:    ScenarioDLQWriteFailed,
			MaxAttempts: 3,
			Escalation:  EscalationAlertHuman,
			BackoffBase: 500 * time.Millisecond,
		},
		ScenarioAckFailed: {
			Scenario:    ScenarioAckFailed,
			MaxAttempts: 3,
			Escalation:  EscalationLogAndContinue,
			BackoffBase: 100 * time.Millisecond,
		},
		ScenarioStreamReadFailed: {
			Scenario:    ScenarioStreamReadFailed,
			MaxAttempts: 10,
			Escalation:  EscalationAlertHuman,
			BackoffBase: 200 * time.Millisecond,
		},
		ScenarioConsumerGroupMissing: {
			Scenario:    ScenarioConsumerGroupMissing,
			MaxAttempts: 5,
			Escalation:  EscalationAlertHuman,
			BackoffBase: 100 * time.Millisecond,
		},
	}
}

// ClassifyError 将运行期错误精准映射至对应的恢复场景。
func ClassifyError(err error) FailureScenario {
	if err == nil {
		return ScenarioPoisonMessage
	}
	if IsNoGroupError(err) {
		return ScenarioConsumerGroupMissing
	}
	if IsDLQWriteError(err) {
		return ScenarioDLQWriteFailed
	}
	if reclaimstate.IsAckError(err) {
		return ScenarioAckFailed
	}
	if IsStreamReadError(err) {
		return ScenarioStreamReadFailed
	}
	return ScenarioRedisTimeout
}

// computeRecoveryBackoff 计算指数退避时长，确保任何连续错误绝不 0ms 空转打满 CPU。
func computeRecoveryBackoff(base time.Duration, attempt int, maxBackoff time.Duration) time.Duration {
	if maxBackoff <= 0 {
		maxBackoff = defaultMaxRecoveryBackoff
	}
	if base <= 0 {
		base = defaultMinRecoveryBackoff
	}
	if base > maxBackoff {
		return maxBackoff
	}
	if attempt <= 1 {
		return base
	}
	shift := attempt - 1
	if shift > 6 {
		shift = 6
	}
	backoff := base << shift
	if backoff <= 0 || backoff > maxBackoff {
		return maxBackoff
	}
	return backoff
}

// RecoveryLedgerEntry records a single recovery attempt.
type RecoveryLedgerEntry struct {
	Scenario  FailureScenario
	MessageID string
	Attempt   int
	Action    EscalationPolicy
	Timestamp time.Time
	Error     string
}

// RecoveryLedger tracks recovery attempts for observability.
type RecoveryLedger struct {
	mu      sync.Mutex
	entries []RecoveryLedgerEntry
	maxSize int
}

func NewRecoveryLedger(maxSize int) *RecoveryLedger {
	return &RecoveryLedger{
		entries: make([]RecoveryLedgerEntry, 0, maxSize),
		maxSize: maxSize,
	}
}

func (l *RecoveryLedger) Record(entry RecoveryLedgerEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) >= l.maxSize {
		// Drop oldest entry to prevent unbounded growth.
		copy(l.entries, l.entries[1:])
		l.entries = l.entries[:len(l.entries)-1]
	}
	l.entries = append(l.entries, entry)
}

func (l *RecoveryLedger) Entries() []RecoveryLedgerEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]RecoveryLedgerEntry, len(l.entries))
	copy(out, l.entries)
	return out
}

func (l *RecoveryLedger) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}
