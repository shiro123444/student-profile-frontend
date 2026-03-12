package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"pathmind-server/internal/service"
	"go.uber.org/zap"
)

type GraphHandler struct {
	graphService *service.GraphService
	logger       *zap.Logger
}

func NewGraphHandler(graphService *service.GraphService, logger *zap.Logger) *GraphHandler {
	return &GraphHandler{
		graphService: graphService,
		logger:       logger,
	}
}

// GetFullGraph retrieves the complete knowledge graph
// @Summary Get full knowledge graph
// @Tags graph
// @Produce json
// @Success 200 {object} models.GraphData
// @Router /api/graph/full [get]
func (h *GraphHandler) GetFullGraph(c *gin.Context) {
	data, err := h.graphService.GetFullGraph(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to get full graph", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get graph data"})
		return
	}

	c.JSON(http.StatusOK, data)
}

// GetStudentGraph retrieves the knowledge graph for a specific student
// @Summary Get student knowledge graph
// @Tags graph
// @Param id path string true "Student ID"
// @Produce json
// @Success 200 {object} models.GraphData
// @Router /api/graph/student/{id} [get]
func (h *GraphHandler) GetStudentGraph(c *gin.Context) {
	studentID := c.Param("id")
	if studentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Student ID is required"})
		return
	}

	data, err := h.graphService.GetStudentGraph(c.Request.Context(), studentID)
	if err != nil {
		h.logger.Error("Failed to get student graph", zap.String("studentID", studentID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get student graph"})
		return
	}

	c.JSON(http.StatusOK, data)
}

// GetCareerGraph retrieves the knowledge graph for a specific career
// @Summary Get career knowledge graph
// @Tags graph
// @Param id path string true "Career ID"
// @Produce json
// @Success 200 {object} models.GraphData
// @Router /api/graph/career/{id} [get]
func (h *GraphHandler) GetCareerGraph(c *gin.Context) {
	careerID := c.Param("id")
	if careerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Career ID is required"})
		return
	}

	data, err := h.graphService.GetCareerGraph(c.Request.Context(), careerID)
	if err != nil {
		h.logger.Error("Failed to get career graph", zap.String("careerID", careerID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get career graph"})
		return
	}

	c.JSON(http.StatusOK, data)
}
