package neo4j

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
)

type MBTIRepository struct {
	driver neo4j.DriverWithContext
	logger *zap.Logger
}

func NewMBTIRepository(driver neo4j.DriverWithContext, logger *zap.Logger) *MBTIRepository {
	return &MBTIRepository{
		driver: driver,
		logger: logger,
	}
}

// SubmitMBTITest creates a student node and links to MBTI type
func (r *MBTIRepository) SubmitMBTITest(ctx context.Context, data models.MBTISubmitData, mbtiCode string) (string, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	result, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MERGE (s:Student {name: $name})
			SET s.mbtiType = $mbtiCode
			WITH s
			MATCH (m:MBTIType {code: $mbtiCode})
			MERGE (s)-[:HAS_PERSONALITY]->(m)
			RETURN s.name as studentId
		`

		params := map[string]interface{}{
			"name":     data.StudentName,
			"mbtiCode": mbtiCode,
		}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()
			studentID, _ := record.Get("studentId")
			return studentID.(string), nil
		}

		return data.StudentName, nil
	})

	if err != nil {
		r.logger.Error("Failed to submit MBTI test", zap.Error(err))
		return "", err
	}

	return result.(string), nil
}

// GetMBTIType retrieves MBTI type information
func (r *MBTIRepository) GetMBTIType(ctx context.Context, code string) (*models.MBTIType, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (m:MBTIType {code: $code})
			RETURN m.code as code, m.name as name, m.description as description,
			       m.strengths as strengths, m.weaknesses as weaknesses
		`

		params := map[string]interface{}{"code": code}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()

			mbtiType := &models.MBTIType{
				Code:        getString(record, "code"),
				Name:        getString(record, "name"),
				Description: getString(record, "description"),
				Strengths:   getStringSlice(record, "strengths"),
				Weaknesses:  getStringSlice(record, "weaknesses"),
			}

			return mbtiType, nil
		}

		return nil, fmt.Errorf("MBTI type not found: %s", code)
	})

	if err != nil {
		r.logger.Error("Failed to get MBTI type", zap.String("code", code), zap.Error(err))
		return nil, err
	}

	return result.(*models.MBTIType), nil
}

// GetAllMBTITypes retrieves all MBTI types
func (r *MBTIRepository) GetAllMBTITypes(ctx context.Context) ([]models.MBTIType, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (m:MBTIType)
			RETURN m.code as code, m.name as name, m.description as description
			ORDER BY m.code
		`

		result, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		var types []models.MBTIType
		for result.Next(ctx) {
			record := result.Record()

			mbtiType := models.MBTIType{
				Code:        getString(record, "code"),
				Name:        getString(record, "name"),
				Description: getString(record, "description"),
			}

			types = append(types, mbtiType)
		}

		return types, nil
	})

	if err != nil {
		r.logger.Error("Failed to get all MBTI types", zap.Error(err))
		return nil, err
	}

	return result.([]models.MBTIType), nil
}

// Helper functions
func getString(record *neo4j.Record, key string) string {
	if val, ok := record.Get(key); ok && val != nil {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func getStringSlice(record *neo4j.Record, key string) []string {
	if val, ok := record.Get(key); ok && val != nil {
		if slice, ok := val.([]interface{}); ok {
			result := make([]string, len(slice))
			for i, v := range slice {
				if str, ok := v.(string); ok {
					result[i] = str
				}
			}
			return result
		}
	}
	return []string{}
}
