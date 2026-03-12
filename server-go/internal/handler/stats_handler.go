package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"pathmind-server/internal/service"
	"go.uber.org/zap"
)

// StatsHandler serves public platform statistics for the homepage agent.
type StatsHandler struct {
	statsService *service.StatsService
	logger       *zap.Logger
}

func NewStatsHandler(statsService *service.StatsService, logger *zap.Logger) *StatsHandler {
	return &StatsHandler{statsService: statsService, logger: logger}
}

// GetPlatformStats returns aggregate platform metrics.
// GET /api/stats/platform
func (h *StatsHandler) GetPlatformStats(c *gin.Context) {
	stats, err := h.statsService.GetPlatformStats(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to get platform stats", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get platform stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// GetTrendingCareers returns popular career recommendations.
// GET /api/careers/trending
func (h *StatsHandler) GetTrendingCareers(c *gin.Context) {
	limit := 5
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "5")); err == nil && l > 0 && l <= 20 {
		limit = l
	}

	careers, err := h.statsService.GetTrendingCareers(c.Request.Context(), limit)
	if err != nil {
		h.logger.Error("Failed to get trending careers", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get trending careers"})
		return
	}
	c.JSON(http.StatusOK, careers)
}

// GetFeaturedExperiments returns the most popular experiments.
// GET /api/experiments/featured
func (h *StatsHandler) GetFeaturedExperiments(c *gin.Context) {
	limit := 3
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "3")); err == nil && l > 0 && l <= 10 {
		limit = l
	}

	experiments, err := h.statsService.GetFeaturedExperiments(c.Request.Context(), limit)
	if err != nil {
		h.logger.Error("Failed to get featured experiments", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get featured experiments"})
		return
	}
	c.JSON(http.StatusOK, experiments)
}
