package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"pathmind-server/internal/models"
	"pathmind-server/internal/service"
	"go.uber.org/zap"
)

type MBTIHandler struct {
	mbtiService *service.MBTIService
	logger      *zap.Logger
}

func NewMBTIHandler(mbtiService *service.MBTIService, logger *zap.Logger) *MBTIHandler {
	return &MBTIHandler{
		mbtiService: mbtiService,
		logger:      logger,
	}
}

// SubmitMBTITest handles MBTI test submission
// @Summary Submit MBTI test
// @Tags mbti
// @Accept json
// @Produce json
// @Param data body models.MBTISubmitData true "MBTI test data"
// @Success 200 {object} models.MBTIResult
// @Router /api/mbti/submit [post]
func (h *MBTIHandler) SubmitMBTITest(c *gin.Context) {
	var data models.MBTISubmitData
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.mbtiService.SubmitMBTITest(c.Request.Context(), data)
	if err != nil {
		h.logger.Error("Failed to submit MBTI test", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit MBTI test"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetMBTIType retrieves MBTI type information
// @Summary Get MBTI type
// @Tags mbti
// @Param code path string true "MBTI Code"
// @Success 200 {object} models.MBTIType
// @Router /api/mbti/types/{code} [get]
func (h *MBTIHandler) GetMBTIType(c *gin.Context) {
	code := c.Param("code")

	mbtiType, err := h.mbtiService.GetMBTIType(c.Request.Context(), code)
	if err != nil {
		h.logger.Error("Failed to get MBTI type", zap.String("code", code), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "MBTI type not found"})
		return
	}

	c.JSON(http.StatusOK, mbtiType)
}

// GetAllMBTITypes retrieves all MBTI types
// @Summary Get all MBTI types
// @Tags mbti
// @Success 200 {array} models.MBTIType
// @Router /api/mbti/types [get]
func (h *MBTIHandler) GetAllMBTITypes(c *gin.Context) {
	types, err := h.mbtiService.GetAllMBTITypes(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to get all MBTI types", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get MBTI types"})
		return
	}

	if types == nil {
		types = []models.MBTIType{}
	}

	c.JSON(http.StatusOK, types)
}
// @Summary Get recommended careers
// @Tags careers
// @Param code path string true "MBTI Code"
// @Success 200 {array} models.Career
// @Router /api/mbti/types/{code}/careers [get]
func (h *MBTIHandler) GetRecommendedCareers(c *gin.Context) {
	code := c.Param("code")

	careers, err := h.mbtiService.GetRecommendedCareers(c.Request.Context(), code)
	if err != nil {
		h.logger.Error("Failed to get recommended careers", zap.String("code", code), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get recommended careers"})
		return
	}

	if careers == nil {
		careers = []models.Career{}
	}

	c.JSON(http.StatusOK, careers)
}

// GetCareerByID retrieves a specific career
// @Summary Get career by ID
// @Tags careers
// @Param id path string true "Career ID"
// @Success 200 {object} models.Career
// @Router /api/careers/{id} [get]
func (h *MBTIHandler) GetCareerByID(c *gin.Context) {
	careerID := c.Param("id")

	career, err := h.mbtiService.GetCareerByID(c.Request.Context(), careerID)
	if err != nil {
		h.logger.Error("Failed to get career", zap.String("careerID", careerID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "Career not found"})
		return
	}

	c.JSON(http.StatusOK, career)
}

// GetLearningPathByCareer retrieves learning paths for a career
// @Summary Get learning paths by career
// @Tags learning-paths
// @Param id path string true "Career ID"
// @Success 200 {array} models.LearningPath
// @Router /api/careers/{id}/learning-paths [get]
func (h *MBTIHandler) GetLearningPathByCareer(c *gin.Context) {
	careerID := c.Param("id")

	paths, err := h.mbtiService.GetLearningPathByCareer(c.Request.Context(), careerID)
	if err != nil {
		h.logger.Error("Failed to get learning paths", zap.String("careerID", careerID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get learning paths"})
		return
	}

	if paths == nil {
		paths = []models.LearningPath{}
	}

	c.JSON(http.StatusOK, paths)
}

// GetRecommendedLearningPath retrieves recommended learning path for a student
// @Summary Get recommended learning path
// @Tags learning-paths
// @Param studentId query string true "Student ID"
// @Success 200 {array} models.LearningPath
// @Router /api/learning-paths/recommended [get]
func (h *MBTIHandler) GetRecommendedLearningPath(c *gin.Context) {
	studentID := c.Query("studentId")
	if studentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Student ID is required"})
		return
	}

	paths, err := h.mbtiService.GetRecommendedLearningPath(c.Request.Context(), studentID)
	if err != nil {
		h.logger.Error("Failed to get recommended learning path", zap.String("studentID", studentID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get recommended learning path"})
		return
	}

	if paths == nil {
		paths = []models.LearningPath{}
	}

	c.JSON(http.StatusOK, paths)
}
