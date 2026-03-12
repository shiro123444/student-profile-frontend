package models

import "time"

// AgentActionAudit stores high-risk agent action audit trail.
type AgentActionAudit struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	RequestID  string    `gorm:"size:128;not null;index" json:"request_id"`
	SessionID  string    `gorm:"size:128;index" json:"session_id,omitempty"`
	StudentID  string    `gorm:"size:128;index" json:"student_id,omitempty"`
	Agent      string    `gorm:"size:128;index" json:"agent"`
	Engine     string    `gorm:"size:64;index" json:"engine"`
	Mode       string    `gorm:"size:64" json:"mode,omitempty"`
	Tool       string    `gorm:"size:128;index" json:"tool"`
	Risk       string    `gorm:"size:32" json:"risk"`
	Approved   bool      `gorm:"not null;default:false" json:"approved"`
	Status     string    `gorm:"size:64;index" json:"status"`
	Args       string    `gorm:"type:jsonb" json:"args,omitempty"`
	Result     string    `gorm:"type:jsonb" json:"result,omitempty"`
	Error      string    `gorm:"type:text" json:"error,omitempty"`
	DurationMS int       `gorm:"not null;default:0" json:"duration_ms"`
	CreatedAt  time.Time `json:"created_at"`
}

func (AgentActionAudit) TableName() string { return "agent_action_audit" }
