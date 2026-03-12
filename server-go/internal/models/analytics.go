package models

import (
	"time"

	"github.com/google/uuid"
)

// StudentProfile represents a student's comprehensive learning profile
type StudentProfile struct {
	ID                   uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID            uuid.UUID `gorm:"uniqueIndex;not null" json:"student_id"`
	Student              Student   `gorm:"foreignKey:StudentID" json:"student,omitempty"`
	ExperimentCompletion float64   `json:"experiment_completion"`    // 实验完成度
	KnowledgeMastery     float64   `json:"knowledge_mastery"`        // 知识点掌握率
	LearningActivity     float64   `json:"learning_activity"`        // 学习活跃度
	ExperimentAccuracy   float64   `json:"experiment_accuracy"`      // 实验正确率
	TotalLearningHours   int       `json:"total_learning_hours"`     // 总学习时长
	OverallScore         float64   `json:"overall_score"`            // 综合评分
	Level                string    `json:"level"`                    // S, A, B, C, D
	RankInClass          *int      `json:"rank_in_class,omitempty"`  // 班级排名
	RankInGrade          *int      `json:"rank_in_grade,omitempty"`  // 年级排名
	LastUpdated          time.Time `json:"last_updated"`
}

// ClassOverview represents a class's overall statistics
type ClassOverview struct {
	ClassID                  uuid.UUID `json:"class_id"`
	ClassName                string    `json:"class_name"`
	StudentCount             int       `json:"student_count"`
	AvgExperimentCompletion  float64   `json:"avg_experiment_completion"`
	AvgKnowledgeMastery      float64   `json:"avg_knowledge_mastery"`
	AvgLearningActivity      float64   `json:"avg_learning_activity"`
	AvgExperimentAccuracy    float64   `json:"avg_experiment_accuracy"`
	OverallScore             float64   `json:"overall_score"`
	Level                    string    `json:"level"`
}

// StudentAlert represents a student who needs attention
type StudentAlert struct {
	StudentID       uuid.UUID `json:"student_id"`
	StudentNumber   string    `json:"student_number"`
	Username        string    `json:"username"`
	AlertType       string    `json:"alert_type"` // inactive, low_completion, struggling
	AlertMessage    string    `json:"alert_message"`
	Severity        string    `json:"severity"` // high, medium, low
	LastActivityAt  *time.Time `json:"last_activity_at,omitempty"`
}

// LearningTrend represents learning data over time
type LearningTrend struct {
	Date                string  `json:"date"`
	Duration            int     `json:"duration"` // minutes
	ExperimentsCompleted int    `json:"experiments_completed"`
	CoursesViewed       int     `json:"courses_viewed"`
}

func (StudentProfile) TableName() string {
	return "student_profiles"
}
