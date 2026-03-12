package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"pathmind-server/internal/service"
)

type inlineCompletionRequest struct {
	Prefix         string `json:"prefix"`
	Suffix         string `json:"suffix"`
	ContextSummary string `json:"context_summary"`
	Mode           string `json:"mode"`
	Language       string `json:"language"`
}

type inlineCompletionResponse struct {
	Completion string `json:"completion"`
}

// InlineCompletionHandler handles markdown inline tab-completion requests.
type InlineCompletionHandler struct {
	svc    *service.InlineCompletionService
	logger *zap.Logger
}

// NewInlineCompletionHandler creates a new inline completion handler.
func NewInlineCompletionHandler(
	svc *service.InlineCompletionService,
	logger *zap.Logger,
) *InlineCompletionHandler {
	return &InlineCompletionHandler{
		svc:    svc,
		logger: logger,
	}
}

// Complete returns one short completion chunk for prefix/suffix context.
func (h *InlineCompletionHandler) Complete(c *gin.Context) {
	var req inlineCompletionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Guardrails: prevent huge payloads from affecting tail latency.
	req.Mode = strings.ToLower(strings.TrimSpace(req.Mode))
	req.Language = strings.ToLower(strings.TrimSpace(req.Language))
	if req.Mode != "" && req.Mode != "code" && req.Mode != "prose" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid completion mode"})
		return
	}
	if len(req.Prefix) > 12000 || len(req.Suffix) > 6000 || len(req.ContextSummary) > 5000 || len(req.Language) > 48 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "inline payload too large"})
		return
	}

	completion, err := h.svc.Complete(
		c.Request.Context(),
		req.Prefix,
		req.Suffix,
		req.ContextSummary,
		req.Mode,
		req.Language,
	)
	if err != nil {
		h.logger.Warn("inline completion failed",
			zap.Error(err),
			zap.Int("prefix_len", len(req.Prefix)),
			zap.Int("suffix_len", len(req.Suffix)),
		)
		c.JSON(http.StatusBadGateway, gin.H{"error": "inline completion unavailable"})
		return
	}

	c.JSON(http.StatusOK, inlineCompletionResponse{
		Completion: strings.TrimSpace(completion),
	})
}
