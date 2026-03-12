package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"pathmind-server/internal/repository/postgres"
	"go.uber.org/zap"
)

type ExperimentService struct {
	expRepo     *postgres.ExperimentRepository
	studentRepo *postgres.StudentRepository
	logger      *zap.Logger
}

func NewExperimentService(
	expRepo *postgres.ExperimentRepository,
	studentRepo *postgres.StudentRepository,
	logger *zap.Logger,
) *ExperimentService {
	return &ExperimentService{
		expRepo:     expRepo,
		studentRepo: studentRepo,
		logger:      logger,
	}
}

// GetAllExperiments retrieves all experiments
func (s *ExperimentService) GetAllExperiments(ctx context.Context) ([]models.Experiment, error) {
	return s.expRepo.GetAllExperiments(ctx)
}

// GetExperimentByID retrieves an experiment by ID
func (s *ExperimentService) GetExperimentByID(ctx context.Context, id uuid.UUID) (*models.Experiment, error) {
	return s.expRepo.GetExperimentByID(ctx, id)
}

// CreateExperiment creates a new experiment
func (s *ExperimentService) CreateExperiment(ctx context.Context, experiment *models.Experiment) error {
	return s.expRepo.CreateExperiment(ctx, experiment)
}

// GetStudentExperiments retrieves all experiments for a student
func (s *ExperimentService) GetStudentExperiments(ctx context.Context, studentID uuid.UUID) ([]models.StudentExperiment, error) {
	return s.expRepo.GetStudentExperiments(ctx, studentID)
}

// StartExperiment starts an experiment for a student
func (s *ExperimentService) StartExperiment(ctx context.Context, studentID, experimentID uuid.UUID) (*models.StudentExperiment, error) {
	// Check if experiment exists
	_, err := s.expRepo.GetExperimentByID(ctx, experimentID)
	if err != nil {
		return nil, err
	}

	// Create student experiment record
	now := time.Now()
	studentExp := &models.StudentExperiment{
		StudentID:    studentID,
		ExperimentID: experimentID,
		Status:       "in_progress",
		StartedAt:    &now,
	}

	err = s.expRepo.CreateStudentExperiment(ctx, studentExp)
	if err != nil {
		return nil, err
	}

	// Create learning record
	record := &models.LearningRecord{
		StudentID:    studentID,
		ResourceType: "experiment",
		ResourceID:   experimentID,
		Action:       "start",
	}
	_ = s.expRepo.CreateLearningRecord(ctx, record)

	return studentExp, nil
}

// SubmitExperiment submits an experiment completion
func (s *ExperimentService) SubmitExperiment(ctx context.Context, id uuid.UUID, score float64, isCorrect bool) error {
	// Get student experiment
	studentExp, err := s.expRepo.GetStudentExperimentByID(ctx, id)
	if err != nil {
		return err
	}

	// Update status
	now := time.Now()
	studentExp.Status = "completed"
	studentExp.CompletedAt = &now
	studentExp.Score = &score
	studentExp.IsCorrect = &isCorrect
	studentExp.SubmissionCount++

	// Calculate duration
	if studentExp.StartedAt != nil {
		duration := int(now.Sub(*studentExp.StartedAt).Minutes())
		studentExp.Duration = &duration
	}

	err = s.expRepo.UpdateStudentExperiment(ctx, studentExp)
	if err != nil {
		return err
	}

	// Create learning record
	record := &models.LearningRecord{
		StudentID:    studentExp.StudentID,
		ResourceType: "experiment",
		ResourceID:   studentExp.ExperimentID,
		Action:       "complete",
		Duration:     studentExp.Duration,
	}
	_ = s.expRepo.CreateLearningRecord(ctx, record)

	return nil
}

// GetExperimentStatsByClass retrieves experiment statistics for a class
func (s *ExperimentService) GetExperimentStatsByClass(ctx context.Context, classID uuid.UUID) (map[string]interface{}, error) {
	return s.expRepo.GetExperimentStatsByClass(ctx, classID)
}

// RecordLearningActivity records a learning activity
func (s *ExperimentService) RecordLearningActivity(ctx context.Context, record *models.LearningRecord) error {
	return s.expRepo.CreateLearningRecord(ctx, record)
}

// GetLearningTrend retrieves learning trend data for a student
func (s *ExperimentService) GetLearningTrend(ctx context.Context, studentID uuid.UUID, days int) ([]models.LearningTrend, error) {
	records, err := s.expRepo.GetLearningRecords(ctx, studentID, days)
	if err != nil {
		return nil, err
	}

	// Group by date
	trendMap := make(map[string]*models.LearningTrend)

	for _, record := range records {
		date := record.CreatedAt.Format("2006-01-02")

		if _, exists := trendMap[date]; !exists {
			trendMap[date] = &models.LearningTrend{
				Date: date,
			}
		}

		trend := trendMap[date]

		if record.Duration != nil {
			trend.Duration += *record.Duration
		}

		if record.Action == "complete" {
			if record.ResourceType == "experiment" {
				trend.ExperimentsCompleted++
			} else if record.ResourceType == "course" {
				trend.CoursesViewed++
			}
		}
	}

	// Convert map to slice
	var trends []models.LearningTrend
	for _, trend := range trendMap {
		trends = append(trends, *trend)
	}

	return trends, nil
}
