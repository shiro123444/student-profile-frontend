package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"pathmind-server/internal/service"
	"go.uber.org/zap"
)

type ExperimentHandler struct {
	experimentService *service.ExperimentService
	logger            *zap.Logger
}

func NewExperimentHandler(experimentService *service.ExperimentService, logger *zap.Logger) *ExperimentHandler {
	return &ExperimentHandler{
		experimentService: experimentService,
		logger:            logger,
	}
}

// GetAllExperiments retrieves all experiments
// @Summary Get all experiments
// @Tags experiments
// @Success 200 {array} models.Experiment
// @Router /api/experiments [get]
func (h *ExperimentHandler) GetAllExperiments(c *gin.Context) {
	experiments, err := h.experimentService.GetAllExperiments(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to get all experiments", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get experiments"})
		return
	}

	c.JSON(http.StatusOK, experiments)
}

// GetExperimentByID retrieves an experiment by ID
// @Summary Get experiment by ID
// @Tags experiments
// @Param id path string true "Experiment ID"
// @Success 200 {object} models.Experiment
// @Router /api/experiments/{id} [get]
func (h *ExperimentHandler) GetExperimentByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid experiment ID"})
		return
	}

	experiment, err := h.experimentService.GetExperimentByID(c.Request.Context(), id)
	if err != nil {
		h.logger.Error("Failed to get experiment", zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "Experiment not found"})
		return
	}

	c.JSON(http.StatusOK, experiment)
}

// CreateExperiment creates a new experiment
// @Summary Create experiment
// @Tags experiments
// @Accept json
// @Produce json
// @Param experiment body models.Experiment true "Experiment data"
// @Success 201 {object} models.Experiment
// @Router /api/experiments [post]
func (h *ExperimentHandler) CreateExperiment(c *gin.Context) {
	var experiment models.Experiment
	if err := c.ShouldBindJSON(&experiment); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := h.experimentService.CreateExperiment(c.Request.Context(), &experiment)
	if err != nil {
		h.logger.Error("Failed to create experiment", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create experiment"})
		return
	}

	c.JSON(http.StatusCreated, experiment)
}

// GetStudentExperiments retrieves all experiments for a student
// @Summary Get student experiments
// @Tags experiments
// @Param studentId path string true "Student ID"
// @Success 200 {array} models.StudentExperiment
// @Router /api/students/{studentId}/experiments [get]
func (h *ExperimentHandler) GetStudentExperiments(c *gin.Context) {
	studentID, err := uuid.Parse(c.Param("studentId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid student ID"})
		return
	}

	experiments, err := h.experimentService.GetStudentExperiments(c.Request.Context(), studentID)
	if err != nil {
		h.logger.Error("Failed to get student experiments", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get student experiments"})
		return
	}

	c.JSON(http.StatusOK, experiments)
}

// StartExperiment starts an experiment for a student
// @Summary Start experiment
// @Tags experiments
// @Accept json
// @Produce json
// @Param data body object true "Start experiment data"
// @Success 200 {object} models.StudentExperiment
// @Router /api/experiments/start [post]
func (h *ExperimentHandler) StartExperiment(c *gin.Context) {
	var req struct {
		StudentID    string `json:"student_id" binding:"required"`
		ExperimentID string `json:"experiment_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	studentID, err := uuid.Parse(req.StudentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid student ID"})
		return
	}

	experimentID, err := uuid.Parse(req.ExperimentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid experiment ID"})
		return
	}

	studentExp, err := h.experimentService.StartExperiment(c.Request.Context(), studentID, experimentID)
	if err != nil {
		h.logger.Error("Failed to start experiment", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start experiment"})
		return
	}

	c.JSON(http.StatusOK, studentExp)
}

// SubmitExperiment submits an experiment completion
// @Summary Submit experiment
// @Tags experiments
// @Accept json
// @Produce json
// @Param id path string true "Student Experiment ID"
// @Param data body object true "Submit data"
// @Success 200 {object} map[string]string
// @Router /api/experiments/{id}/submit [post]
func (h *ExperimentHandler) SubmitExperiment(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid experiment ID"})
		return
	}

	var req struct {
		Score     float64 `json:"score" binding:"required"`
		IsCorrect bool    `json:"is_correct"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = h.experimentService.SubmitExperiment(c.Request.Context(), id, req.Score, req.IsCorrect)
	if err != nil {
		h.logger.Error("Failed to submit experiment", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit experiment"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Experiment submitted successfully"})
}

// GetLearningTrend retrieves learning trend data for a student
// @Summary Get learning trend
// @Tags analytics
// @Param studentId path string true "Student ID"
// @Param days query int false "Number of days" default(30)
// @Success 200 {array} models.LearningTrend
// @Router /api/students/{studentId}/learning-trend [get]
func (h *ExperimentHandler) GetLearningTrend(c *gin.Context) {
	studentID, err := uuid.Parse(c.Param("studentId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid student ID"})
		return
	}

	days := 30
	if daysParam := c.Query("days"); daysParam != "" {
		if d, err := uuid.Parse(daysParam); err == nil {
			days = int(d.ID())
		}
	}

	trends, err := h.experimentService.GetLearningTrend(c.Request.Context(), studentID, days)
	if err != nil {
		h.logger.Error("Failed to get learning trend", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get learning trend"})
		return
	}

	c.JSON(http.StatusOK, trends)
}
