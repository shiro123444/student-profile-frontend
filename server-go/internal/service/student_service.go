package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"pathmind-server/internal/repository/postgres"
	"pathmind-server/internal/repository/redis"
	"go.uber.org/zap"
)

type StudentService struct {
	studentRepo *postgres.StudentRepository
	expRepo     *postgres.ExperimentRepository
	cache       *redis.CacheRepository
	logger      *zap.Logger
}

func NewStudentService(
	studentRepo *postgres.StudentRepository,
	expRepo *postgres.ExperimentRepository,
	cache *redis.CacheRepository,
	logger *zap.Logger,
) *StudentService {
	return &StudentService{
		studentRepo: studentRepo,
		expRepo:     expRepo,
		cache:       cache,
		logger:      logger,
	}
}

// GetStudentProfile retrieves a student's profile with caching
func (s *StudentService) GetStudentProfile(ctx context.Context, studentID uuid.UUID) (*models.StudentProfile, error) {
	// Try cache first
	cacheKey := fmt.Sprintf(redis.StudentProfileKey, studentID.String())
	var profile models.StudentProfile

	err := s.cache.Get(ctx, cacheKey, &profile)
	if err == nil && profile.ID != uuid.Nil {
		s.logger.Debug("Student profile cache hit", zap.String("studentID", studentID.String()))
		return &profile, nil
	}

	// Cache miss, fetch from database
	profilePtr, err := s.studentRepo.GetStudentProfile(ctx, studentID)
	if err != nil {
		return nil, err
	}

	// Update cache
	_ = s.cache.Set(ctx, cacheKey, profilePtr, redis.StudentProfileExpiration)

	return profilePtr, nil
}

// UpdateStudentProfile updates a student's profile and invalidates cache
func (s *StudentService) UpdateStudentProfile(ctx context.Context, profile *models.StudentProfile) error {
	err := s.studentRepo.UpdateStudentProfile(ctx, profile)
	if err != nil {
		return err
	}

	// Invalidate cache
	cacheKey := fmt.Sprintf(redis.StudentProfileKey, profile.StudentID.String())
	_ = s.cache.Delete(ctx, cacheKey)

	return nil
}

// CalculateStudentProfile calculates and updates a student's profile metrics
func (s *StudentService) CalculateStudentProfile(ctx context.Context, studentID uuid.UUID) error {
	// Get student experiments
	experiments, err := s.expRepo.GetStudentExperiments(ctx, studentID)
	if err != nil {
		return err
	}

	if len(experiments) == 0 {
		return nil
	}

	// Calculate metrics
	var totalExperiments, completedExperiments, correctExperiments int
	var totalScore, totalDuration float64

	for _, exp := range experiments {
		totalExperiments++
		if exp.Status == "completed" {
			completedExperiments++
			if exp.Score != nil {
				totalScore += *exp.Score
			}
			if exp.IsCorrect != nil && *exp.IsCorrect {
				correctExperiments++
			}
			if exp.Duration != nil {
				totalDuration += float64(*exp.Duration)
			}
		}
	}

	// Calculate rates
	experimentCompletion := float64(completedExperiments) / float64(totalExperiments)
	experimentAccuracy := 0.0
	if completedExperiments > 0 {
		experimentAccuracy = float64(correctExperiments) / float64(completedExperiments)
	}

	// Get learning records for activity calculation
	records, err := s.expRepo.GetLearningRecords(ctx, studentID, 30)
	if err != nil {
		return err
	}

	learningActivity := calculateLearningActivity(records)
	totalLearningHours := int(totalDuration / 60)

	// Calculate overall score (weighted average)
	overallScore := (experimentCompletion*0.3 + experimentAccuracy*0.3 + learningActivity*0.2 + (totalScore/float64(totalExperiments))*0.2)

	// Determine level
	level := "D"
	if overallScore >= 0.9 {
		level = "S"
	} else if overallScore >= 0.8 {
		level = "A"
	} else if overallScore >= 0.7 {
		level = "B"
	} else if overallScore >= 0.6 {
		level = "C"
	}

	// Update profile
	profile := &models.StudentProfile{
		StudentID:            studentID,
		ExperimentCompletion: experimentCompletion,
		KnowledgeMastery:     0.0, // TODO: Calculate from knowledge mastery table
		LearningActivity:     learningActivity,
		ExperimentAccuracy:   experimentAccuracy,
		TotalLearningHours:   totalLearningHours,
		OverallScore:         overallScore,
		Level:                level,
		LastUpdated:          time.Now(),
	}

	return s.UpdateStudentProfile(ctx, profile)
}

// GetClassOverview retrieves class overview with caching
func (s *StudentService) GetClassOverview(ctx context.Context, classID uuid.UUID) (*models.ClassOverview, error) {
	// Try cache first
	cacheKey := fmt.Sprintf(redis.ClassOverviewKey, classID.String())
	var overview models.ClassOverview

	err := s.cache.Get(ctx, cacheKey, &overview)
	if err == nil && overview.ClassID != uuid.Nil {
		s.logger.Debug("Class overview cache hit", zap.String("classID", classID.String()))
		return &overview, nil
	}

	// Cache miss, fetch from database
	overviewPtr, err := s.studentRepo.GetClassOverview(ctx, classID)
	if err != nil {
		return nil, err
	}

	// Update cache
	_ = s.cache.Set(ctx, cacheKey, overviewPtr, redis.ClassOverviewExpiration)

	return overviewPtr, nil
}

// GetStudentAlerts retrieves students who need attention
func (s *StudentService) GetStudentAlerts(ctx context.Context, classID uuid.UUID) ([]models.StudentAlert, error) {
	return s.studentRepo.GetStudentAlerts(ctx, classID)
}

// Helper function to calculate learning activity
func calculateLearningActivity(records []models.LearningRecord) float64 {
	if len(records) == 0 {
		return 0.0
	}

	// Count activities in the last 30 days
	now := time.Now()
	thirtyDaysAgo := now.AddDate(0, 0, -30)

	var recentActivities int
	for _, record := range records {
		if record.CreatedAt.After(thirtyDaysAgo) {
			recentActivities++
		}
	}

	// Normalize to 0-1 scale (assuming 30 activities in 30 days is 100%)
	activity := float64(recentActivities) / 30.0
	if activity > 1.0 {
		activity = 1.0
	}

	return activity
}
