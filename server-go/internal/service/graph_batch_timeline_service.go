package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

// GraphBatchTimelineQuery defines filters for graph batch timeline lookup.
type GraphBatchTimelineQuery struct {
	StudentID string
	AgentName string
	SessionID string
	Status    string
	BeforeTS  int64
	Limit     int
}

// GraphBatchTimelineService queries graph batch receipts from Postgres audit table.
type GraphBatchTimelineService struct {
	db     *gorm.DB
	logger *zap.Logger
}

// NewGraphBatchTimelineService creates a new Postgres-backed graph batch timeline service.
func NewGraphBatchTimelineService(db *gorm.DB, logger *zap.Logger) *GraphBatchTimelineService {
	if db == nil {
		return nil
	}
	return &GraphBatchTimelineService{db: db, logger: logger}
}

// List returns graph batch timeline rows from persisted audit logs.
func (s *GraphBatchTimelineService) List(
	ctx context.Context,
	query GraphBatchTimelineQuery,
) (GraphBatchFeedbackListResponse, error) {
	response := GraphBatchFeedbackListResponse{
		OK:        true,
		StudentID: strings.TrimSpace(query.StudentID),
		AgentName: strings.TrimSpace(query.AgentName),
		SessionID: strings.TrimSpace(query.SessionID),
		Status:    strings.TrimSpace(query.Status),
		Source:    "postgres",
		Items:     []GraphBatchFeedbackItem{},
	}

	if s == nil || s.db == nil {
		return response, nil
	}
	if response.StudentID == "" {
		return response, fmt.Errorf("student id required")
	}

	dbQuery := s.db.WithContext(ctx).
		Model(&models.AgentActionAudit{}).
		Where("tool = ?", "graph_batch").
		Where("student_id = ?", response.StudentID)

	if response.AgentName != "" {
		dbQuery = dbQuery.Where("agent = ?", response.AgentName)
	}
	if response.SessionID != "" {
		dbQuery = dbQuery.Where("session_id = ?", response.SessionID)
	}
	if response.Status != "" {
		dbQuery = dbQuery.Where("status = ?", response.Status)
	}
	if query.BeforeTS > 0 {
		dbQuery = dbQuery.Where("(EXTRACT(EPOCH FROM created_at) * 1000) < ?", query.BeforeTS)
	}

	safeLimit := clampGraphBatchLimit(query.Limit)
	records := []models.AgentActionAudit{}
	if err := dbQuery.Order("created_at DESC").Limit(safeLimit + 1).Find(&records).Error; err != nil {
		return response, fmt.Errorf("query graph batch timeline failed: %w", err)
	}

	hasMore := len(records) > safeLimit
	if hasMore {
		records = records[:safeLimit]
	}

	items := make([]GraphBatchFeedbackItem, 0, len(records))
	for _, record := range records {
		item := graphBatchItemFromAudit(record)
		if strings.TrimSpace(item.BatchID) == "" {
			continue
		}
		items = append(items, item)
	}

	response.Items = items
	response.Total = len(items)
	if hasMore && len(items) > 0 {
		nextBefore := deriveBatchCursor(items[len(items)-1])
		if nextBefore > 0 {
			response.NextBeforeTS = &nextBefore
		}
	}
	return response, nil
}

func clampGraphBatchLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}

func graphBatchItemFromAudit(record models.AgentActionAudit) GraphBatchFeedbackItem {
	args := parseJSONMap(record.Args)
	result := parseJSONMap(record.Result)

	batchID := getMapString(args, "batch_id")
	if batchID == "" {
		batchID = extractBatchIDFromRequestID(record.RequestID)
	}

	mode := normalizeGraphBatchMode(getMapString(args, "mode"))
	status := normalizeGraphBatchStatus(record.Status)
	total, _ := getMapInt(args, "total")
	rolledBack, _ := getMapInt(args, "rolled_back")
	rollbackFailed, _ := getMapInt(args, "rollback_failed")
	completed, _ := getMapInt(result, "completed")

	message := getMapString(result, "message")
	if message == "" {
		message = strings.TrimSpace(record.Error)
	}

	startedAt, _ := getMapInt64(result, "started_at")
	finishedAt, _ := getMapInt64(result, "finished_at")
	if finishedAt <= 0 && !record.CreatedAt.IsZero() {
		finishedAt = record.CreatedAt.UnixMilli()
	}
	if startedAt <= 0 {
		startedAt = finishedAt
	}

	return GraphBatchFeedbackItem{
		BatchID:        batchID,
		Mode:           mode,
		Status:         status,
		Completed:      completed,
		Total:          total,
		RolledBack:     rolledBack,
		RollbackFailed: rollbackFailed,
		Message:        message,
		StartedAt:      startedAt,
		FinishedAt:     finishedAt,
	}
}

func deriveBatchCursor(item GraphBatchFeedbackItem) int64 {
	if item.FinishedAt > 0 {
		return item.FinishedAt
	}
	if item.StartedAt > 0 {
		return item.StartedAt
	}
	return 0
}

func parseJSONMap(raw string) map[string]interface{} {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	parsed := map[string]interface{}{}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil
	}
	return parsed
}

func extractBatchIDFromRequestID(requestID string) string {
	parts := strings.SplitN(strings.TrimSpace(requestID), ":", 3)
	if len(parts) < 2 {
		return ""
	}
	if parts[0] != "graph_batch" {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func normalizeGraphBatchMode(raw string) string {
	switch strings.TrimSpace(raw) {
	case "all_or_nothing":
		return "all_or_nothing"
	default:
		return "best_effort"
	}
}

func normalizeGraphBatchStatus(raw string) string {
	switch strings.TrimSpace(raw) {
	case "running":
		return "running"
	case "success":
		return "success"
	case "partial":
		return "partial"
	default:
		return "failed"
	}
}

func getMapString(data map[string]interface{}, key string) string {
	if data == nil {
		return ""
	}
	raw, ok := data[key]
	if !ok || raw == nil {
		return ""
	}
	value, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func getMapInt(data map[string]interface{}, key string) (int, bool) {
	if data == nil {
		return 0, false
	}
	raw, ok := data[key]
	if !ok {
		return 0, false
	}
	value, ok := parseInt64(raw)
	return int(value), ok
}

func getMapInt64(data map[string]interface{}, key string) (int64, bool) {
	if data == nil {
		return 0, false
	}
	raw, ok := data[key]
	if !ok {
		return 0, false
	}
	return parseInt64(raw)
}

func parseInt64(raw interface{}) (int64, bool) {
	switch typed := raw.(type) {
	case int:
		return int64(typed), true
	case int8:
		return int64(typed), true
	case int16:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case uint:
		return int64(typed), true
	case uint8:
		return int64(typed), true
	case uint16:
		return int64(typed), true
	case uint32:
		return int64(typed), true
	case uint64:
		return int64(typed), true
	case float32:
		return int64(typed), true
	case float64:
		return int64(typed), true
	case json.Number:
		if value, err := typed.Int64(); err == nil {
			return value, true
		}
		if value, err := typed.Float64(); err == nil {
			return int64(value), true
		}
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, false
		}
		if value, err := strconv.ParseInt(text, 10, 64); err == nil {
			return value, true
		}
		if value, err := strconv.ParseFloat(text, 64); err == nil {
			return int64(value), true
		}
	}
	return 0, false
}
