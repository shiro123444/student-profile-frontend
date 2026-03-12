package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"pathmind-server/internal/service"
)

// PointsHandler handles points and credits endpoints
type PointsHandler struct {
	pointsService *service.PointsService
	logger        *zap.Logger
}

// NewPointsHandler creates a new PointsHandler
func NewPointsHandler(pointsService *service.PointsService, logger *zap.Logger) *PointsHandler {
	return &PointsHandler{
		pointsService: pointsService,
		logger:        logger,
	}
}

// GetBalance returns the student's current point and credit balance
func (h *PointsHandler) GetBalance(c *gin.Context) {
	studentID, err := h.getStudentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student ID"})
		return
	}

	balance, err := h.pointsService.GetBalance(c.Request.Context(), studentID)
	if err != nil {
		h.logger.Error("Failed to get balance", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get balance"})
		return
	}

	c.JSON(http.StatusOK, balance)
}

// DailyCheckin performs a daily check-in
func (h *PointsHandler) DailyCheckin(c *gin.Context) {
	studentID, err := h.getStudentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student ID"})
		return
	}

	points, bonus, err := h.pointsService.DailyCheckin(c.Request.Context(), studentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"points_awarded": points,
		"streak_bonus":   bonus,
		"message":        "签到成功！",
	})
}

// GetTransactions returns point transaction history
func (h *PointsHandler) GetTransactions(c *gin.Context) {
	studentID, err := h.getStudentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student ID"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	txns, total, err := h.pointsService.GetTransactions(c.Request.Context(), studentID, page, pageSize)
	if err != nil {
		h.logger.Error("Failed to get transactions", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get transactions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"transactions": txns,
		"total":        total,
		"page":         page,
		"page_size":    pageSize,
	})
}

// ExchangeCredits converts points to AI credits
func (h *PointsHandler) ExchangeCredits(c *gin.Context) {
	studentID, err := h.getStudentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student ID"})
		return
	}

	var req struct {
		Points int `json:"points" binding:"required,gt=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	credits, err := h.pointsService.ExchangeCredits(c.Request.Context(), studentID, req.Points)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"credits_granted": credits,
		"points_spent":    req.Points,
		"message":         "兑换成功！",
	})
}

// GetLeaderboard returns the top students by points
func (h *PointsHandler) GetLeaderboard(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 || limit > 200 {
		limit = 50
	}

	results, err := h.pointsService.GetLeaderboard(c.Request.Context(), limit)
	if err != nil {
		h.logger.Error("Failed to get leaderboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get leaderboard"})
		return
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	c.JSON(http.StatusOK, results)
}

// getStudentID extracts student ID from JWT context
func (h *PointsHandler) getStudentID(c *gin.Context) (uuid.UUID, error) {
	// First try to get from context (set by auth middleware as user_id)
	userIDStr, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, fmt.Errorf("no user_id in context")
	}
	return uuid.Parse(userIDStr.(string))
}
