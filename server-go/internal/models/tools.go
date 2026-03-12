package models

import (
	"time"

	"github.com/google/uuid"
)

// CustomTool represents a user-created MCP tool stored in the database
type CustomTool struct {
	ID          uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Name        string     `gorm:"uniqueIndex;not null" json:"name" binding:"required"`
	Description string     `gorm:"not null" json:"description" binding:"required"`
	Category    string     `gorm:"default:custom" json:"category"`
	Code        string     `gorm:"type:text;not null" json:"code" binding:"required"`
	InputSchema string     `gorm:"type:jsonb;not null;default:'{}'" json:"input_schema"`
	CreatedBy   uuid.UUID  `gorm:"not null;index" json:"created_by"`
	Creator     *User      `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
	IsPublic    bool       `gorm:"default:false" json:"is_public"`
	IsApproved  bool       `gorm:"default:false" json:"is_approved"`
	AllowedRoles string    `gorm:"default:'student,teacher,admin'" json:"allowed_roles"`
	Version     string     `gorm:"default:'1.0.0'" json:"version"`
	UsageCount  int        `gorm:"default:0" json:"usage_count"`
	IsActive    bool       `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// CustomSkill represents a reusable workflow (YAML-defined)
type CustomSkill struct {
	ID          uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Name        string     `gorm:"uniqueIndex;not null" json:"name" binding:"required"`
	Description string     `gorm:"not null" json:"description" binding:"required"`
	Category    string     `gorm:"default:custom" json:"category"`
	Definition  string     `gorm:"type:text;not null" json:"definition" binding:"required"` // YAML workflow
	CreatedBy   uuid.UUID  `gorm:"not null;index" json:"created_by"`
	Creator     *User      `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
	IsPublic    bool       `gorm:"default:false" json:"is_public"`
	IsApproved  bool       `gorm:"default:false" json:"is_approved"`
	AllowedRoles string    `gorm:"default:'student,teacher,admin'" json:"allowed_roles"`
	Version     string     `gorm:"default:'1.0.0'" json:"version"`
	UsageCount  int        `gorm:"default:0" json:"usage_count"`
	IsActive    bool       `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (CustomTool) TableName() string  { return "custom_tools" }
func (CustomSkill) TableName() string { return "custom_skills" }
