package handler

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"pathmind-server/internal/observability"
	"pathmind-server/internal/service"
)

// AgentHandler proxies agent requests to the Python service
type AgentHandler struct {
	agentProxy         *service.AgentProxyService
	metricsHistory     *service.AgentMetricsHistoryService
	graphBatchTimeline *service.GraphBatchTimelineService
	logger             *zap.Logger
}

type aiDispatchStreamPayload struct {
	TaskType        string                 `json:"task_type"`
	Priority        string                 `json:"priority"`
	CacheKey        string                 `json:"cache_key"`
	AgentName       string                 `json:"agent_name"`
	Prompt          string                 `json:"prompt"`
	StudentID       string                 `json:"student_id"`
	Context         map[string]interface{} `json:"context"`
	Role            string                 `json:"role"`
	SessionID       string                 `json:"session_id"`
	ContextSnapshot map[string]interface{} `json:"context_snapshot"`
}

// NewAgentHandler creates a new AgentHandler
func NewAgentHandler(
	agentProxy *service.AgentProxyService,
	metricsHistory *service.AgentMetricsHistoryService,
	graphBatchTimeline *service.GraphBatchTimelineService,
	logger *zap.Logger,
) *AgentHandler {
	return &AgentHandler{
		agentProxy:         agentProxy,
		metricsHistory:     metricsHistory,
		graphBatchTimeline: graphBatchTimeline,
		logger:             logger,
	}
}

func statusCodeForAgentError(err error) int {
	if errors.Is(err, service.ErrAgentServiceUnavailable) {
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}

func getStudentIDFromContext(c *gin.Context) string {
	if userID, exists := c.Get("user_id"); exists {
		return fmt.Sprintf("%v", userID)
	}
	return ""
}

func parseMapValue(raw interface{}) (map[string]interface{}, bool) {
	parsed, ok := raw.(map[string]interface{})
	return parsed, ok && parsed != nil
}

func extractWorkspaceID(ctx map[string]interface{}) string {
	if ctx == nil {
		return ""
	}
	if tenantRaw, exists := ctx["_tenant"]; exists {
		if tenantMap, ok := parseMapValue(tenantRaw); ok {
			if workspaceRaw, ok := tenantMap["workspace_id"]; ok {
				if workspaceID, ok := workspaceRaw.(string); ok {
					return strings.TrimSpace(workspaceID)
				}
			}
		}
	}
	if runtimeRaw, exists := ctx["_runtime"]; exists {
		if runtimeMap, ok := parseMapValue(runtimeRaw); ok {
			if codingRaw, exists := runtimeMap["coding"]; exists {
				if codingMap, ok := parseMapValue(codingRaw); ok {
					if workspaceRaw, exists := codingMap["workspace_id"]; exists {
						if workspaceID, ok := workspaceRaw.(string); ok {
							return strings.TrimSpace(workspaceID)
						}
					}
				}
			}
		}
	}
	return ""
}

func annotateAgentTelemetryContext(c *gin.Context, agentName string, ctx map[string]interface{}) {
	name := strings.TrimSpace(agentName)
	if name == "" {
		name = "auto"
	}
	c.Set("agent_name", name)

	if workspaceID := extractWorkspaceID(ctx); workspaceID != "" {
		c.Set("workspace_id", workspaceID)
	}
}

// Query handles synchronous agent queries
func (h *AgentHandler) Query(c *gin.Context) {
	var req service.AgentQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.StudentID == "" {
		req.StudentID = getStudentIDFromContext(c)
	}
	annotateAgentTelemetryContext(c, req.AgentName, req.Context)

	result, err := h.agentProxy.Query(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Agent query failed", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// StreamQuery handles streaming agent queries via SSE
func (h *AgentHandler) StreamQuery(c *gin.Context) {
	var req service.AgentQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.StudentID == "" {
		req.StudentID = getStudentIDFromContext(c)
	}
	annotateAgentTelemetryContext(c, req.AgentName, req.Context)

	body, err := h.agentProxy.StreamQuery(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Agent stream failed", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}
	defer body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, _ := c.Writer.(http.Flusher)

	scanner := bufio.NewScanner(body)
	c.Stream(func(w io.Writer) bool {
		if scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				w.Write([]byte(line + "\n"))
			} else {
				w.Write([]byte("\n"))
				if flusher != nil {
					flusher.Flush()
				}
			}
			return true
		}
		return false
	})
}

// DispatchStream routes task-typed AI stream requests with backend-enforced routing policy.
func (h *AgentHandler) DispatchStream(c *gin.Context) {
	var req aiDispatchStreamPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prompt required"})
		return
	}

	if req.StudentID == "" {
		req.StudentID = getStudentIDFromContext(c)
	}
	annotateAgentTelemetryContext(c, req.AgentName, req.Context)

	proxyReq := service.AIDispatchStreamRequest{
		TaskType:        strings.TrimSpace(req.TaskType),
		Priority:        strings.TrimSpace(req.Priority),
		CacheKey:        strings.TrimSpace(req.CacheKey),
		AgentName:       strings.TrimSpace(req.AgentName),
		Prompt:          req.Prompt,
		StudentID:       req.StudentID,
		Context:         req.Context,
		Role:            strings.TrimSpace(req.Role),
		SessionID:       strings.TrimSpace(req.SessionID),
		ContextSnapshot: req.ContextSnapshot,
	}
	if proxyReq.TaskType == "" {
		proxyReq.TaskType = "summary"
	}
	if proxyReq.Role == "" {
		proxyReq.Role = "student"
	}

	body, err := h.agentProxy.StreamDispatch(c.Request.Context(), proxyReq)
	if err != nil {
		h.logger.Error("AI dispatch stream failed", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}
	defer body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, _ := c.Writer.(http.Flusher)
	scanner := bufio.NewScanner(body)
	c.Stream(func(w io.Writer) bool {
		if scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				w.Write([]byte(line + "\n"))
			} else {
				w.Write([]byte("\n"))
				if flusher != nil {
					flusher.Flush()
				}
			}
			return true
		}
		return false
	})
}

// GetDispatchMetrics returns dispatcher metrics snapshot from Python service.
func (h *AgentHandler) GetDispatchMetrics(c *gin.Context) {
	result, err := h.agentProxy.GetDispatchMetrics(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to fetch dispatch metrics", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ListAgents returns available agent definitions
func (h *AgentHandler) ListAgents(c *gin.Context) {
	agents, err := h.agentProxy.ListAgents(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to list agents", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": "failed to list agents"})
		return
	}

	if agents == nil {
		agents = []service.AgentInfo{}
	}

	c.JSON(http.StatusOK, agents)
}

// GetAgentCapabilities returns capabilities of one agent.
func (h *AgentHandler) GetAgentCapabilities(c *gin.Context) {
	agentName := c.Param("name")
	if agentName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent name required"})
		return
	}
	c.Set("agent_name", agentName)

	capability, err := h.agentProxy.GetAgentCapabilities(c.Request.Context(), agentName)
	if err != nil {
		h.logger.Error("Failed to get agent capabilities", zap.String("agent", agentName), zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": "failed to get agent capabilities"})
		return
	}

	c.JSON(http.StatusOK, capability)
}

// ListSessions returns the user's recent sessions.
func (h *AgentHandler) ListSessions(c *gin.Context) {
	studentID := getStudentIDFromContext(c)
	if studentID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	sessions, err := h.agentProxy.ListSessions(c.Request.Context(), studentID, 20)
	if err != nil {
		h.logger.Error("Failed to list sessions", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": "failed to list sessions"})
		return
	}

	if sessions == nil {
		sessions = []service.AgentSessionInfo{}
	}
	c.JSON(http.StatusOK, sessions)
}

// ClearSessions clears one session or all sessions for the user.
func (h *AgentHandler) ClearSessions(c *gin.Context) {
	studentID := getStudentIDFromContext(c)
	if studentID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	sessionID := c.Query("session_id")
	result, err := h.agentProxy.ClearSessions(c.Request.Context(), studentID, sessionID)
	if err != nil {
		h.logger.Error("Failed to clear sessions", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": "failed to clear sessions"})
		return
	}

	c.JSON(http.StatusOK, result)
}

type approvalDecisionPayload struct {
	Reason string `json:"reason"`
}

type taskTemplateStartPayload struct {
	TaskType    string                 `json:"task_type"`
	Label       string                 `json:"label"`
	Prompt      string                 `json:"prompt"`
	StudentID   string                 `json:"student_id"`
	WorkspaceID string                 `json:"workspace_id"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ApprovePendingAction approves one pending tool action request.
func (h *AgentHandler) ApprovePendingAction(c *gin.Context) {
	requestID := c.Param("id")
	if requestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "request id required"})
		return
	}

	var payload approvalDecisionPayload
	_ = c.ShouldBindJSON(&payload)

	result, err := h.agentProxy.ApprovePendingAction(c.Request.Context(), requestID, payload.Reason)
	if err != nil {
		h.logger.Error("Failed to approve pending action", zap.String("request_id", requestID), zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// RejectPendingAction rejects one pending tool action request.
func (h *AgentHandler) RejectPendingAction(c *gin.Context) {
	requestID := c.Param("id")
	if requestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "request id required"})
		return
	}

	var payload approvalDecisionPayload
	_ = c.ShouldBindJSON(&payload)

	result, err := h.agentProxy.RejectPendingAction(c.Request.Context(), requestID, payload.Reason)
	if err != nil {
		h.logger.Error("Failed to reject pending action", zap.String("request_id", requestID), zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetApprovalMetrics returns approval queue/decision metrics from Python service.
func (h *AgentHandler) GetApprovalMetrics(c *gin.Context) {
	result, err := h.agentProxy.GetApprovalMetrics(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to fetch approval metrics", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetCodingPolicyProfiles returns coding policy profile snapshot from Python service.
func (h *AgentHandler) GetCodingPolicyProfiles(c *gin.Context) {
	result, err := h.agentProxy.GetCodingPolicyProfiles(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to fetch coding policy profiles", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ListTaskTemplates returns task template catalog for AIAdvisor launcher.
func (h *AgentHandler) ListTaskTemplates(c *gin.Context) {
	result, err := h.agentProxy.ListTaskTemplates(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to fetch task templates", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// StartTaskTemplate starts one task template run.
func (h *AgentHandler) StartTaskTemplate(c *gin.Context) {
	var payload taskTemplateStartPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	taskType := strings.TrimSpace(payload.TaskType)
	if taskType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_type required"})
		return
	}

	if strings.TrimSpace(payload.StudentID) == "" {
		payload.StudentID = getStudentIDFromContext(c)
	}
	if strings.TrimSpace(payload.StudentID) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	result, err := h.agentProxy.StartTaskTemplate(c.Request.Context(), service.TaskTemplateStartRequest{
		TaskType:    taskType,
		Label:       strings.TrimSpace(payload.Label),
		Prompt:      strings.TrimSpace(payload.Prompt),
		StudentID:   strings.TrimSpace(payload.StudentID),
		WorkspaceID: strings.TrimSpace(payload.WorkspaceID),
		Metadata:    payload.Metadata,
	})
	if err != nil {
		h.logger.Error("Failed to start task template", zap.String("task_type", taskType), zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ReportGraphCommandFeedback ingests graph command execution feedback from frontend.
func (h *AgentHandler) ReportGraphCommandFeedback(c *gin.Context) {
	var req service.GraphCommandFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.StudentID == "" {
		req.StudentID = getStudentIDFromContext(c)
	}
	if req.StudentID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if req.AgentName == "" {
		req.AgentName = "graph-analyst"
	}
	if req.Source == "" {
		req.Source = "graph_page"
	}
	if len(req.Items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "items required"})
		return
	}

	annotateAgentTelemetryContext(c, req.AgentName, nil)

	result, err := h.agentProxy.ReportGraphCommandFeedback(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Failed to report graph command feedback", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetGraphCommandFeedback returns persisted graph command execution timeline.
func (h *AgentHandler) GetGraphCommandFeedback(c *gin.Context) {
	studentID := getStudentIDFromContext(c)
	if studentID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	agentName := strings.TrimSpace(c.Query("agent"))
	if agentName == "" {
		agentName = "graph-analyst"
	}
	sessionID := strings.TrimSpace(c.Query("session_id"))
	status := strings.TrimSpace(c.Query("status"))
	command := strings.TrimSpace(c.Query("command"))
	limit := 50
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
			return
		}
		limit = parsed
	}

	annotateAgentTelemetryContext(c, agentName, nil)

	result, err := h.agentProxy.ListGraphCommandFeedback(
		c.Request.Context(),
		studentID,
		agentName,
		sessionID,
		status,
		command,
		limit,
	)
	if err != nil {
		h.logger.Error("Failed to list graph command feedback", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ReportGraphBatchFeedback ingests graph batch execution feedback from frontend.
func (h *AgentHandler) ReportGraphBatchFeedback(c *gin.Context) {
	var req service.GraphBatchFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.StudentID == "" {
		req.StudentID = getStudentIDFromContext(c)
	}
	if req.StudentID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if req.AgentName == "" {
		req.AgentName = "graph-analyst"
	}
	if req.Source == "" {
		req.Source = "graph_page"
	}
	if strings.TrimSpace(req.Item.BatchID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "item.batch_id required"})
		return
	}

	annotateAgentTelemetryContext(c, req.AgentName, nil)

	result, err := h.agentProxy.ReportGraphBatchFeedback(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Failed to report graph batch feedback", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetGraphBatchFeedback returns persisted graph batch execution timeline.
func (h *AgentHandler) GetGraphBatchFeedback(c *gin.Context) {
	studentID := getStudentIDFromContext(c)
	if studentID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	agentName := strings.TrimSpace(c.Query("agent"))
	if agentName == "" {
		agentName = "graph-analyst"
	}
	sessionID := strings.TrimSpace(c.Query("session_id"))
	status := strings.TrimSpace(c.Query("status"))
	var beforeTS int64
	if rawBefore := strings.TrimSpace(c.Query("before_ts")); rawBefore != "" {
		parsed, err := strconv.ParseInt(rawBefore, 10, 64)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid before_ts"})
			return
		}
		beforeTS = parsed
	}
	limit := 50
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
			return
		}
		limit = parsed
	}

	annotateAgentTelemetryContext(c, agentName, nil)

	if h.graphBatchTimeline != nil {
		pgResult, err := h.graphBatchTimeline.List(
			c.Request.Context(),
			service.GraphBatchTimelineQuery{
				StudentID: studentID,
				AgentName: agentName,
				SessionID: sessionID,
				Status:    status,
				BeforeTS:  beforeTS,
				Limit:     limit,
			},
		)
		if err != nil {
			h.logger.Warn("Postgres graph batch timeline query failed; fallback to redis proxy",
				zap.Error(err),
				zap.String("student_id", studentID),
				zap.String("agent", agentName),
				zap.String("session_id", sessionID),
			)
		} else if pgResult.Total > 0 || beforeTS > 0 {
			c.JSON(http.StatusOK, pgResult)
			return
		}
	}

	result, err := h.agentProxy.ListGraphBatchFeedback(
		c.Request.Context(),
		studentID,
		agentName,
		sessionID,
		status,
		beforeTS,
		limit,
	)
	if err != nil {
		h.logger.Error("Failed to list graph batch feedback", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}
	if result != nil && strings.TrimSpace(result.Source) == "" {
		result.Source = "redis"
	}

	c.JSON(http.StatusOK, result)
}

// ListTools returns available tool definitions from the Python service
func (h *AgentHandler) ListTools(c *gin.Context) {
	tools, err := h.agentProxy.ListTools(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to list tools", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": "failed to list tools"})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", tools)
}

// ListSkills returns available skill workflows from the Python service
func (h *AgentHandler) ListSkills(c *gin.Context) {
	skills, err := h.agentProxy.ListSkills(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to list skills", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": "failed to list skills"})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", skills)
}

// ExecuteSkill runs a skill workflow via the Python service
func (h *AgentHandler) ExecuteSkill(c *gin.Context) {
	var req service.SkillExecuteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.Role == "" {
		req.Role = "student"
	}

	result, err := h.agentProxy.ExecuteSkill(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Skill execution failed", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", result)
}

// PublicStreamQuery handles streaming for the homepage chat (no auth).
// Only allows quick-qa and homepage-guide agents.
func (h *AgentHandler) PublicStreamQuery(c *gin.Context) {
	var req service.AgentQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	allowed := map[string]bool{"quick-qa": true, "homepage-guide": true}
	if req.AgentName == "" {
		req.AgentName = "quick-qa"
	}
	if !allowed[req.AgentName] {
		c.JSON(http.StatusForbidden, gin.H{"error": "agent not available for public access"})
		return
	}

	req.Role = "guest"
	annotateAgentTelemetryContext(c, req.AgentName, req.Context)

	body, err := h.agentProxy.StreamQuery(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Public agent stream failed", zap.Error(err))
		c.JSON(statusCodeForAgentError(err), gin.H{"error": err.Error()})
		return
	}
	defer body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, _ := c.Writer.(http.Flusher)

	scanner := bufio.NewScanner(body)
	c.Stream(func(w io.Writer) bool {
		if scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				w.Write([]byte(line + "\n"))
			} else {
				w.Write([]byte("\n"))
				if flusher != nil {
					flusher.Flush()
				}
			}
			return true
		}
		return false
	})
}

// GetMetrics returns in-memory agent gateway metrics snapshot.
func (h *AgentHandler) GetMetrics(c *gin.Context) {
	agentName := strings.TrimSpace(c.Query("agent"))
	workspaceID := strings.TrimSpace(c.Query("workspace"))

	var windowSec int64
	if rawWindow := strings.TrimSpace(c.Query("window_sec")); rawWindow != "" {
		parsed, err := strconv.ParseInt(rawWindow, 10, 64)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid window_sec"})
			return
		}
		windowSec = parsed
	}

	snapshot := observability.GetAgentMetricsSnapshotFiltered(agentName, workspaceID, windowSec)
	c.JSON(http.StatusOK, snapshot)
}

// GetMetricsHistory returns persisted agent gateway metrics history from PostgreSQL.
func (h *AgentHandler) GetMetricsHistory(c *gin.Context) {
	if h.metricsHistory == nil {
		c.JSON(http.StatusOK, gin.H{
			"enabled": false,
			"points":  []interface{}{},
		})
		return
	}

	agentName := strings.TrimSpace(c.Query("agent"))
	workspaceID := strings.TrimSpace(c.Query("workspace"))
	scope := strings.TrimSpace(c.Query("scope"))

	var windowSec int64
	if rawWindow := strings.TrimSpace(c.Query("window_sec")); rawWindow != "" {
		parsed, err := strconv.ParseInt(rawWindow, 10, 64)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid window_sec"})
			return
		}
		windowSec = parsed
	}

	var bucketSec int64
	if rawBucket := strings.TrimSpace(c.Query("bucket_sec")); rawBucket != "" {
		parsed, err := strconv.ParseInt(rawBucket, 10, 64)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bucket_sec"})
			return
		}
		bucketSec = parsed
	}

	result, err := h.metricsHistory.Query(c.Request.Context(), service.AgentMetricsHistoryQuery{
		Scope:       scope,
		AgentName:   agentName,
		WorkspaceID: workspaceID,
		WindowSec:   windowSec,
		BucketSec:   bucketSec,
	})
	if err != nil {
		h.logger.Error("Failed to query metrics history", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query metrics history"})
		return
	}

	c.JSON(http.StatusOK, result)
}
