package neo4j

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
)

type LearningPathRepository struct {
	driver neo4j.DriverWithContext
	logger *zap.Logger
}

func NewLearningPathRepository(driver neo4j.DriverWithContext, logger *zap.Logger) *LearningPathRepository {
	return &LearningPathRepository{
		driver: driver,
		logger: logger,
	}
}

// GetLearningPathByCareer retrieves learning paths for a specific career
func (r *LearningPathRepository) GetLearningPathByCareer(ctx context.Context, careerID string) ([]models.LearningPath, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (c:Career {id: $careerID})<-[:TARGETS]-(lp:LearningPath)
			OPTIONAL MATCH (lp)-[:INCLUDES]->(course:Course)
			RETURN lp.id as id, lp.name as name, lp.description as description,
			       lp.estimatedDuration as estimatedDuration,
			       c.name as targetCareer,
			       collect(DISTINCT {
			           id: course.id,
			           name: course.name,
			           provider: course.provider,
			           duration: course.duration,
			           difficulty: course.difficulty,
			           rating: course.rating
			       }) as courses
			ORDER BY lp.name
		`

		params := map[string]interface{}{"careerID": careerID}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		var paths []models.LearningPath
		for result.Next(ctx) {
			record := result.Record()

			path := models.LearningPath{
				ID:                getString(record, "id"),
				Name:              getString(record, "name"),
				Description:       getString(record, "description"),
				TargetCareer:      getString(record, "targetCareer"),
				EstimatedDuration: getString(record, "estimatedDuration"),
				Courses:           r.parseCourses(record, "courses"),
			}

			paths = append(paths, path)
		}

		return paths, nil
	})

	if err != nil {
		r.logger.Error("Failed to get learning paths by career", zap.String("careerID", careerID), zap.Error(err))
		return nil, err
	}

	return result.([]models.LearningPath), nil
}

// GetLearningPathByID retrieves a specific learning path
func (r *LearningPathRepository) GetLearningPathByID(ctx context.Context, pathID string) (*models.LearningPath, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (lp:LearningPath {id: $pathID})
			OPTIONAL MATCH (lp)-[:TARGETS]->(c:Career)
			OPTIONAL MATCH (lp)-[:INCLUDES]->(course:Course)
			OPTIONAL MATCH (course)-[:TEACHES]->(s:Skill)
			RETURN lp.id as id, lp.name as name, lp.description as description,
			       lp.estimatedDuration as estimatedDuration,
			       c.name as targetCareer,
			       collect(DISTINCT {
			           id: course.id,
			           name: course.name,
			           provider: course.provider,
			           duration: course.duration,
			           difficulty: course.difficulty,
			           rating: course.rating,
			           skills: collect(DISTINCT s.name)
			       }) as courses
		`

		params := map[string]interface{}{"pathID": pathID}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()

			path := &models.LearningPath{
				ID:                getString(record, "id"),
				Name:              getString(record, "name"),
				Description:       getString(record, "description"),
				TargetCareer:      getString(record, "targetCareer"),
				EstimatedDuration: getString(record, "estimatedDuration"),
				Courses:           r.parseCourses(record, "courses"),
			}

			return path, nil
		}

		return nil, fmt.Errorf("learning path not found: %s", pathID)
	})

	if err != nil {
		r.logger.Error("Failed to get learning path", zap.String("pathID", pathID), zap.Error(err))
		return nil, err
	}

	return result.(*models.LearningPath), nil
}

// GetRecommendedLearningPath retrieves recommended learning path for a student
func (r *LearningPathRepository) GetRecommendedLearningPath(ctx context.Context, studentID string) ([]models.LearningPath, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (s:Student {name: $studentID})-[:HAS_PERSONALITY]->(m:MBTIType)-[:SUITS]->(c:Career)
			MATCH (c)<-[:TARGETS]-(lp:LearningPath)
			OPTIONAL MATCH (lp)-[:INCLUDES]->(course:Course)
			RETURN lp.id as id, lp.name as name, lp.description as description,
			       lp.estimatedDuration as estimatedDuration,
			       c.name as targetCareer,
			       collect(DISTINCT {
			           id: course.id,
			           name: course.name,
			           provider: course.provider,
			           duration: course.duration,
			           difficulty: course.difficulty,
			           rating: course.rating
			       }) as courses
			ORDER BY lp.name
			LIMIT 5
		`

		params := map[string]interface{}{"studentID": studentID}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		var paths []models.LearningPath
		for result.Next(ctx) {
			record := result.Record()

			path := models.LearningPath{
				ID:                getString(record, "id"),
				Name:              getString(record, "name"),
				Description:       getString(record, "description"),
				TargetCareer:      getString(record, "targetCareer"),
				EstimatedDuration: getString(record, "estimatedDuration"),
				Courses:           r.parseCourses(record, "courses"),
			}

			paths = append(paths, path)
		}

		return paths, nil
	})

	if err != nil {
		r.logger.Error("Failed to get recommended learning path", zap.String("studentID", studentID), zap.Error(err))
		return nil, err
	}

	return result.([]models.LearningPath), nil
}

// Helper function to parse courses from Neo4j result
func (r *LearningPathRepository) parseCourses(record *neo4j.Record, key string) []models.Course {
	if val, ok := record.Get(key); ok && val != nil {
		if courseList, ok := val.([]interface{}); ok {
			courses := make([]models.Course, 0, len(courseList))
			for _, c := range courseList {
				if courseMap, ok := c.(map[string]interface{}); ok {
					course := models.Course{
						ID:         getStringFromMap(courseMap, "id"),
						Name:       getStringFromMap(courseMap, "name"),
						Provider:   getStringFromMap(courseMap, "provider"),
						Duration:   getStringFromMap(courseMap, "duration"),
						Difficulty: getStringFromMap(courseMap, "difficulty"),
						Rating:     getFloat64FromMap(courseMap, "rating"),
					}
					if course.ID != "" {
						courses = append(courses, course)
					}
				}
			}
			return courses
		}
	}
	return []models.Course{}
}

func getStringFromMap(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok && val != nil {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func getFloat64FromMap(m map[string]interface{}, key string) float64 {
	if val, ok := m[key]; ok && val != nil {
		switch v := val.(type) {
		case float64:
			return v
		case int64:
			return float64(v)
		}
	}
	return 0.0
}
