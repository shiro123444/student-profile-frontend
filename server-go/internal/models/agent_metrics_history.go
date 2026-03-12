package models

import "time"

// AgentRequestMetric stores per-request gateway telemetry for persisted history analysis.
type AgentRequestMetric struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Scope       string    `gorm:"size:32;not null;index" json:"scope"`
	Route       string    `gorm:"size:255;not null;index" json:"route"`
	AgentName   string    `gorm:"size:128;not null;index" json:"agent_name"`
	WorkspaceID string    `gorm:"size:128;not null;index" json:"workspace_id"`
	StatusCode  int       `gorm:"not null;index" json:"status_code"`
	LatencyMS   int64     `gorm:"not null;default:0" json:"latency_ms"`
	CreatedAt   time.Time `gorm:"index" json:"created_at"`
}

func (AgentRequestMetric) TableName() string { return "agent_request_metrics" }
