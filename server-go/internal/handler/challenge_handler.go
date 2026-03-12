package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

// ChallengeHandler handles algorithm challenge endpoints.
// NOTE: These are interface stubs. The actual OJ integration will be
// provided by the user's own system.
type ChallengeHandler struct {
	db     *gorm.DB
	logger *zap.Logger
}

// NewChallengeHandler creates a new ChallengeHandler
func NewChallengeHandler(db *gorm.DB, logger *zap.Logger) *ChallengeHandler {
	return &ChallengeHandler{db: db, logger: logger}
}

// ListChallenges returns all available challenges
func (h *ChallengeHandler) ListChallenges(c *gin.Context) {
	var challenges []models.AlgorithmChallenge
	if err := h.db.WithContext(c.Request.Context()).
		Order("created_at DESC").
		Find(&challenges).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list challenges"})
		return
	}
	if challenges == nil {
		challenges = []models.AlgorithmChallenge{}
	}
	c.JSON(http.StatusOK, challenges)
}

// GetChallenge returns a specific challenge by ID
func (h *ChallengeHandler) GetChallenge(c *gin.Context) {
	id := c.Param("id")
	var challenge models.AlgorithmChallenge
	if err := h.db.WithContext(c.Request.Context()).Where("id = ?", id).First(&challenge).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "challenge not found"})
		return
	}
	c.JSON(http.StatusOK, challenge)
}

// SubmitSolution handles submitting a solution to a challenge (stub - OJ integration)
func (h *ChallengeHandler) SubmitSolution(c *gin.Context) {
	// TODO: Forward to OJ system
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "submission not yet integrated",
		"message": "算法挑战提交功能等待 OJ 系统集成",
	})
}

// Create creates a new algorithm challenge (teacher/admin only)
func (h *ChallengeHandler) Create(c *gin.Context) {
	var challenge models.AlgorithmChallenge
	if err := c.ShouldBindJSON(&challenge); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&challenge).Error; err != nil {
		h.logger.Error("Failed to create challenge", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create challenge"})
		return
	}

	c.JSON(http.StatusCreated, challenge)
}

// GetSubmissions returns a student's submissions for a challenge
func (h *ChallengeHandler) GetSubmissions(c *gin.Context) {
	challengeID := c.Param("id")
	userID, _ := c.Get("user_id")

	var submissions []models.ChallengeSubmission
	query := h.db.WithContext(c.Request.Context()).
		Where("challenge_id = ?", challengeID).
		Order("submitted_at DESC")

	// Students only see their own submissions
	role, _ := c.Get("role")
	if role == "student" {
		query = query.Where("student_id = ?", userID)
	}

	if err := query.Find(&submissions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get submissions"})
		return
	}
	if submissions == nil {
		submissions = []models.ChallengeSubmission{}
	}
	c.JSON(http.StatusOK, submissions)
}
