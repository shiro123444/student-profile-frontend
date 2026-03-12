package service

import (
	"context"

	"pathmind-server/internal/models"
	neo4jrepo "pathmind-server/internal/repository/neo4j"
	"go.uber.org/zap"
)

type GraphService struct {
	graphRepo *neo4jrepo.GraphRepository
	logger    *zap.Logger
}

func NewGraphService(graphRepo *neo4jrepo.GraphRepository, logger *zap.Logger) *GraphService {
	return &GraphService{
		graphRepo: graphRepo,
		logger:    logger,
	}
}

// GetFullGraph retrieves the complete knowledge graph
func (s *GraphService) GetFullGraph(ctx context.Context) (*models.GraphData, error) {
	return s.graphRepo.GetFullGraph(ctx)
}

// GetStudentGraph retrieves the knowledge graph for a specific student
func (s *GraphService) GetStudentGraph(ctx context.Context, studentID string) (*models.GraphData, error) {
	return s.graphRepo.GetStudentGraph(ctx, studentID)
}

// GetCareerGraph retrieves the knowledge graph for a specific career
func (s *GraphService) GetCareerGraph(ctx context.Context, careerID string) (*models.GraphData, error) {
	return s.graphRepo.GetCareerGraph(ctx, careerID)
}
