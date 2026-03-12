package middleware

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"pathmind-server/internal/observability"
)

type AgentMetricsRecordFunc func(
	scope string,
	route string,
	agentName string,
	workspaceID string,
	status int,
	latency time.Duration,
)

func AgentMetricsMiddleware(scope string, recordFn AgentMetricsRecordFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}

		agentName := "unknown"
		if rawAgent, exists := c.Get("agent_name"); exists {
			if parsed, ok := rawAgent.(string); ok && parsed != "" {
				agentName = parsed
			}
		}

		workspaceID := "default"
		if rawWorkspace, exists := c.Get("workspace_id"); exists {
			if parsed, ok := rawWorkspace.(string); ok && parsed != "" {
				workspaceID = parsed
			}
		}

		if workspaceID == "default" {
			if principal, exists := c.Get("user_id"); exists {
				workspaceID = fmt.Sprintf("user:%v", principal)
			}
		}

		latency := time.Since(start)
		statusCode := c.Writer.Status()

		observability.RecordAgentRequestWithDimensions(
			scope,
			route,
			agentName,
			workspaceID,
			statusCode,
			latency,
		)
		if recordFn != nil {
			recordFn(
				scope,
				route,
				agentName,
				workspaceID,
				statusCode,
				latency,
			)
		}
	}
}
