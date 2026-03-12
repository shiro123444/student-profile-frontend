package models

import (
	"time"

	"github.com/google/uuid"
)

// ── Points & Credits ──

// PointTransaction records a single points event (append-only ledger)
type PointTransaction struct {
	ID              uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID       uuid.UUID  `gorm:"not null;index" json:"student_id"`
	Amount          int        `gorm:"not null" json:"amount"` // Positive=earned, Negative=spent
	BalanceAfter    int        `gorm:"not null" json:"balance_after"`
	TransactionType string     `gorm:"not null" json:"transaction_type"`
	// Types: daily_checkin, experiment_complete, challenge_complete, mbti_test, credit_exchange, admin_grant
	ReferenceID *uuid.UUID `json:"reference_id,omitempty"`
	Description string     `json:"description,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// PointBalance holds the materialized current balance (fast reads)
type PointBalance struct {
	StudentID      uuid.UUID `gorm:"type:uuid;primary_key" json:"student_id"`
	Points         int       `gorm:"not null;default:0" json:"points"`
	Credits        float64   `gorm:"type:decimal(10,4);not null;default:0" json:"credits"` // AI usage credits (USD equivalent)
	TotalEarned    int       `gorm:"not null;default:0" json:"total_earned"`
	TotalSpent     int       `gorm:"not null;default:0" json:"total_spent"`
	StreakDays      int       `gorm:"not null;default:0" json:"streak_days"`
	LastCheckinDate *time.Time `gorm:"type:date" json:"last_checkin_date,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// DailyCheckin records a single daily check-in
type DailyCheckin struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID    uuid.UUID `gorm:"not null" json:"student_id"`
	CheckinDate  time.Time `gorm:"type:date;not null" json:"checkin_date"`
	PointsAwarded int      `gorm:"not null" json:"points_awarded"`
	StreakBonus   int       `gorm:"default:0" json:"streak_bonus"`
	CreatedAt    time.Time `json:"created_at"`
}

// AIUsageLog tracks AI agent usage for billing
type AIUsageLog struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID      uuid.UUID `gorm:"not null;index" json:"student_id"`
	AgentName      string    `json:"agent_name"`
	ModelUsed      string    `json:"model_used"`
	InputTokens    int       `json:"input_tokens"`
	OutputTokens   int       `json:"output_tokens"`
	EstimatedCost  float64   `gorm:"type:decimal(10,6)" json:"estimated_cost"`
	CreditsCharged float64   `gorm:"type:decimal(10,6)" json:"credits_charged"`
	SessionID      string    `json:"session_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// ── Agent Sessions ──

// AgentSession tracks a conversation session with an AI agent
type AgentSession struct {
	ID               uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID        uuid.UUID  `gorm:"not null;index" json:"student_id"`
	AgentName        string     `gorm:"not null" json:"agent_name"`
	ModelUsed        string     `json:"model_used,omitempty"`
	Status           string     `gorm:"default:active" json:"status"` // active, completed, error
	TotalInputTokens int        `gorm:"default:0" json:"total_input_tokens"`
	TotalOutputTokens int       `gorm:"default:0" json:"total_output_tokens"`
	TotalCostUSD     float64    `gorm:"type:decimal(10,6);default:0" json:"total_cost_usd"`
	MessageCount     int        `gorm:"default:0" json:"message_count"`
	CreditsCharged   float64    `gorm:"type:decimal(10,6);default:0" json:"credits_charged"`
	CreatedAt        time.Time  `json:"created_at"`
	EndedAt          *time.Time `json:"ended_at,omitempty"`
}

// ── Documents ──

// Document represents an uploaded teaching material
type Document struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Title      string     `gorm:"not null" json:"title"`
	Description string    `json:"description,omitempty"`
	FilePath   string     `gorm:"not null" json:"file_path"`
	FileType   string     `gorm:"not null" json:"file_type"` // pdf, docx, pptx
	FileSize   int64      `gorm:"not null" json:"file_size"`
	PageCount  int        `json:"page_count,omitempty"`
	CourseID   *uuid.UUID `json:"course_id,omitempty"`
	UploadedBy uuid.UUID  `gorm:"not null" json:"uploaded_by"`
	IsActive   bool       `gorm:"default:true" json:"is_active"`
	IsIndexed  bool       `gorm:"default:false" json:"is_indexed"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// ── Algorithm Challenges (interface only, OJ integration later) ──

// AlgorithmChallenge represents a coding challenge created by a teacher
type AlgorithmChallenge struct {
	ID              uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Title           string     `gorm:"not null" json:"title"`
	Description     string     `gorm:"not null" json:"description"`
	Difficulty      string     `gorm:"not null" json:"difficulty"` // easy, medium, hard
	Language        string     `json:"language,omitempty"`
	StarterCode     string     `json:"starter_code,omitempty"`
	TestCases       string     `gorm:"type:jsonb" json:"test_cases"` // JSON array
	TimeLimitMS     int        `gorm:"default:5000" json:"time_limit_ms"`
	MemoryLimitMB   int        `gorm:"default:256" json:"memory_limit_mb"`
	PointsReward    int        `gorm:"default:10" json:"points_reward"`
	CreatedBy       *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// ChallengeSubmission records a student's attempt at a challenge
type ChallengeSubmission struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID       uuid.UUID `gorm:"not null;index" json:"student_id"`
	ChallengeID     uuid.UUID `gorm:"not null;index" json:"challenge_id"`
	Code            string    `gorm:"not null" json:"code"`
	Language        string    `gorm:"not null" json:"language"`
	Status          string    `gorm:"not null" json:"status"` // pending, accepted, wrong_answer, etc.
	TestResults     string    `gorm:"type:jsonb" json:"test_results,omitempty"`
	ExecutionTimeMS int       `json:"execution_time_ms,omitempty"`
	PointsAwarded   int       `gorm:"default:0" json:"points_awarded"`
	SubmittedAt     time.Time `json:"submitted_at"`
}

// ── Enhanced MBTI ──

// MBTITestResult stores PsyCOT enhanced MBTI results with soft labels
type MBTITestResult struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID      uuid.UUID `gorm:"not null;index" json:"student_id"`
	TestVersion    string    `gorm:"not null" json:"test_version"` // classic, psycot_v1
	MBTICode       string    `gorm:"not null" json:"mbti_code"`
	EISoft         *float64  `gorm:"type:decimal(4,3)" json:"ei_soft,omitempty"`
	SNSoft         *float64  `gorm:"type:decimal(4,3)" json:"sn_soft,omitempty"`
	TFSoft         *float64  `gorm:"type:decimal(4,3)" json:"tf_soft,omitempty"`
	JPSoft         *float64  `gorm:"type:decimal(4,3)" json:"jp_soft,omitempty"`
	EIConf         *float64  `gorm:"type:decimal(4,3)" json:"ei_conf,omitempty"`
	SNConf         *float64  `gorm:"type:decimal(4,3)" json:"sn_conf,omitempty"`
	TFConf         *float64  `gorm:"type:decimal(4,3)" json:"tf_conf,omitempty"`
	JPConf         *float64  `gorm:"type:decimal(4,3)" json:"jp_conf,omitempty"`
	QuestionCount  int       `json:"question_count,omitempty"`
	DurationSeconds int      `json:"duration_seconds,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// ── Table Names ──

func (PointTransaction) TableName() string    { return "point_transactions" }
func (PointBalance) TableName() string         { return "point_balances" }
func (DailyCheckin) TableName() string         { return "daily_checkins" }
func (AIUsageLog) TableName() string           { return "ai_usage_log" }
func (AgentSession) TableName() string         { return "agent_sessions" }
func (Document) TableName() string             { return "documents" }
func (AlgorithmChallenge) TableName() string   { return "algorithm_challenges" }
func (ChallengeSubmission) TableName() string  { return "challenge_submissions" }
func (MBTITestResult) TableName() string       { return "mbti_test_results" }
