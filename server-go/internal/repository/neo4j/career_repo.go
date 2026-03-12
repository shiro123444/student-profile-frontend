package neo4j

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
)

type CareerRepository struct {
	driver neo4j.DriverWithContext
	logger *zap.Logger
}

func NewCareerRepository(driver neo4j.DriverWithContext, logger *zap.Logger) *CareerRepository {
	return &CareerRepository{
		driver: driver,
		logger: logger,
	}
}

// GetRecommendedCareers retrieves careers recommended for an MBTI type
func (r *CareerRepository) GetRecommendedCareers(ctx context.Context, mbtiCode string) ([]models.Career, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (m:MBTIType {code: $mbtiCode})-[:SUITS]->(c:Career)
			OPTIONAL MATCH (c)-[:REQUIRES]->(s:Skill)
			RETURN c.id as id, c.name as name, c.description as description,
			       c.salary as salary, c.growth as growth,
			       collect(DISTINCT s.name) as skills
			ORDER BY c.name
		`

		params := map[string]interface{}{"mbtiCode": mbtiCode}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		var careers []models.Career
		for result.Next(ctx) {
			record := result.Record()

			career := models.Career{
				ID:          getString(record, "id"),
				Name:        getString(record, "name"),
				Description: getString(record, "description"),
				Salary:      getString(record, "salary"),
				Growth:      getString(record, "growth"),
				Skills:      getStringSlice(record, "skills"),
			}

			careers = append(careers, career)
		}

		return careers, nil
	})

	if err != nil {
		r.logger.Error("Failed to get recommended careers", zap.String("mbtiCode", mbtiCode), zap.Error(err))
		return nil, err
	}

	return result.([]models.Career), nil
}

// GetCareerByID retrieves a specific career by ID
func (r *CareerRepository) GetCareerByID(ctx context.Context, careerID string) (*models.Career, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (c:Career {id: $careerID})
			OPTIONAL MATCH (c)-[:REQUIRES]->(s:Skill)
			RETURN c.id as id, c.name as name, c.description as description,
			       c.salary as salary, c.growth as growth,
			       collect(DISTINCT s.name) as skills
		`

		params := map[string]interface{}{"careerID": careerID}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()

			career := &models.Career{
				ID:          getString(record, "id"),
				Name:        getString(record, "name"),
				Description: getString(record, "description"),
				Salary:      getString(record, "salary"),
				Growth:      getString(record, "growth"),
				Skills:      getStringSlice(record, "skills"),
			}

			return career, nil
		}

		return nil, fmt.Errorf("career not found: %s", careerID)
	})

	if err != nil {
		r.logger.Error("Failed to get career", zap.String("careerID", careerID), zap.Error(err))
		return nil, err
	}

	return result.(*models.Career), nil
}

// GetAllCareers retrieves all careers
func (r *CareerRepository) GetAllCareers(ctx context.Context) ([]models.Career, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (c:Career)
			OPTIONAL MATCH (c)-[:REQUIRES]->(s:Skill)
			RETURN c.id as id, c.name as name, c.description as description,
			       collect(DISTINCT s.name) as skills
			ORDER BY c.name
		`

		result, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		var careers []models.Career
		for result.Next(ctx) {
			record := result.Record()

			career := models.Career{
				ID:          getString(record, "id"),
				Name:        getString(record, "name"),
				Description: getString(record, "description"),
				Skills:      getStringSlice(record, "skills"),
			}

			careers = append(careers, career)
		}

		return careers, nil
	})

	if err != nil {
		r.logger.Error("Failed to get all careers", zap.Error(err))
		return nil, err
	}

	return result.([]models.Career), nil
}
