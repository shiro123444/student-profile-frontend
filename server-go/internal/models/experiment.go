package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// Experiment represents a learning experiment/assignment
type Experiment struct {
	ID                 uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Title              string         `gorm:"not null" json:"title" binding:"required"`
	Description        string         `json:"description"`
	Difficulty         string         `json:"difficulty"` // beginner, intermediate, advanced
	EstimatedDuration  int            `json:"estimated_duration"` // in minutes
	KnowledgePointIDs  pq.StringArray `gorm:"type:text[]" json:"knowledge_point_ids"`
	CreatedAt          time.Time      `json:"created_at"`
}

// StudentExperiment represents a student's experiment record
type StudentExperiment struct {
	ID              uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID       uuid.UUID  `gorm:"not null" json:"student_id"`
	Student         Student    `gorm:"foreignKey:StudentID" json:"student,omitempty"`
	ExperimentID    uuid.UUID  `gorm:"not null" json:"experiment_id"`
	Experiment      Experiment `gorm:"foreignKey:ExperimentID" json:"experiment,omitempty"`
	Status          string     `json:"status"` // not_started, in_progress, completed
	Score           *float64   `json:"score,omitempty"`
	IsCorrect       *bool      `json:"is_correct,omitempty"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	Duration        *int       `json:"duration,omitempty"` // actual time spent in minutes
	SubmissionCount int        `gorm:"default:0" json:"submission_count"`
	CreatedAt       time.Time  `json:"created_at"`
}

// LearningRecord represents a student's learning activity
type LearningRecord struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID    uuid.UUID `gorm:"not null" json:"student_id"`
	Student      Student   `gorm:"foreignKey:StudentID" json:"student,omitempty"`
	ResourceType string    `json:"resource_type"` // course, experiment, material, video
	ResourceID   uuid.UUID `json:"resource_id"`
	Action       string    `json:"action"` // view, start, complete, pause, resume
	Duration     *int      `json:"duration,omitempty"` // in minutes
	CreatedAt    time.Time `json:"created_at"`
}

func (Experiment) TableName() string {
	return "experiments"
}

func (StudentExperiment) TableName() string {
	return "student_experiments"
}

func (LearningRecord) TableName() string {
	return "learning_records"
}
