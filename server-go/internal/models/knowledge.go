package models

import (
	"time"

	"github.com/google/uuid"
)

// KnowledgePoint represents a knowledge point/concept
type KnowledgePoint struct {
	ID          uuid.UUID       `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Name        string          `gorm:"not null" json:"name" binding:"required"`
	Category    string          `json:"category"`
	Level       string          `json:"level"` // beginner, intermediate, advanced
	ParentID    *uuid.UUID      `json:"parent_id,omitempty"`
	Parent      *KnowledgePoint `gorm:"foreignKey:ParentID" json:"parent,omitempty"`
	Description string          `json:"description"`
	CreatedAt   time.Time       `json:"created_at"`
}

// StudentKnowledgeMastery represents a student's mastery level of a knowledge point
type StudentKnowledgeMastery struct {
	ID                uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID         uuid.UUID      `gorm:"not null" json:"student_id"`
	Student           Student        `gorm:"foreignKey:StudentID" json:"student,omitempty"`
	KnowledgePointID  uuid.UUID      `gorm:"not null" json:"knowledge_point_id"`
	KnowledgePoint    KnowledgePoint `gorm:"foreignKey:KnowledgePointID" json:"knowledge_point,omitempty"`
	MasteryLevel      float64        `json:"mastery_level"` // 0.00 - 1.00
	LastPracticedAt   *time.Time     `json:"last_practiced_at,omitempty"`
	PracticeCount     int            `gorm:"default:0" json:"practice_count"`
	CreatedAt         time.Time      `json:"created_at"`
}

func (KnowledgePoint) TableName() string {
	return "knowledge_points"
}

func (StudentKnowledgeMastery) TableName() string {
	return "student_knowledge_mastery"
}
