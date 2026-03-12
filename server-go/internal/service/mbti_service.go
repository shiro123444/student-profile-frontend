package service

import (
	"context"
	"fmt"

	"pathmind-server/internal/models"
	"pathmind-server/internal/repository/neo4j"
	"pathmind-server/internal/repository/redis"
	"go.uber.org/zap"
)

type MBTIService struct {
	mbtiRepo   *neo4j.MBTIRepository
	careerRepo *neo4j.CareerRepository
	pathRepo   *neo4j.LearningPathRepository
	cache      *redis.CacheRepository
	logger     *zap.Logger
}

func NewMBTIService(
	mbtiRepo *neo4j.MBTIRepository,
	careerRepo *neo4j.CareerRepository,
	pathRepo *neo4j.LearningPathRepository,
	cache *redis.CacheRepository,
	logger *zap.Logger,
) *MBTIService {
	return &MBTIService{
		mbtiRepo:   mbtiRepo,
		careerRepo: careerRepo,
		pathRepo:   pathRepo,
		cache:      cache,
		logger:     logger,
	}
}

// SubmitMBTITest processes MBTI test submission
func (s *MBTIService) SubmitMBTITest(ctx context.Context, data models.MBTISubmitData) (*models.MBTIResult, error) {
	// Calculate MBTI type from answers
	mbtiCode := s.calculateMBTIType(data.Answers)

	// Store in Neo4j
	studentID, err := s.mbtiRepo.SubmitMBTITest(ctx, data, mbtiCode)
	if err != nil {
		return nil, err
	}

	// Get dimensions
	dimensions := s.calculateDimensions(data.Answers)

	result := &models.MBTIResult{
		StudentID:  studentID,
		MBTICode:   mbtiCode,
		Dimensions: dimensions,
	}

	return result, nil
}

// GetMBTIType retrieves MBTI type information with caching
func (s *MBTIService) GetMBTIType(ctx context.Context, code string) (*models.MBTIType, error) {
	// Try cache first
	cacheKey := fmt.Sprintf(redis.MBTITypeKey, code)
	var mbtiType models.MBTIType

	err := s.cache.Get(ctx, cacheKey, &mbtiType)
	if err == nil && mbtiType.Code != "" {
		s.logger.Debug("MBTI type cache hit", zap.String("code", code))
		return &mbtiType, nil
	}

	// Cache miss, fetch from Neo4j
	mbtiTypePtr, err := s.mbtiRepo.GetMBTIType(ctx, code)
	if err != nil {
		return nil, err
	}

	// Update cache (never expire)
	_ = s.cache.Set(ctx, cacheKey, mbtiTypePtr, redis.MBTITypeExpiration)

	return mbtiTypePtr, nil
}

// GetAllMBTITypes retrieves all MBTI types
func (s *MBTIService) GetAllMBTITypes(ctx context.Context) ([]models.MBTIType, error) {
	return s.mbtiRepo.GetAllMBTITypes(ctx)
}

// GetRecommendedCareers retrieves recommended careers for an MBTI type
func (s *MBTIService) GetRecommendedCareers(ctx context.Context, mbtiCode string) ([]models.Career, error) {
	return s.careerRepo.GetRecommendedCareers(ctx, mbtiCode)
}

// GetCareerByID retrieves a specific career with caching
func (s *MBTIService) GetCareerByID(ctx context.Context, careerID string) (*models.Career, error) {
	// Try cache first
	cacheKey := fmt.Sprintf(redis.CareerKey, careerID)
	var career models.Career

	err := s.cache.Get(ctx, cacheKey, &career)
	if err == nil && career.ID != "" {
		s.logger.Debug("Career cache hit", zap.String("careerID", careerID))
		return &career, nil
	}

	// Cache miss, fetch from Neo4j
	careerPtr, err := s.careerRepo.GetCareerByID(ctx, careerID)
	if err != nil {
		return nil, err
	}

	// Update cache
	_ = s.cache.Set(ctx, cacheKey, careerPtr, redis.CareerExpiration)

	return careerPtr, nil
}

// GetLearningPathByCareer retrieves learning paths for a career
func (s *MBTIService) GetLearningPathByCareer(ctx context.Context, careerID string) ([]models.LearningPath, error) {
	return s.pathRepo.GetLearningPathByCareer(ctx, careerID)
}

// GetRecommendedLearningPath retrieves recommended learning path for a student
func (s *MBTIService) GetRecommendedLearningPath(ctx context.Context, studentID string) ([]models.LearningPath, error) {
	return s.pathRepo.GetRecommendedLearningPath(ctx, studentID)
}

// calculateMBTIType calculates MBTI type from answers
func (s *MBTIService) calculateMBTIType(answers []models.MBTIAnswer) string {
	dimensions := s.calculateDimensions(answers)

	var mbtiCode string

	// E vs I
	if dimensions.E > dimensions.I {
		mbtiCode += "E"
	} else {
		mbtiCode += "I"
	}

	// S vs N
	if dimensions.S > dimensions.N {
		mbtiCode += "S"
	} else {
		mbtiCode += "N"
	}

	// T vs F
	if dimensions.T > dimensions.F {
		mbtiCode += "T"
	} else {
		mbtiCode += "F"
	}

	// J vs P
	if dimensions.J > dimensions.P {
		mbtiCode += "J"
	} else {
		mbtiCode += "P"
	}

	return mbtiCode
}

// calculateDimensions calculates dimension scores from answers
func (s *MBTIService) calculateDimensions(answers []models.MBTIAnswer) models.MBTIDimensions {
	dimensions := models.MBTIDimensions{}

	// This is a simplified calculation
	// In a real implementation, you would map each question to its dimension
	for i, answer := range answers {
		questionID := answer.QuestionID
		choice := answer.Answer

		// Map questions to dimensions (simplified)
		switch {
		case questionID >= 1 && questionID <= 10:
			if choice == "A" {
				dimensions.E++
			} else {
				dimensions.I++
			}
		case questionID >= 11 && questionID <= 20:
			if choice == "A" {
				dimensions.S++
			} else {
				dimensions.N++
			}
		case questionID >= 21 && questionID <= 30:
			if choice == "A" {
				dimensions.T++
			} else {
				dimensions.F++
			}
		case questionID >= 31 && questionID <= 40:
			if choice == "A" {
				dimensions.J++
			} else {
				dimensions.P++
			}
		}

		// Alternate assignment for variety
		if i%4 == 0 {
			if choice == "A" {
				dimensions.E++
			} else {
				dimensions.I++
			}
		} else if i%4 == 1 {
			if choice == "A" {
				dimensions.S++
			} else {
				dimensions.N++
			}
		} else if i%4 == 2 {
			if choice == "A" {
				dimensions.T++
			} else {
				dimensions.F++
			}
		} else {
			if choice == "A" {
				dimensions.J++
			} else {
				dimensions.P++
			}
		}
	}

	return dimensions
}
