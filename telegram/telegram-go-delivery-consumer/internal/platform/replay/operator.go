package replay

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	redis "github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	buscontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/contracts"
	platformcontracts "github.com/wssachilles/mycode/telegram-go-delivery-consumer/internal/platform/contracts"
)

const (
	SingleTopicDrainConcurrency = 1
	CrossTopicDrainConcurrency  = 3
	defaultDrainLimit           = 25
	maxDrainLimit               = 200
)

var ErrUnsupportedReplayStatus = errors.New("unsupported replay status")

type OperatorClient interface {
	StreamClient
	XRange(ctx context.Context, stream string, start string, stop string) *redis.XMessageSliceCmd
	HExists(ctx context.Context, key string, field string) *redis.BoolCmd
	HKeys(ctx context.Context, key string) *redis.StringSliceCmd
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
}

type ReplayDispatcher interface {
	DispatchReplay(
		ctx context.Context,
		envelope buscontracts.PlatformEventEnvelope,
		attempt int,
	) (platformcontracts.DispatchResult, error)
}

type Summary struct {
	Available    bool                    `json:"available"`
	StreamKey    string                  `json:"streamKey"`
	CompletedKey string                  `json:"completedKey"`
	Runtime      SummaryRuntime          `json:"runtime"`
	Totals       SummaryTotals           `json:"totals"`
	Topics       map[string]TopicSummary `json:"topics"`
}

type SummaryRuntime struct {
	Owner                       string `json:"owner"`
	SingleTopicDrainConcurrency int    `json:"singleTopicDrainConcurrency"`
	CrossTopicDrainConcurrency  int    `json:"crossTopicDrainConcurrency"`
}

type SummaryTotals struct {
	Backlog       int            `json:"backlog"`
	CompletedKeys int            `json:"completedKeys"`
	StatusCounts  map[string]int `json:"statusCounts"`
}

type TopicSummary struct {
	Backlog        int            `json:"backlog"`
	StatusCounts   map[string]int `json:"statusCounts"`
	LastErrorClass string         `json:"lastErrorClass,omitempty"`
	LastAttempt    int            `json:"lastAttempt,omitempty"`
	MaxAttempt     int            `json:"maxAttempt,omitempty"`
	LastLagMillis  int64          `json:"lastLagMillis,omitempty"`
	TopicLagMillis int64          `json:"topicLagMillis,omitempty"`
	LastRecordedAt string         `json:"lastRecordedAt,omitempty"`
	LastEventID    string         `json:"lastEventId,omitempty"`
	LastStatus     string         `json:"lastStatus,omitempty"`
}

type DrainRequest struct {
	Topic  string `json:"topic"`
	Status string `json:"status,omitempty"`
	Limit  int    `json:"limit"`
}

type DrainResult struct {
	StreamKey        string                     `json:"streamKey"`
	CompletedKey     string                     `json:"completedKey"`
	RequestedTopic   string                     `json:"requestedTopic,omitempty"`
	RequestedStatus  string                     `json:"requestedStatus,omitempty"`
	Limit            int                        `json:"limit"`
	Attempted        int                        `json:"attempted"`
	Completed        int                        `json:"completed"`
	Replayed         int                        `json:"replayed"`
	SkippedCompleted int                        `json:"skippedCompleted"`
	Errors           []string                   `json:"errors,omitempty"`
	Topics           map[string]DrainTopicStats `json:"topics"`
}

type DrainTopicStats struct {
	Attempted        int    `json:"attempted"`
	Completed        int    `json:"completed"`
	Replayed         int    `json:"replayed"`
	SkippedCompleted int    `json:"skippedCompleted"`
	LastErrorClass   string `json:"lastErrorClass,omitempty"`
	LastAttempt      int    `json:"lastAttempt,omitempty"`
	LastLagMillis    int64  `json:"lastLagMillis,omitempty"`
}

type Operator struct {
	client       OperatorClient
	streamKey    string
	completedKey string
	dispatcher   ReplayDispatcher
	writer       *Writer
}

type replayEntry struct {
	StreamID     string
	Topic        string
	EventID      string
	Status       string
	Reason       string
	Channel      string
	LagMillis    int64
	Attempt      int
	ReplayKind   string
	PartitionKey string
	RecordedAt   string
	Envelope     buscontracts.PlatformEventEnvelope
}

func NewOperator(client OperatorClient, streamKey string, dispatcher ReplayDispatcher) *Operator {
	if client == nil || strings.TrimSpace(streamKey) == "" || dispatcher == nil {
		return nil
	}
	return &Operator{
		client:       client,
		streamKey:    strings.TrimSpace(streamKey),
		completedKey: CompletedKey(strings.TrimSpace(streamKey)),
		dispatcher:   dispatcher,
		writer:       New(client, strings.TrimSpace(streamKey)),
	}
}

func CompletedKey(streamKey string) string {
	if strings.TrimSpace(streamKey) == "" {
		return ""
	}
	return strings.TrimSpace(streamKey) + ":completed"
}

func (o *Operator) BuildSummary(ctx context.Context) (Summary, error) {
	result := Summary{
		Available:    o != nil && o.client != nil && o.dispatcher != nil && o.writer != nil,
		StreamKey:    "",
		CompletedKey: "",
		Runtime: SummaryRuntime{
			Owner:                       "go",
			SingleTopicDrainConcurrency: SingleTopicDrainConcurrency,
			CrossTopicDrainConcurrency:  CrossTopicDrainConcurrency,
		},
		Totals: SummaryTotals{
			StatusCounts: map[string]int{},
		},
		Topics: map[string]TopicSummary{},
	}
	if o == nil || o.client == nil || o.dispatcher == nil || o.writer == nil {
		return result, nil
	}

	result.StreamKey = o.streamKey
	result.CompletedKey = o.completedKey

	completedSet, err := o.loadCompletedSet(ctx)
	if err != nil {
		return Summary{}, err
	}
	entries, err := o.loadLatestEntries(ctx)
	if err != nil {
		return Summary{}, err
	}

	result.Totals.CompletedKeys = len(completedSet)
	for _, entry := range entries {
		status := effectiveStatus(entry, completedSet)
		topic := result.Topics[entry.Topic]
		if topic.StatusCounts == nil {
			topic.StatusCounts = map[string]int{}
		}
		topic.StatusCounts[status] += 1
		result.Totals.StatusCounts[status] += 1
		if status != platformcontracts.ReplayStatusCompleted {
			topic.Backlog += 1
			result.Totals.Backlog += 1
		}
		if entry.Reason != "" {
			topic.LastErrorClass = entry.Reason
		}
		topic.LastAttempt = entry.Attempt
		if entry.Attempt > topic.MaxAttempt {
			topic.MaxAttempt = entry.Attempt
		}
		topic.LastLagMillis = entry.LagMillis
		if entry.LagMillis > topic.TopicLagMillis {
			topic.TopicLagMillis = entry.LagMillis
		}
		topic.LastRecordedAt = entry.RecordedAt
		topic.LastEventID = entry.EventID
		topic.LastStatus = status
		result.Topics[entry.Topic] = topic
	}

	return result, nil
}

func (o *Operator) Drain(ctx context.Context, request DrainRequest) (DrainResult, error) {
	normalizedStatus, err := normalizeRequestedStatus(request.Status)
	if err != nil {
		return DrainResult{}, err
	}
	if request.Limit <= 0 {
		request.Limit = defaultDrainLimit
	}
	if request.Limit > maxDrainLimit {
		request.Limit = maxDrainLimit
	}

	result := DrainResult{
		StreamKey:       "",
		CompletedKey:    "",
		RequestedTopic:  strings.TrimSpace(request.Topic),
		RequestedStatus: normalizedStatus,
		Limit:           request.Limit,
		Topics:          map[string]DrainTopicStats{},
	}
	if o == nil || o.client == nil || o.dispatcher == nil || o.writer == nil {
		return result, fmt.Errorf("platform replay operator unavailable")
	}
	result.StreamKey = o.streamKey
	result.CompletedKey = o.completedKey

	completedSet, err := o.loadCompletedSet(ctx)
	if err != nil {
		return DrainResult{}, err
	}
	entries, err := o.loadLatestEntries(ctx)
	if err != nil {
		return DrainResult{}, err
	}

	filtered := make([]replayEntry, 0, len(entries))
	for _, entry := range entries {
		status := effectiveStatus(entry, completedSet)
		if request.Topic != "" && entry.Topic != request.Topic {
			continue
		}
		if status == platformcontracts.ReplayStatusCompleted {
			continue
		}
		if normalizedStatus != "" && status != normalizedStatus {
			continue
		}
		filtered = append(filtered, entry)
	}
	if len(filtered) > request.Limit {
		filtered = filtered[:request.Limit]
	}
	if len(filtered) == 0 {
		return result, nil
	}

	if request.Topic != "" {
		partial := o.drainEntries(ctx, filtered, completedSet)
		mergeDrainResult(&result, partial)
		return result, nil
	}

	grouped := make(map[string][]replayEntry)
	for _, entry := range filtered {
		grouped[entry.Topic] = append(grouped[entry.Topic], entry)
	}

	var mu sync.Mutex
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(CrossTopicDrainConcurrency)
	for topic, topicEntries := range grouped {
		topic := topic
		topicEntries := topicEntries
		group.Go(func() error {
			partial := o.drainEntries(groupCtx, topicEntries, completedSet)
			mu.Lock()
			defer mu.Unlock()
			if _, exists := result.Topics[topic]; !exists {
				result.Topics[topic] = DrainTopicStats{}
			}
			mergeDrainResult(&result, partial)
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return DrainResult{}, err
	}

	return result, nil
}

func (o *Operator) drainEntries(
	ctx context.Context,
	entries []replayEntry,
	completedSet map[string]struct{},
) DrainResult {
	result := DrainResult{
		StreamKey:    o.streamKey,
		CompletedKey: o.completedKey,
		Topics:       map[string]DrainTopicStats{},
	}

	for _, entry := range entries {
		key := entry.idempotencyKey()
		if _, exists := completedSet[key]; exists || entry.Status == platformcontracts.ReplayStatusCompleted {
			result.SkippedCompleted += 1
			updateTopicDrainStats(&result, entry.Topic, func(stats *DrainTopicStats) {
				stats.SkippedCompleted += 1
				stats.LastAttempt = entry.Attempt
				stats.LastLagMillis = entry.LagMillis
			})
			continue
		}

		attempt := entry.Attempt + 1
		dispatchResult, dispatchErr := o.dispatcher.DispatchReplay(ctx, entry.Envelope, attempt)
		dispatchResult.Topic = entry.Topic
		dispatchResult.PartitionKey = entry.PartitionKey
		dispatchResult.Attempt = attempt
		dispatchResult.ReplayKind = platformcontracts.ReplayKindManualDrain
		dispatchResult.LagMillis = entry.LagMillis
		if dispatchResult.Status == "" {
			dispatchResult.Status = platformcontracts.ReplayStatusForResult(dispatchResult)
		}
		if dispatchErr != nil {
			dispatchResult.Failed = true
			if dispatchResult.Reason == "" {
				dispatchResult.Reason = dispatchErr.Error()
			}
			dispatchResult.Status = platformcontracts.ReplayStatusReplayed
		}
		if dispatchResult.Status == "" {
			dispatchResult.Status = platformcontracts.ReplayStatusReplayed
		}

		result.Attempted += 1
		updateTopicDrainStats(&result, entry.Topic, func(stats *DrainTopicStats) {
			stats.Attempted += 1
			stats.LastAttempt = attempt
			stats.LastLagMillis = entry.LagMillis
			stats.LastErrorClass = dispatchResult.Reason
		})

		if _, err := o.writer.Write(ctx, entry.Envelope, dispatchResult); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s/%s write_failed: %v", entry.Topic, entry.EventID, err))
			updateTopicDrainStats(&result, entry.Topic, func(stats *DrainTopicStats) {
				stats.LastErrorClass = "replay_write_failed"
				stats.LastAttempt = attempt
				stats.LastLagMillis = entry.LagMillis
			})
			continue
		}

		if dispatchResult.Status == platformcontracts.ReplayStatusCompleted {
			if err := o.client.HSet(ctx, o.completedKey, key, time.Now().UTC().Format(time.RFC3339Nano)).Err(); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s/%s completed_key_write_failed: %v", entry.Topic, entry.EventID, err))
				updateTopicDrainStats(&result, entry.Topic, func(stats *DrainTopicStats) {
					stats.LastErrorClass = "completed_key_write_failed"
					stats.LastAttempt = attempt
					stats.LastLagMillis = entry.LagMillis
				})
				continue
			}
		}
		switch dispatchResult.Status {
		case platformcontracts.ReplayStatusCompleted:
			result.Completed += 1
			updateTopicDrainStats(&result, entry.Topic, func(stats *DrainTopicStats) {
				stats.Completed += 1
			})
		default:
			result.Replayed += 1
			updateTopicDrainStats(&result, entry.Topic, func(stats *DrainTopicStats) {
				stats.Replayed += 1
			})
		}
	}

	return result
}

func (o *Operator) loadCompletedSet(ctx context.Context) (map[string]struct{}, error) {
	keys, err := o.client.HKeys(ctx, o.completedKey).Result()
	if err != nil {
		return nil, fmt.Errorf("read platform replay completed keys: %w", err)
	}
	result := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		result[strings.TrimSpace(key)] = struct{}{}
	}
	return result, nil
}

func (o *Operator) loadLatestEntries(ctx context.Context) ([]replayEntry, error) {
	messages, err := o.client.XRange(ctx, o.streamKey, "-", "+").Result()
	if err != nil {
		return nil, fmt.Errorf("read platform replay stream: %w", err)
	}
	latest := make(map[string]replayEntry, len(messages))
	for _, message := range messages {
		entry, err := decodeReplayEntry(message)
		if err != nil {
			return nil, err
		}
		latest[entry.idempotencyKey()] = entry
	}

	result := make([]replayEntry, 0, len(latest))
	for _, entry := range latest {
		result = append(result, entry)
	}
	sort.Slice(result, func(i int, j int) bool {
		return compareStreamIDs(result[i].StreamID, result[j].StreamID) < 0
	})
	return result, nil
}

func decodeReplayEntry(message redis.XMessage) (replayEntry, error) {
	envelope, err := buscontracts.DecodePlatformEnvelope(message)
	if err != nil {
		return replayEntry{}, fmt.Errorf("decode platform replay entry %s: %w", message.ID, err)
	}
	entry := replayEntry{
		StreamID:     message.ID,
		Topic:        envelope.Topic,
		EventID:      envelope.EventID,
		Status:       readStringValue(message.Values, "status"),
		Reason:       readStringValue(message.Values, "reason"),
		Channel:      readStringValue(message.Values, "channel"),
		LagMillis:    readInt64Value(message.Values, "lag_ms"),
		Attempt:      readIntValue(message.Values, "attempt"),
		ReplayKind:   readStringValue(message.Values, "replay_kind"),
		PartitionKey: readStringValue(message.Values, "partitionKey"),
		RecordedAt:   readStringValue(message.Values, "recorded_at"),
		Envelope:     envelope,
	}
	if entry.Attempt <= 0 {
		entry.Attempt = 1
	}
	if entry.Status == "" {
		entry.Status = platformcontracts.ReplayStatusFailed
	}
	if entry.PartitionKey == "" {
		entry.PartitionKey = envelope.PartitionKey
	}
	return entry, nil
}

func effectiveStatus(entry replayEntry, completedSet map[string]struct{}) string {
	if entry.Status == platformcontracts.ReplayStatusCompleted {
		return platformcontracts.ReplayStatusCompleted
	}
	if _, exists := completedSet[entry.idempotencyKey()]; exists {
		return platformcontracts.ReplayStatusCompleted
	}
	return entry.Status
}

func normalizeRequestedStatus(value string) (string, error) {
	status := strings.TrimSpace(strings.ToLower(value))
	switch status {
	case "":
		return "", nil
	case platformcontracts.ReplayStatusShadowed,
		platformcontracts.ReplayStatusFallback,
		platformcontracts.ReplayStatusFailed,
		platformcontracts.ReplayStatusReplayed,
		platformcontracts.ReplayStatusCompleted:
		return status, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrUnsupportedReplayStatus, value)
	}
}

func mergeDrainResult(target *DrainResult, partial DrainResult) {
	target.Attempted += partial.Attempted
	target.Completed += partial.Completed
	target.Replayed += partial.Replayed
	target.SkippedCompleted += partial.SkippedCompleted
	target.Errors = append(target.Errors, partial.Errors...)
	if target.Topics == nil {
		target.Topics = map[string]DrainTopicStats{}
	}
	for topic, stats := range partial.Topics {
		existing := target.Topics[topic]
		existing.Attempted += stats.Attempted
		existing.Completed += stats.Completed
		existing.Replayed += stats.Replayed
		existing.SkippedCompleted += stats.SkippedCompleted
		if stats.LastErrorClass != "" {
			existing.LastErrorClass = stats.LastErrorClass
		}
		if stats.LastAttempt > existing.LastAttempt {
			existing.LastAttempt = stats.LastAttempt
		}
		if stats.LastLagMillis > 0 {
			existing.LastLagMillis = stats.LastLagMillis
		}
		target.Topics[topic] = existing
	}
}

func updateTopicDrainStats(result *DrainResult, topic string, update func(stats *DrainTopicStats)) {
	stats := result.Topics[topic]
	update(&stats)
	result.Topics[topic] = stats
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

func compareStreamIDs(left string, right string) int {
	leftMs, leftSeq := splitStreamID(left)
	rightMs, rightSeq := splitStreamID(right)
	switch {
	case leftMs < rightMs:
		return -1
	case leftMs > rightMs:
		return 1
	case leftSeq < rightSeq:
		return -1
	case leftSeq > rightSeq:
		return 1
	default:
		return 0
	}
}

func splitStreamID(value string) (int64, int64) {
	parts := strings.SplitN(strings.TrimSpace(value), "-", 2)
	if len(parts) != 2 {
		return 0, 0
	}
	ms, _ := strconv.ParseInt(parts[0], 10, 64)
	seq, _ := strconv.ParseInt(parts[1], 10, 64)
	return ms, seq
}

func (e replayEntry) idempotencyKey() string {
	return e.Topic + ":" + e.EventID
}
