package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"pathmind-server/internal/models"
	"pathmind-server/internal/service"
)

type ToolHandler struct {
	toolService *service.ToolService
	logger      *zap.Logger
}

func NewToolHandler(toolService *service.ToolService, logger *zap.Logger) *ToolHandler {
	return &ToolHandler{toolService: toolService, logger: logger}
}

// ── Custom Tools ──

func (h *ToolHandler) CreateTool(c *gin.Context) {
	var tool models.CustomTool
	if err := c.ShouldBindJSON(&tool); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	tool.CreatedBy = uuid.MustParse(userID.(string))

	if err := h.toolService.CreateTool(&tool); err != nil {
		h.logger.Error("Failed to create tool", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create tool"})
		return
	}

	c.JSON(http.StatusCreated, tool)
}

func (h *ToolHandler) GetTool(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tool ID"})
		return
	}

	tool, err := h.toolService.GetTool(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tool not found"})
		return
	}

	c.JSON(http.StatusOK, tool)
}

func (h *ToolHandler) ListTools(c *gin.Context) {
	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")

	tools, err := h.toolService.ListTools(
		uuid.MustParse(userID.(string)),
		role.(string),
	)
	if err != nil {
		h.logger.Error("Failed to list tools", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tools"})
		return
	}

	c.JSON(http.StatusOK, tools)
}

func (h *ToolHandler) UpdateTool(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tool ID"})
		return
	}

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Prevent updating protected fields
	delete(updates, "id")
	delete(updates, "created_by")
	delete(updates, "created_at")
	delete(updates, "is_approved")

	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")

	if err := h.toolService.UpdateTool(id, uuid.MustParse(userID.(string)), role.(string), updates); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

func (h *ToolHandler) DeleteTool(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tool ID"})
		return
	}

	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")

	if err := h.toolService.DeleteTool(id, uuid.MustParse(userID.(string)), role.(string)); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *ToolHandler) ApproveTool(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tool ID"})
		return
	}

	if err := h.toolService.ApproveTool(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to approve tool"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "approved"})
}

// ListActiveTools returns all active+approved tools (called by Python service)
func (h *ToolHandler) ListActiveTools(c *gin.Context) {
	tools, err := h.toolService.ListActiveApproved()
	if err != nil {
		h.logger.Error("Failed to list active tools", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tools"})
		return
	}

	c.JSON(http.StatusOK, tools)
}

// ── Custom Skills ──

func (h *ToolHandler) CreateSkill(c *gin.Context) {
	var skill models.CustomSkill
	if err := c.ShouldBindJSON(&skill); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	skill.CreatedBy = uuid.MustParse(userID.(string))

	if err := h.toolService.CreateSkill(&skill); err != nil {
		h.logger.Error("Failed to create skill", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create skill"})
		return
	}

	c.JSON(http.StatusCreated, skill)
}

func (h *ToolHandler) GetSkill(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid skill ID"})
		return
	}

	skill, err := h.toolService.GetSkill(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		return
	}

	c.JSON(http.StatusOK, skill)
}

func (h *ToolHandler) ListSkills(c *gin.Context) {
	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")

	skills, err := h.toolService.ListSkills(
		uuid.MustParse(userID.(string)),
		role.(string),
	)
	if err != nil {
		h.logger.Error("Failed to list skills", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list skills"})
		return
	}

	c.JSON(http.StatusOK, skills)
}

func (h *ToolHandler) UpdateSkill(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid skill ID"})
		return
	}

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	delete(updates, "id")
	delete(updates, "created_by")
	delete(updates, "created_at")
	delete(updates, "is_approved")

	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")

	if err := h.toolService.UpdateSkill(id, uuid.MustParse(userID.(string)), role.(string), updates); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

func (h *ToolHandler) DeleteSkill(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid skill ID"})
		return
	}

	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")

	if err := h.toolService.DeleteSkill(id, uuid.MustParse(userID.(string)), role.(string)); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *ToolHandler) ApproveSkill(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid skill ID"})
		return
	}

	if err := h.toolService.ApproveSkill(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to approve skill"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "approved"})
}

// ListActiveSkills returns all active+approved skills (called by Python service)
func (h *ToolHandler) ListActiveSkills(c *gin.Context) {
	skills, err := h.toolService.ListActiveApprovedSkills()
	if err != nil {
		h.logger.Error("Failed to list active skills", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list skills"})
		return
	}

	c.JSON(http.StatusOK, skills)
}
