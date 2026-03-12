package handler

import (
	"errors"
	"net/http"

	"pathmind-server/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type StudentHandler struct {
	studentService *service.StudentService
	logger         *zap.Logger
}

func NewStudentHandler(studentService *service.StudentService, logger *zap.Logger) *StudentHandler {
	return &StudentHandler{
		studentService: studentService,
		logger:         logger,
	}
}

// GetStudentProfile retrieves a student's profile
// @Summary Get student profile
// @Tags students
// @Param id path string true "Student ID"
// @Success 200 {object} models.StudentProfile
// @Router /api/students/{id}/profile [get]
func (h *StudentHandler) GetStudentProfile(c *gin.Context) {
	studentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid student ID"})
		return
	}

	profile, err := h.studentService.GetStudentProfile(c.Request.Context(), studentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Student profile not found"})
			return
		}
		h.logger.Error("Failed to get student profile", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get student profile"})
		return
	}

	c.JSON(http.StatusOK, profile)
}

// GetClassOverview retrieves class overview statistics
// @Summary Get class overview
// @Tags classes
// @Param id path string true "Class ID"
// @Success 200 {object} models.ClassOverview
// @Router /api/classes/{id}/overview [get]
func (h *StudentHandler) GetClassOverview(c *gin.Context) {
	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid class ID"})
		return
	}

	overview, err := h.studentService.GetClassOverview(c.Request.Context(), classID)
	if err != nil {
		h.logger.Error("Failed to get class overview", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get class overview"})
		return
	}

	c.JSON(http.StatusOK, overview)
}

// GetStudentAlerts retrieves students who need attention
// @Summary Get student alerts
// @Tags classes
// @Param id path string true "Class ID"
// @Success 200 {array} models.StudentAlert
// @Router /api/classes/{id}/alerts [get]
func (h *StudentHandler) GetStudentAlerts(c *gin.Context) {
	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid class ID"})
		return
	}

	alerts, err := h.studentService.GetStudentAlerts(c.Request.Context(), classID)
	if err != nil {
		h.logger.Error("Failed to get student alerts", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get student alerts"})
		return
	}

	c.JSON(http.StatusOK, alerts)
}

// RefreshStudentProfile recalculates and updates a student's profile
// @Summary Refresh student profile
// @Tags students
// @Param id path string true "Student ID"
// @Success 200 {object} map[string]string
// @Router /api/students/{id}/profile/refresh [post]
func (h *StudentHandler) RefreshStudentProfile(c *gin.Context) {
	studentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid student ID"})
		return
	}

	err = h.studentService.CalculateStudentProfile(c.Request.Context(), studentID)
	if err != nil {
		h.logger.Error("Failed to refresh student profile", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh student profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile refreshed successfully"})
}
