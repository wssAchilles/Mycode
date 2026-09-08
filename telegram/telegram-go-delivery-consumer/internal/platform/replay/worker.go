package replay

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	redis "github.com/redis/go-redis/v9"

	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/dlq"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
	"github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/streamconsumer/reclaim"
)

const (
	defaultDrainLimit = 25
	maxDrainLimit     = 200
	wakeQueueSize     = 64
)

var (
	ErrInvalidReplayLimit = errors.New("replay drain limit must be between 1 and 200")
	ErrWorkerUnavailable  = errors.New("platform replay worker unavailable")
	ErrRedisUnavailable   = errors.New("platform replay redis unavailable")
)

type WorkerClient interface {
	StreamClient
	Ping(ctx context.Context) *redis.StatusCmd
	XGroupCreateMkStream(ctx context.Context, stream string, group string, start string) *redis.StatusCmd
	XReadGroup(ctx context.Context, a *redis.XReadGroupArgs) *redis.XStreamSliceCmd
	XAutoClaim(ctx context.Context, a *redis.XAutoClaimArgs) *redis.XAutoClaimCmd
	XAck(ctx context.Context, stream string, group string, ids ...string) *redis.IntCmd
	HExists(ctx context.Context, key string, field string) *redis.BoolCmd
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
}

type ReplayDispatcher interface {
	DispatchReplay(
		ctx context.Context,
		envelope buscontracts.PlatformEventEnvelope,
		attempt int,
	) (platformcontracts.DispatchResult, error)
}

type WorkerConfig struct {
	StreamKey                string
	ConsumerGroup            string
	ConsumerName             string
	ReadCount                int64
	BlockDuration            time.Duration
	PendingIdleDuration      time.Duration
	PendingClaimCount        int64
	PendingClaimInterval     time.Duration
	PendingReclaimMaxBatches int
	ReclaimCursorMode        string
	DeadLetterStreamKey      string
}

type Summary struct {
	Enabled      bool           `json:"enabled"`
	Available    bool           `json:"available"`
	StreamKey    string         `json:"streamKey"`
	CompletedKey string         `json:"completedKey"`
	Runtime      SummaryRuntime `json:"runtime"`
	LastError    string         `json:"lastError,omitempty"`
}

type SummaryRuntime struct {
	Owner         string `json:"owner"`
	Mode          string `json:"mode"`
	ConsumerGroup string `json:"consumerGroup"`
	ConsumerName  string `json:"consumerName"`
}

type DrainRequest struct {
	Limit int `json:"limit,omitempty"`
}

type DrainResult struct {
	RunID string `json:"runId"`
	Limit int    `json:"limit"`
}

type cycleRequest struct {
	limit  int
	manual bool
	runID  string
}

type Worker struct {
	client        WorkerClient
	dispatcher    ReplayDispatcher
	writer        *Writer
	deadLetter    *dlq.Writer
	logger        *log.Logger
	cfg           WorkerConfig
	streamKey     string
	completedKey  string
	consumerGroup string
	consumerName  string
	wakes         chan cycleRequest
	cursors       *reclaim.CursorTracker
	scheduler     *reclaim.Scheduler
	running       atomic.Bool
	cycleHealthy  atomic.Bool
	started       atomic.Bool
	runSequence   atomic.Uint64
	deadLetters   atomic.Int64
	stateMu       sync.RWMutex
	lastError     string
}

func NewWorker(client WorkerClient, cfg WorkerConfig, dispatcher ReplayDispatcher, logger *log.Logger) *Worker {
	cfg.StreamKey = strings.TrimSpace(cfg.StreamKey)
	cfg.ConsumerGroup = strings.TrimSpace(cfg.ConsumerGroup)
	cfg.ConsumerName = strings.TrimSpace(cfg.ConsumerName)
	cfg.DeadLetterStreamKey = strings.TrimSpace(cfg.DeadLetterStreamKey)
	if client == nil || dispatcher == nil || cfg.StreamKey == "" || cfg.ConsumerGroup == "" || cfg.ConsumerName == "" || cfg.DeadLetterStreamKey == "" {
		return nil
	}
	if cfg.ReadCount <= 0 {
		cfg.ReadCount = defaultDrainLimit
	}
	if cfg.BlockDuration <= 0 {
		cfg.BlockDuration = 2 * time.Second
	}
	if cfg.PendingIdleDuration <= 0 {
		cfg.PendingIdleDuration = time.Minute
	}
	if cfg.PendingClaimCount <= 0 {
		cfg.PendingClaimCount = cfg.ReadCount
	}
	if cfg.PendingClaimInterval <= 0 {
		cfg.PendingClaimInterval = 30 * time.Second
	}
	if cfg.PendingReclaimMaxBatches <= 0 {
		cfg.PendingReclaimMaxBatches = reclaim.DefaultMaxBatches
	}
	if cfg.ReclaimCursorMode != "restart" {
		cfg.ReclaimCursorMode = "resume"
	}

	worker := &Worker{
		client:        client,
		dispatcher:    dispatcher,
		writer:        New(client, cfg.StreamKey),
		deadLetter:    dlq.New(client, cfg.DeadLetterStreamKey),
		logger:        logger,
		cfg:           cfg,
		streamKey:     cfg.StreamKey,
		completedKey:  CompletedKey(cfg.StreamKey),
		consumerGroup: cfg.ConsumerGroup + ":platform-replay:v2",
		consumerName:  cfg.ConsumerName + ":platform-replay",
		wakes:         make(chan cycleRequest, wakeQueueSize),
		cursors:       reclaim.NewCursorTracker(),
		scheduler:     reclaim.NewScheduler(cfg.PendingClaimInterval),
	}
	worker.cycleHealthy.Store(true)
	return worker
}

func CompletedKey(streamKey string) string {
	if strings.TrimSpace(streamKey) == "" {
		return ""
	}
	return strings.TrimSpace(streamKey) + ":completed"
}

func (w *Worker) Run(ctx context.Context) error {
	if w == nil || !w.started.CompareAndSwap(false, true) {
		return ErrWorkerUnavailable
	}
	defer w.started.Store(false)
	if err := w.ping(ctx); err != nil {
		return err
	}
	if err := w.ensureGroup(ctx); err != nil {
		return err
	}

	w.running.Store(true)
	defer w.running.Store(false)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		request := cycleRequest{limit: int(w.cfg.ReadCount)}
		select {
		case request = <-w.wakes:
		default:
		}
		if err := w.runCycle(ctx, request); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			w.cycleHealthy.Store(false)
			w.recordError(err)
			if w.logger != nil {
				w.logger.Printf("platform replay cycle failed: %v", err)
			}
			if isNoGroup(err) {
				if groupErr := w.ensureGroup(ctx); groupErr != nil {
					w.recordError(groupErr)
					if w.logger != nil {
						w.logger.Printf("restore platform replay consumer group failed: %v", groupErr)
					}
				}
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(100 * time.Millisecond):
			}
			continue
		}
		w.cycleHealthy.Store(true)
	}
}

func (w *Worker) Ready(ctx context.Context) error {
	if w == nil || !w.running.Load() || !w.cycleHealthy.Load() {
		return ErrWorkerUnavailable
	}
	return w.ping(ctx)
}

func (w *Worker) BuildSummary(ctx context.Context) (Summary, error) {
	result := w.summary(false)
	if err := w.Ready(ctx); err != nil {
		return result, err
	}
	return w.summary(true), nil
}

func (w *Worker) Drain(ctx context.Context, request DrainRequest) (DrainResult, error) {
	if request.Limit < 0 || request.Limit > maxDrainLimit {
		return DrainResult{}, ErrInvalidReplayLimit
	}
	if request.Limit == 0 {
		request.Limit = defaultDrainLimit
	}
	if err := w.Ready(ctx); err != nil {
		return DrainResult{}, err
	}
	runID := fmt.Sprintf("replay-%d-%d", time.Now().UnixNano(), w.runSequence.Add(1))
	select {
	case w.wakes <- cycleRequest{limit: request.Limit, manual: true, runID: runID}:
		return DrainResult{RunID: runID, Limit: request.Limit}, nil
	default:
		return DrainResult{}, ErrWorkerUnavailable
	}
}

func (w *Worker) runCycle(ctx context.Context, request cycleRequest) error {
	limit := request.limit
	if limit <= 0 {
		limit = int(w.cfg.ReadCount)
	}
	remaining := limit
	if request.manual || w.scheduler.Due(time.Now()) {
		recorder := &cycleRecorder{worker: w}
		claimCount := w.cfg.PendingClaimCount
		maxBatches := w.cfg.PendingReclaimMaxBatches
		if request.manual {
			if claimCount > int64(limit) {
				claimCount = int64(limit)
			}
			maxBatches = 1
		}
		scanner := reclaim.Scanner{
			Client: w.client,
			Handler: func(ctx context.Context, _ string, message redis.XMessage) error {
				return w.processMessageForCycle(ctx, message, request)
			},
			Recorder: recorder,
			Cursors:  w.cursors,
			Logger:   w.logger,
			Config: reclaim.ScannerConfig{
				ConsumerGroup: w.consumerGroup,
				ConsumerName:  w.consumerName,
				MinIdle:       w.cfg.PendingIdleDuration,
				ClaimCount:    claimCount,
				MaxBatches:    maxBatches,
				CursorMode:    w.cfg.ReclaimCursorMode,
			},
		}
		if err := scanner.ScanStream(ctx, w.streamKey); err != nil {
			return err
		}
		if recorder.noGroupError != nil {
			return recorder.noGroupError
		}
		if recorder.cycleError != nil {
			return recorder.cycleError
		}
		w.scheduler.MarkRun(time.Now())
		if request.manual {
			remaining -= recorder.claimed
			if remaining <= 0 {
				return nil
			}
		}
	}

	streams, err := w.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    w.consumerGroup,
		Consumer: w.consumerName,
		Streams:  []string{w.streamKey, ">"},
		Count:    int64(remaining),
		Block:    w.cfg.BlockDuration,
		NoAck:    false,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil
		}
		return fmt.Errorf("read platform replay group: %w", err)
	}
	for _, stream := range streams {
		for _, message := range stream.Messages {
			if err := w.processMessageForCycle(ctx, message, request); err != nil {
				return fmt.Errorf("process platform replay message %s: %w", message.ID, err)
			}
		}
	}
	return nil
}

func (w *Worker) processMessage(ctx context.Context, message redis.XMessage) error {
	return w.processMessageForCycle(ctx, message, cycleRequest{})
}

func (w *Worker) processMessageForCycle(ctx context.Context, message redis.XMessage, request cycleRequest) error {
	entry, err := decodeReplayEntry(message)
	if err != nil {
		if writeErr := w.deadLetter.Write(ctx, message, err.Error()); writeErr != nil {
			return fmt.Errorf("dead-letter malformed platform replay entry %s: %w", message.ID, writeErr)
		}
		w.deadLetters.Add(1)
		return w.ack(ctx, message.ID)
	}
	completionField := entry.Envelope.Topic + ":" + entry.Envelope.EventID
	completed, err := w.client.HExists(ctx, w.completedKey, completionField).Result()
	if err != nil {
		return fmt.Errorf("read replay completion for %s: %w", entry.Envelope.EventID, err)
	}
	if completed {
		return w.ack(ctx, message.ID)
	}

	attempt := entry.Attempt + 1
	result, err := w.dispatcher.DispatchReplay(ctx, entry.Envelope, attempt)
	if err != nil {
		return fmt.Errorf("dispatch replay side effect for %s: %w", entry.Envelope.EventID, err)
	}
	result.Topic = entry.Envelope.Topic
	result.PartitionKey = entry.Envelope.PartitionKey
	result.Attempt = attempt
	result.ReplayKind = platformcontracts.ReplayKindAutomaticFallback
	if request.manual {
		result.ReplayKind = platformcontracts.ReplayKindManualDrain
	}
	result.LagMillis = entry.LagMillis
	result.Status = platformcontracts.ReplayStatusForResult(result)
	if result.Status != platformcontracts.ReplayStatusCompleted {
		return fmt.Errorf("dispatch replay side effect for %s incomplete: %s", entry.Envelope.EventID, result.Status)
	}
	if _, err := w.writer.WriteWithRunID(ctx, entry.Envelope, result, request.runID); err != nil {
		return fmt.Errorf("append replay audit for %s: %w", entry.Envelope.EventID, err)
	}
	if err := w.client.HSet(ctx, w.completedKey, completionField, platformcontracts.ReplayStatusCompleted).Err(); err != nil {
		return fmt.Errorf("persist replay completion for %s: %w", entry.Envelope.EventID, err)
	}
	return w.ack(ctx, message.ID)
}

func (w *Worker) ack(ctx context.Context, messageID string) error {
	if err := w.client.XAck(ctx, w.streamKey, w.consumerGroup, messageID).Err(); err != nil {
		return reclaim.NewAckError(w.streamKey, messageID, err)
	}
	return nil
}

func (w *Worker) ping(ctx context.Context) error {
	if err := w.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("%w: %v", ErrRedisUnavailable, err)
	}
	return nil
}

func (w *Worker) ensureGroup(ctx context.Context) error {
	err := w.client.XGroupCreateMkStream(ctx, w.streamKey, w.consumerGroup, "0").Err()
	if err == nil || strings.Contains(err.Error(), "BUSYGROUP") {
		return nil
	}
	return fmt.Errorf("%w: create replay consumer group: %v", ErrRedisUnavailable, err)
}

func isNoGroup(err error) bool {
	return err != nil && strings.Contains(strings.ToUpper(err.Error()), "NOGROUP")
}

func (w *Worker) recordError(err error) {
	if err == nil {
		return
	}
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	w.lastError = err.Error()
}

func (w *Worker) summary(available bool) Summary {
	if w == nil {
		return Summary{Runtime: SummaryRuntime{Owner: "go", Mode: "continuous"}}
	}
	w.stateMu.RLock()
	defer w.stateMu.RUnlock()
	return Summary{
		Enabled:      true,
		Available:    available,
		StreamKey:    w.streamKey,
		CompletedKey: w.completedKey,
		Runtime: SummaryRuntime{
			Owner:         "go",
			Mode:          "continuous",
			ConsumerGroup: w.consumerGroup,
			ConsumerName:  w.consumerName,
		},
		LastError: w.lastError,
	}
}

type replayEntry struct {
	Attempt   int
	LagMillis int64
	Envelope  buscontracts.PlatformEventEnvelope
}

func decodeReplayEntry(message redis.XMessage) (replayEntry, error) {
	envelope, err := buscontracts.DecodePlatformEnvelope(message)
	if err != nil {
		return replayEntry{}, fmt.Errorf("decode platform replay entry %s: %w", message.ID, err)
	}
	attempt := readIntValue(message.Values, "attempt")
	if attempt <= 0 {
		attempt = 1
	}
	return replayEntry{
		Attempt:   attempt,
		LagMillis: readInt64Value(message.Values, "lag_ms"),
		Envelope:  envelope,
	}, nil
}

func readStringValue(values map[string]interface{}, key string) string {
	raw, exists := values[key]
	if !exists || raw == nil {
		return ""
	}
	switch typed := raw.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		return fmt.Sprint(typed)
	}
}

func readIntValue(values map[string]interface{}, key string) int {
	value, _ := strconv.Atoi(readStringValue(values, key))
	return value
}

func readInt64Value(values map[string]interface{}, key string) int64 {
	value, _ := strconv.ParseInt(readStringValue(values, key), 10, 64)
	return value
}

type cycleRecorder struct {
	worker       *Worker
	claimed      int
	noGroupError error
	cycleError   error
}

func (r *cycleRecorder) DeadLetterCount() int { return int(r.worker.deadLetters.Load()) }

func (r *cycleRecorder) RecordError(message string) {
	err := errors.New(message)
	if isNoGroup(err) {
		r.noGroupError = err
	} else if r.cycleError == nil {
		r.cycleError = err
	}
	r.worker.recordError(err)
}

func (r *cycleRecorder) RecordPendingReclaimDuration(
	_ string,
	claimed int,
	_ int,
	_ int,
	_ string,
	_ time.Duration,
) {
	r.claimed += claimed
}
