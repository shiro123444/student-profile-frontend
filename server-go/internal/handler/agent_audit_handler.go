package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

// AgentAuditHandler ingests audit logs from Python agent service.
type AgentAuditHandler struct {
	db     *gorm.DB
	logger *zap.Logger
}

// NewAgentAuditHandler creates a new AgentAuditHandler.
func NewAgentAuditHandler(db *gorm.DB, logger *zap.Logger) *AgentAuditHandler {
	return &AgentAuditHandler{db: db, logger: logger}
}

// AgentAuditIngestRequest represents one audit record payload.
type AgentAuditIngestRequest struct {
	RequestID  string      `json:"request_id" binding:"required"`
	SessionID  string      `json:"session_id"`
	StudentID  string      `json:"student_id"`
	Agent      string      `json:"agent"`
	Engine     string      `json:"engine"`
	Mode       string      `json:"mode"`
	Tool       string      `json:"tool"`
	Risk       string      `json:"risk"`
	Approved   bool        `json:"approved"`
	Status     string      `json:"status"`
	Args       interface{} `json:"args"`
	Result     interface{} `json:"result"`
	Error      string      `json:"error"`
	DurationMS int         `json:"duration_ms"`
}

func toJSONString(v interface{}) string {
	if v == nil {
		return ""
	}
	buf, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(buf)
}

// Ingest persists one audit record.
// POST /api/internal/agent/audit
func (h *AgentAuditHandler) Ingest(c *gin.Context) {
	var req AgentAuditIngestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	record := models.AgentActionAudit{
		RequestID:  req.RequestID,
		SessionID:  req.SessionID,
		StudentID:  req.StudentID,
		Agent:      req.Agent,
		Engine:     req.Engine,
		Mode:       req.Mode,
		Tool:       req.Tool,
		Risk:       req.Risk,
		Approved:   req.Approved,
		Status:     req.Status,
		Args:       toJSONString(req.Args),
		Result:     toJSONString(req.Result),
		Error:      req.Error,
		DurationMS: req.DurationMS,
	}

	if err := h.db.Create(&record).Error; err != nil {
		h.logger.Error("Failed to persist agent audit", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist audit"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "request_id": req.RequestID})
}
