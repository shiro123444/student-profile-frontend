package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// SandboxHandler handles code execution sandbox endpoints.
// NOTE: These are interface stubs. The actual implementation will integrate
// with the user's own OJ (Online Judge) system.
type SandboxHandler struct {
	logger *zap.Logger
}

// NewSandboxHandler creates a new SandboxHandler
func NewSandboxHandler(logger *zap.Logger) *SandboxHandler {
	return &SandboxHandler{logger: logger}
}

// Execute runs code in a sandbox (stub - to be replaced by OJ integration)
func (h *SandboxHandler) Execute(c *gin.Context) {
	var req struct {
		Code     string `json:"code" binding:"required"`
		Language string `json:"language" binding:"required"`
		Timeout  int    `json:"timeout,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// TODO: Forward to OJ system
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "sandbox not yet integrated",
		"message": "代码执行沙箱尚未接入，请等待 OJ 系统集成",
	})
}

// GetResult retrieves the result of a sandbox execution (stub)
func (h *SandboxHandler) GetResult(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "sandbox not yet integrated"})
}

// ListLanguages returns supported programming languages
func (h *SandboxHandler) ListLanguages(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"languages": []map[string]string{
			{"id": "python", "name": "Python 3.12", "extension": ".py"},
			{"id": "go", "name": "Go 1.22", "extension": ".go"},
			{"id": "javascript", "name": "Node.js 20", "extension": ".js"},
			{"id": "java", "name": "OpenJDK 21", "extension": ".java"},
			{"id": "cpp", "name": "C++ 17", "extension": ".cpp"},
		},
	})
}
