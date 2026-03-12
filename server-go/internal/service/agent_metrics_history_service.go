package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/config"
	"pathmind-server/internal/models"
)

type AgentMetricsHistoryPoint struct {
	Ts                          int64   `json:"ts"`
	RequestsTotal               int64   `json:"requests_total"`
	RateLimited429Total         int64   `json:"rate_limited_429_total"`
	UpstreamUnavailable503Total int64   `json:"upstream_unavailable_503_total"`
	Status4xx                   int64   `json:"status_4xx"`
	Status5xx                   int64   `json:"status_5xx"`
	LatencyAvgMs                float64 `json:"latency_avg_ms"`
}

type AgentMetricsHistorySummary struct {
	RequestsTotal               int64            `json:"requests_total"`
	RateLimited429Total         int64            `json:"rate_limited_429_total"`
	UpstreamUnavailable503Total int64            `json:"upstream_unavailable_503_total"`
	StatusCounts                map[string]int64 `json:"status_counts"`
	LatencyAvgMs                float64          `json:"latency_avg_ms"`
}

type AgentMetricsHistoryResponse struct {
	Enabled           bool                       `json:"enabled"`
	GeneratedAt       int64                      `json:"generated_at"`
	Scope             string                     `json:"scope"`
	WindowSec         int64                      `json:"window_sec"`
	BucketSec         int64                      `json:"bucket_sec"`
	SelectedAgent     string                     `json:"selected_agent,omitempty"`
	SelectedWorkspace string                     `json:"selected_workspace,omitempty"`
	Summary           AgentMetricsHistorySummary `json:"summary"`
	Points            []AgentMetricsHistoryPoint `json:"points"`
}

type AgentMetricsHistoryQuery struct {
	Scope       string
	AgentName   string
	WorkspaceID string
	WindowSec   int64
	BucketSec   int64
}

type agentMetricsHistoryRow struct {
	Ts                          int64   `gorm:"column:ts"`
	RequestsTotal               int64   `gorm:"column:requests_total"`
	RateLimited429Total         int64   `gorm:"column:rate_limited_429_total"`
	UpstreamUnavailable503Total int64   `gorm:"column:upstream_unavailable_503_total"`
	Status4xx                   int64   `gorm:"column:status_4xx"`
	Status5xx                   int64   `gorm:"column:status_5xx"`
	LatencyAvgMs                float64 `gorm:"column:latency_avg_ms"`
}

type AgentMetricsHistoryService struct {
	db     *gorm.DB
	logger *zap.Logger

	enabled          bool
	defaultWindowSec int64
	maxWindowSec     int64
	defaultBucketSec int64
	maxBucketSec     int64
	batchSize        int
	flushInterval    time.Duration

	queue    chan models.AgentRequestMetric
	stopCh   chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
}

func NewAgentMetricsHistoryService(
	db *gorm.DB,
	cfg config.AgentServiceConfig,
	logger *zap.Logger,
) *AgentMetricsHistoryService {
	service := &AgentMetricsHistoryService{
		db:               db,
		logger:           logger,
		enabled:          cfg.MetricsHistoryEnabled,
		defaultWindowSec: int64(maxInt(cfg.MetricsHistoryDefaultWindowSec, 60)),
		maxWindowSec:     int64(maxInt(cfg.MetricsHistoryMaxWindowSec, 3600)),
		defaultBucketSec: int64(maxInt(cfg.MetricsHistoryDefaultBucketSec, 15)),
		maxBucketSec:     int64(maxInt(cfg.MetricsHistoryMaxBucketSec, 900)),
		batchSize:        maxInt(cfg.MetricsHistoryBatchSize, 128),
		flushInterval:    time.Duration(maxInt(cfg.MetricsHistoryFlushSec, 2)) * time.Second,
		queue:            make(chan models.AgentRequestMetric, maxInt(cfg.MetricsHistoryQueueSize, 4096)),
		stopCh:           make(chan struct{}),
	}

	if service.maxWindowSec < service.defaultWindowSec {
		service.maxWindowSec = service.defaultWindowSec
	}
	if service.maxBucketSec < service.defaultBucketSec {
		service.maxBucketSec = service.defaultBucketSec
	}

	if service.enabled {
		service.wg.Add(1)
		go service.runWriter()
	}

	return service
}

func (s *AgentMetricsHistoryService) Enabled() bool {
	return s != nil && s.enabled
}

func (s *AgentMetricsHistoryService) RecordRequest(
	scope string,
	route string,
	agentName string,
	workspaceID string,
	status int,
	latency time.Duration,
) {
	if s == nil || !s.enabled {
		return
	}

	record := models.AgentRequestMetric{
		Scope:       normalizeString(scope, "unknown"),
		Route:       normalizeString(route, "unknown"),
		AgentName:   normalizeString(agentName, "unknown"),
		WorkspaceID: normalizeString(workspaceID, "default"),
		StatusCode:  status,
		LatencyMS:   maxInt64(latency.Milliseconds(), 0),
		CreatedAt:   time.Now(),
	}

	select {
	case s.queue <- record:
	default:
		s.logger.Warn("agent metrics history queue full, dropping record",
			zap.String("scope", record.Scope),
			zap.String("route", record.Route),
			zap.String("agent", record.AgentName),
		)
	}
}

func (s *AgentMetricsHistoryService) Shutdown(ctx context.Context) error {
	if s == nil || !s.enabled {
		return nil
	}

	s.stopOnce.Do(func() {
		close(s.stopCh)
	})

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *AgentMetricsHistoryService) Query(
	ctx context.Context,
	query AgentMetricsHistoryQuery,
) (AgentMetricsHistoryResponse, error) {
	if s == nil {
		return AgentMetricsHistoryResponse{
			Enabled:           false,
			GeneratedAt:       time.Now().Unix(),
			Scope:             normalizeString(query.Scope, "protected"),
			WindowSec:         query.WindowSec,
			BucketSec:         query.BucketSec,
			SelectedAgent:     strings.TrimSpace(query.AgentName),
			SelectedWorkspace: strings.TrimSpace(query.WorkspaceID),
			Summary: AgentMetricsHistorySummary{
				StatusCounts: map[string]int64{"4xx": 0, "5xx": 0},
			},
			Points: []AgentMetricsHistoryPoint{},
		}, nil
	}

	scope := normalizeString(query.Scope, "protected")
	agentName := strings.TrimSpace(query.AgentName)
	workspaceID := strings.TrimSpace(query.WorkspaceID)
	windowSec := clampRange(query.WindowSec, s.defaultWindowSec, s.maxWindowSec)
	bucketSec := clampRange(query.BucketSec, s.defaultBucketSec, s.maxBucketSec)
	if bucketSec > windowSec {
		bucketSec = windowSec
	}

	response := AgentMetricsHistoryResponse{
		Enabled:           s.Enabled(),
		GeneratedAt:       time.Now().Unix(),
		Scope:             scope,
		WindowSec:         windowSec,
		BucketSec:         bucketSec,
		SelectedAgent:     agentName,
		SelectedWorkspace: workspaceID,
		Summary: AgentMetricsHistorySummary{
			StatusCounts: map[string]int64{"4xx": 0, "5xx": 0},
		},
		Points: []AgentMetricsHistoryPoint{},
	}

	if s == nil || !s.enabled {
		return response, nil
	}

	sql := `
SELECT
	(FLOOR(EXTRACT(EPOCH FROM created_at) / ?) * ?)::bigint AS ts,
	COUNT(*) AS requests_total,
	COALESCE(SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END), 0) AS rate_limited_429_total,
	COALESCE(SUM(CASE WHEN status_code = 503 THEN 1 ELSE 0 END), 0) AS upstream_unavailable_503_total,
	COALESCE(SUM(CASE WHEN status_code BETWEEN 400 AND 499 THEN 1 ELSE 0 END), 0) AS status_4xx,
	COALESCE(SUM(CASE WHEN status_code BETWEEN 500 AND 599 THEN 1 ELSE 0 END), 0) AS status_5xx,
	COALESCE(AVG(latency_ms), 0) AS latency_avg_ms
FROM agent_request_metrics
WHERE created_at >= NOW() - (? * interval '1 second')
	AND scope = ?
`
	args := []interface{}{bucketSec, bucketSec, windowSec, scope}
	if agentName != "" {
		sql += " AND agent_name = ?\n"
		args = append(args, agentName)
	}
	if workspaceID != "" {
		sql += " AND workspace_id = ?\n"
		args = append(args, workspaceID)
	}
	sql += "GROUP BY ts ORDER BY ts ASC"

	rows := []agentMetricsHistoryRow{}
	if err := s.db.WithContext(ctx).Raw(sql, args...).Scan(&rows).Error; err != nil {
		return response, fmt.Errorf("query agent metrics history failed: %w", err)
	}

	points := make([]AgentMetricsHistoryPoint, 0, len(rows))
	var weightedLatency float64
	for _, row := range rows {
		point := AgentMetricsHistoryPoint{
			Ts:                          row.Ts,
			RequestsTotal:               row.RequestsTotal,
			RateLimited429Total:         row.RateLimited429Total,
			UpstreamUnavailable503Total: row.UpstreamUnavailable503Total,
			Status4xx:                   row.Status4xx,
			Status5xx:                   row.Status5xx,
			LatencyAvgMs:                row.LatencyAvgMs,
		}
		points = append(points, point)

		response.Summary.RequestsTotal += point.RequestsTotal
		response.Summary.RateLimited429Total += point.RateLimited429Total
		response.Summary.UpstreamUnavailable503Total += point.UpstreamUnavailable503Total
		response.Summary.StatusCounts["4xx"] += point.Status4xx
		response.Summary.StatusCounts["5xx"] += point.Status5xx
		weightedLatency += point.LatencyAvgMs * float64(point.RequestsTotal)
	}
	if response.Summary.RequestsTotal > 0 {
		response.Summary.LatencyAvgMs = weightedLatency / float64(response.Summary.RequestsTotal)
	}

	response.Points = points
	return response, nil
}

func (s *AgentMetricsHistoryService) runWriter() {
	defer s.wg.Done()

	ticker := time.NewTicker(s.flushInterval)
	defer ticker.Stop()

	batch := make([]models.AgentRequestMetric, 0, s.batchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		records := append([]models.AgentRequestMetric(nil), batch...)
		batch = batch[:0]

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err := s.db.WithContext(ctx).Create(&records).Error
		cancel()
		if err != nil {
			s.logger.Warn("failed to flush agent metrics history batch",
				zap.Int("size", len(records)),
				zap.Error(err),
			)
		}
	}

	for {
		select {
		case <-s.stopCh:
			for {
				select {
				case metric := <-s.queue:
					batch = append(batch, metric)
					if len(batch) >= s.batchSize {
						flush()
					}
				default:
					flush()
					return
				}
			}
		case metric := <-s.queue:
			batch = append(batch, metric)
			if len(batch) >= s.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func normalizeString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func maxInt(value int, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func maxInt64(value int64, fallback int64) int64 {
	if value < fallback {
		return fallback
	}
	return value
}

func clampRange(value int64, defaultValue int64, maxValue int64) int64 {
	if value <= 0 {
		return defaultValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
