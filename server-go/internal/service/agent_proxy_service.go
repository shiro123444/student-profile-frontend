package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"go.uber.org/zap"
	"pathmind-server/internal/config"
	"pathmind-server/internal/observability"
)

var ErrAgentServiceUnavailable = errors.New("agent service temporarily unavailable")

type circuitState string

const (
	circuitClosed   circuitState = "closed"
	circuitOpen     circuitState = "open"
	circuitHalfOpen circuitState = "half_open"
)

type agentCircuitBreaker struct {
	mu sync.Mutex

	state                 circuitState
	consecutiveFailures   int
	openedAt              time.Time
	halfOpenProbeInFlight bool

	failureThreshold int
	openInterval     time.Duration
}

func newAgentCircuitBreaker(failureThreshold int, openInterval time.Duration) *agentCircuitBreaker {
	if failureThreshold <= 0 {
		failureThreshold = 5
	}
	if openInterval <= 0 {
		openInterval = 20 * time.Second
	}
	cb := &agentCircuitBreaker{
		state:            circuitClosed,
		failureThreshold: failureThreshold,
		openInterval:     openInterval,
	}
	observability.RecordCircuitState(string(cb.state))
	return cb
}

func (cb *agentCircuitBreaker) setStateLocked(next circuitState) {
	if cb.state == next {
		return
	}
	cb.state = next
	observability.RecordCircuitState(string(next))
}

func (cb *agentCircuitBreaker) allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()
	switch cb.state {
	case circuitClosed:
		return true
	case circuitOpen:
		if now.Sub(cb.openedAt) >= cb.openInterval {
			cb.setStateLocked(circuitHalfOpen)
			cb.halfOpenProbeInFlight = true
			return true
		}
		return false
	case circuitHalfOpen:
		if cb.halfOpenProbeInFlight {
			return false
		}
		cb.halfOpenProbeInFlight = true
		return true
	default:
		return false
	}
}

func (cb *agentCircuitBreaker) onSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.consecutiveFailures = 0
	cb.halfOpenProbeInFlight = false
	cb.setStateLocked(circuitClosed)
}

func (cb *agentCircuitBreaker) onFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case circuitHalfOpen:
		cb.setStateLocked(circuitOpen)
		cb.openedAt = time.Now()
		cb.halfOpenProbeInFlight = false
		cb.consecutiveFailures = cb.failureThreshold
		return
	case circuitOpen:
		cb.openedAt = time.Now()
		cb.halfOpenProbeInFlight = false
		return
	default:
		cb.consecutiveFailures++
		if cb.consecutiveFailures >= cb.failureThreshold {
			cb.setStateLocked(circuitOpen)
			cb.openedAt = time.Now()
			cb.halfOpenProbeInFlight = false
		}
	}
}

// AgentProxyService forwards requests to the Python Agent Service
type AgentProxyService struct {
	baseURL      string
	httpClient   *http.Client
	streamClient *http.Client
	breaker      *agentCircuitBreaker
	logger       *zap.Logger
}

// AgentQueryRequest is the request sent to the Python service
type AgentQueryRequest struct {
	AgentName string                 `json:"agent_name,omitempty"`
	Prompt    string                 `json:"prompt"`
	StudentID string                 `json:"student_id,omitempty"`
	Context   map[string]interface{} `json:"context,omitempty"`
	Role      string                 `json:"role,omitempty"`
	SessionID string                 `json:"session_id,omitempty"`
}

// AIDispatchStreamRequest routes request by task type to proper engine/runtime.
type AIDispatchStreamRequest struct {
	TaskType        string                 `json:"task_type"`
	Priority        string                 `json:"priority,omitempty"`
	CacheKey        string                 `json:"cache_key,omitempty"`
	AgentName       string                 `json:"agent_name,omitempty"`
	Prompt          string                 `json:"prompt"`
	StudentID       string                 `json:"student_id,omitempty"`
	Context         map[string]interface{} `json:"context,omitempty"`
	Role            string                 `json:"role,omitempty"`
	SessionID       string                 `json:"session_id,omitempty"`
	ContextSnapshot map[string]interface{} `json:"context_snapshot,omitempty"`
}

// AIDispatchMetricsResponse is in-memory dispatch telemetry snapshot from Python service.
type AIDispatchMetricsResponse struct {
	StartedAt       int64                           `json:"started_at"`
	GeneratedAt     int64                           `json:"generated_at"`
	RequestsTotal   int64                           `json:"requests_total"`
	CacheHitTotal   int64                           `json:"cache_hit_total"`
	CacheHitRate    float64                         `json:"cache_hit_rate"`
	FallbackTotal   int64                           `json:"fallback_total"`
	FallbackRate    float64                         `json:"fallback_rate"`
	QPS60s          float64                         `json:"qps_60s"`
	FallbackRate60s float64                         `json:"fallback_rate_60s"`
	Buckets         map[string]map[string]any       `json:"buckets"`
}

// AgentQueryResponse is the response from the Python service
type AgentQueryResponse struct {
	Response         string      `json:"response"`
	StructuredOutput interface{} `json:"structured_output,omitempty"`
	AgentUsed        string      `json:"agent_used"`
	EngineUsed       string      `json:"engine_used,omitempty"`
	ModelUsed        string      `json:"model_used,omitempty"`
	ModeUsed         string      `json:"mode_used,omitempty"`
	OutputFormatUsed string      `json:"output_format_used,omitempty"`
	Orchestrator     interface{} `json:"orchestrator,omitempty"`
	Tenant           interface{} `json:"tenant,omitempty"`
	CostUSD          float64     `json:"cost_usd"`
	InputTokens      int         `json:"input_tokens"`
	OutputTokens     int         `json:"output_tokens"`
}

// AgentInfo describes an available agent
type AgentInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Model       string `json:"model"`
	Engine      string `json:"engine,omitempty"`
	EngineModel string `json:"engine_model,omitempty"`
	ToolCount   int    `json:"tool_count,omitempty"`
}

// AgentCapability describes a detailed capability contract for one agent
// and is used by frontend routing/capability pages.
type AgentCapability struct {
	Name                 string   `json:"name"`
	Description          string   `json:"description"`
	Model                string   `json:"model"`
	Engine               string   `json:"engine"`
	EngineModel          string   `json:"engine_model,omitempty"`
	ToolCount            int      `json:"tool_count"`
	Tools                []string `json:"tools"`
	RuntimeModes         []string `json:"runtime_modes"`
	SupportsOrchestrator bool     `json:"supports_orchestrator"`
	SupportsStreaming    bool     `json:"supports_streaming"`
}

// AgentSessionInfo describes one resumable/clearable session
type AgentSessionInfo struct {
	SessionID         string  `json:"session_id"`
	AgentName         string  `json:"agent_name,omitempty"`
	Engine            string  `json:"engine,omitempty"`
	Model             string  `json:"model,omitempty"`
	Mode              string  `json:"mode,omitempty"`
	LastPrompt        string  `json:"last_prompt,omitempty"`
	LastSummary       string  `json:"last_summary,omitempty"`
	TotalCostUSD      float64 `json:"total_cost_usd,omitempty"`
	TotalInputTokens  int     `json:"total_input_tokens,omitempty"`
	TotalOutputTokens int     `json:"total_output_tokens,omitempty"`
	UpdatedAt         int64   `json:"updated_at,omitempty"`
}

// ClearSessionsResponse describes clear result
type ClearSessionsResponse struct {
	OK        bool   `json:"ok"`
	Cleared   int    `json:"cleared"`
	SessionID string `json:"session_id,omitempty"`
}

// ApprovalDecisionRequest forwards user approval decision to Python agent service.
type ApprovalDecisionRequest struct {
	Reason string `json:"reason,omitempty"`
}

// ApprovalDecisionResponse describes approval decision result.
type ApprovalDecisionResponse struct {
	OK        bool   `json:"ok"`
	RequestID string `json:"request_id"`
	Approved  bool   `json:"approved"`
	Reason    string `json:"reason,omitempty"`
}

// ApprovalMetricsResponse describes aggregated approval metrics from Python service.
type ApprovalMetricsResponse struct {
	Pending       int     `json:"pending"`
	TotalRequests int     `json:"total_requests"`
	Approved      int     `json:"approved"`
	Rejected      int     `json:"rejected"`
	TimedOut      int     `json:"timed_out"`
	AvgWaitMs     float64 `json:"avg_wait_ms"`
}

// CodingPolicyProfilesResponse describes coding policy template snapshot.
type CodingPolicyProfilesResponse struct {
	Enabled        bool                   `json:"enabled"`
	ConfigPath     string                 `json:"config_path"`
	DefaultProfile string                 `json:"default_profile"`
	SourceVersion  string                 `json:"source_version"`
	Profiles       map[string]interface{} `json:"profiles"`
	Errors         []string               `json:"errors"`
}

// TaskTemplateStep describes one contract step in a task template.
type TaskTemplateStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Module string `json:"module"`
	Action string `json:"action,omitempty"`
	Risk   string `json:"risk,omitempty"`
}

// TaskTemplateReceiptSchema describes receipt schema metadata.
type TaskTemplateReceiptSchema struct {
	Version string   `json:"version,omitempty"`
	Fields  []string `json:"fields,omitempty"`
}

// TaskTemplateItem describes one task template.
type TaskTemplateItem struct {
	TaskType      string                    `json:"task_type"`
	Label         string                    `json:"label"`
	Description   string                    `json:"description,omitempty"`
	TargetAgent   string                    `json:"target_agent,omitempty"`
	DefaultPrompt string                    `json:"default_prompt,omitempty"`
	RiskLevel     string                    `json:"risk_level,omitempty"`
	Tags          []string                  `json:"tags,omitempty"`
	Steps         []TaskTemplateStep        `json:"steps,omitempty"`
	ReceiptSchema TaskTemplateReceiptSchema `json:"receipt_schema,omitempty"`
}

// TaskTemplateListResponse is task template catalog response.
type TaskTemplateListResponse struct {
	Templates []TaskTemplateItem `json:"templates"`
	Source    string             `json:"source,omitempty"`
}

// TaskTemplateStartRequest is start request payload forwarded to Python.
type TaskTemplateStartRequest struct {
	TaskType    string                 `json:"task_type"`
	Label       string                 `json:"label,omitempty"`
	Prompt      string                 `json:"prompt,omitempty"`
	StudentID   string                 `json:"student_id,omitempty"`
	WorkspaceID string                 `json:"workspace_id,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// TaskTemplateStartResponse is start response payload.
type TaskTemplateStartResponse struct {
	OK        bool   `json:"ok"`
	RunID     string `json:"run_id"`
	TaskType  string `json:"task_type"`
	Label     string `json:"label,omitempty"`
	StartedAt int64  `json:"started_at"`
	Source    string `json:"source,omitempty"`
}

// GraphCommandFeedbackItem describes one graph command execution feedback row.
type GraphCommandFeedbackItem struct {
	Command    string                 `json:"command"`
	Target     string                 `json:"target,omitempty"`
	Status     string                 `json:"status,omitempty"`
	Success    *bool                  `json:"success,omitempty"`
	Message    string                 `json:"message,omitempty"`
	IssuedAt   int64                  `json:"issued_at,omitempty"`
	ExecutedAt int64                  `json:"executed_at,omitempty"`
	Params     map[string]interface{} `json:"params,omitempty"`
}

// GraphCommandFeedbackRequest is sent to Python to ingest frontend graph ACK.
type GraphCommandFeedbackRequest struct {
	StudentID string                     `json:"student_id,omitempty"`
	AgentName string                     `json:"agent_name,omitempty"`
	SessionID string                     `json:"session_id,omitempty"`
	Source    string                     `json:"source,omitempty"`
	Items     []GraphCommandFeedbackItem `json:"items"`
}

// GraphCommandFeedbackResponse acknowledges feedback ingest.
type GraphCommandFeedbackResponse struct {
	OK        bool   `json:"ok"`
	Accepted  int    `json:"accepted"`
	StudentID string `json:"student_id,omitempty"`
	AgentName string `json:"agent_name,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// GraphCommandFeedbackListResponse is a timeline-style feedback query result.
type GraphCommandFeedbackListResponse struct {
	OK        bool                       `json:"ok"`
	Total     int                        `json:"total"`
	StudentID string                     `json:"student_id,omitempty"`
	AgentName string                     `json:"agent_name,omitempty"`
	SessionID string                     `json:"session_id,omitempty"`
	Status    string                     `json:"status,omitempty"`
	Command   string                     `json:"command,omitempty"`
	Items     []GraphCommandFeedbackItem `json:"items"`
}

// GraphBatchFeedbackItem describes one graph batch execution receipt row.
type GraphBatchFeedbackItem struct {
	BatchID        string `json:"batch_id"`
	Mode           string `json:"mode,omitempty"`
	Status         string `json:"status,omitempty"`
	Completed      int    `json:"completed,omitempty"`
	Total          int    `json:"total,omitempty"`
	RolledBack     int    `json:"rolled_back,omitempty"`
	RollbackFailed int    `json:"rollback_failed,omitempty"`
	Message        string `json:"message,omitempty"`
	StartedAt      int64  `json:"started_at,omitempty"`
	FinishedAt     int64  `json:"finished_at,omitempty"`
}

// GraphBatchFeedbackRequest is sent to Python to ingest batch-level graph ACK.
type GraphBatchFeedbackRequest struct {
	StudentID string                 `json:"student_id,omitempty"`
	AgentName string                 `json:"agent_name,omitempty"`
	SessionID string                 `json:"session_id,omitempty"`
	Source    string                 `json:"source,omitempty"`
	Item      GraphBatchFeedbackItem `json:"item"`
}

// GraphBatchFeedbackResponse acknowledges batch feedback ingest.
type GraphBatchFeedbackResponse struct {
	OK        bool   `json:"ok"`
	Accepted  int    `json:"accepted"`
	StudentID string `json:"student_id,omitempty"`
	AgentName string `json:"agent_name,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	BatchID   string `json:"batch_id,omitempty"`
}

// GraphBatchFeedbackListResponse is a timeline-style batch feedback query result.
type GraphBatchFeedbackListResponse struct {
	OK           bool                     `json:"ok"`
	Total        int                      `json:"total"`
	StudentID    string                   `json:"student_id,omitempty"`
	AgentName    string                   `json:"agent_name,omitempty"`
	SessionID    string                   `json:"session_id,omitempty"`
	Status       string                   `json:"status,omitempty"`
	Source       string                   `json:"source,omitempty"`
	NextBeforeTS *int64                   `json:"next_before_ts,omitempty"`
	Items        []GraphBatchFeedbackItem `json:"items"`
}

// NewAgentProxyService creates a new AgentProxyService
func NewAgentProxyService(agentCfg config.AgentServiceConfig, logger *zap.Logger) *AgentProxyService {
	requestTimeoutSec := safeInt(agentCfg.RequestTimeoutSec, 120)
	responseHeaderTimeoutSec := safeInt(agentCfg.ResponseHeaderTimeoutSec, 30)
	streamHeaderTimeoutSec := safeInt(agentCfg.StreamHeaderTimeoutSec, 45)
	maxIdleConns := safeInt(agentCfg.MaxIdleConns, 200)
	maxIdleConnsPerHost := safeInt(agentCfg.MaxIdleConnsPerHost, 50)
	idleConnTimeoutSec := safeInt(agentCfg.IdleConnTimeoutSec, 90)
	breakerFailures := safeInt(agentCfg.CircuitBreakerFailureThreshold, 5)
	breakerOpenSec := safeInt(agentCfg.CircuitBreakerOpenSec, 20)

	baseTransport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          maxIdleConns,
		MaxIdleConnsPerHost:   maxIdleConnsPerHost,
		IdleConnTimeout:       time.Duration(idleConnTimeoutSec) * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: time.Duration(responseHeaderTimeoutSec) * time.Second,
	}

	streamTransport := baseTransport.Clone()
	streamTransport.ResponseHeaderTimeout = time.Duration(streamHeaderTimeoutSec) * time.Second

	return &AgentProxyService{
		baseURL: agentCfg.URL,
		httpClient: &http.Client{
			Timeout:   time.Duration(requestTimeoutSec) * time.Second,
			Transport: baseTransport,
		},
		streamClient: &http.Client{
			Timeout:   0,
			Transport: streamTransport,
		},
		breaker: newAgentCircuitBreaker(breakerFailures, time.Duration(breakerOpenSec)*time.Second),
		logger:  logger,
	}
}

func safeInt(v int, fallback int) int {
	if v <= 0 {
		return fallback
	}
	return v
}

func (s *AgentProxyService) doRequest(client *http.Client, req *http.Request) (*http.Response, error) {
	if !s.breaker.allow() {
		return nil, fmt.Errorf("%w: circuit breaker open", ErrAgentServiceUnavailable)
	}

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		s.breaker.onFailure()
		return nil, fmt.Errorf("%w: request failed: %v", ErrAgentServiceUnavailable, err)
	}

	if resp.StatusCode >= 500 {
		s.breaker.onFailure()
	} else {
		s.breaker.onSuccess()
	}

	return resp, nil
}

// Query sends a synchronous query to the Python agent service
func (s *AgentProxyService) Query(ctx context.Context, req AgentQueryRequest) (*AgentQueryResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+"/agent/query", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("agent service request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent service returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result AgentQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// StreamQuery sends a streaming query and returns the response body for SSE forwarding
func (s *AgentProxyService) StreamQuery(ctx context.Context, req AgentQueryRequest) (io.ReadCloser, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+"/agent/stream", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := s.doRequest(s.streamClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("agent service stream request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("agent service returned %d: %s", resp.StatusCode, string(respBody))
	}

	return resp.Body, nil
}

// StreamDispatch routes stream requests via Python ai/dispatch endpoint.
func (s *AgentProxyService) StreamDispatch(ctx context.Context, req AIDispatchStreamRequest) (io.ReadCloser, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal dispatch request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+"/ai/dispatch/stream", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create dispatch request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := s.doRequest(s.streamClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("dispatch stream request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("dispatch service returned %d: %s", resp.StatusCode, string(respBody))
	}

	return resp.Body, nil
}

// GetDispatchMetrics fetches in-memory dispatch telemetry from Python ai/dispatch route.
func (s *AgentProxyService) GetDispatchMetrics(ctx context.Context) (*AIDispatchMetricsResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", s.baseURL+"/ai/dispatch/metrics", nil)
	if err != nil {
		return nil, fmt.Errorf("create dispatch metrics request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("dispatch metrics request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("dispatch metrics returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result AIDispatchMetricsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode dispatch metrics response: %w", err)
	}
	if result.Buckets == nil {
		result.Buckets = map[string]map[string]any{}
	}
	return &result, nil
}

// ListAgents retrieves available agents from the Python service
func (s *AgentProxyService) ListAgents(ctx context.Context) ([]AgentInfo, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", s.baseURL+"/agent/list", nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("list agents failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list agents returned %d: %s", resp.StatusCode, string(respBody))
	}

	var agents []AgentInfo
	if err := json.NewDecoder(resp.Body).Decode(&agents); err != nil {
		return nil, err
	}

	return agents, nil
}

// GetAgentCapabilities retrieves detailed capabilities for one agent.
func (s *AgentProxyService) GetAgentCapabilities(ctx context.Context, agentName string) (*AgentCapability, error) {
	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/"+url.PathEscape(agentName)+"/capabilities",
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create capabilities request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("agent capabilities request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent capabilities returned %d: %s", resp.StatusCode, string(respBody))
	}

	var capability AgentCapability
	if err := json.NewDecoder(resp.Body).Decode(&capability); err != nil {
		return nil, fmt.Errorf("decode capabilities response: %w", err)
	}

	return &capability, nil
}

// ListSessions retrieves recent sessions for a student
func (s *AgentProxyService) ListSessions(ctx context.Context, studentID string, limit int) ([]AgentSessionInfo, error) {
	q := url.Values{}
	q.Set("student_id", studentID)
	if limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", limit))
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/sessions?"+q.Encode(),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create session list request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("list sessions failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("session list returned %d: %s", resp.StatusCode, string(respBody))
	}

	var sessions []AgentSessionInfo
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		return nil, fmt.Errorf("decode sessions response: %w", err)
	}

	return sessions, nil
}

// ClearSessions clears one session or all sessions for a student
func (s *AgentProxyService) ClearSessions(ctx context.Context, studentID, sessionID string) (*ClearSessionsResponse, error) {
	q := url.Values{}
	q.Set("student_id", studentID)
	if sessionID != "" {
		q.Set("session_id", sessionID)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"DELETE",
		s.baseURL+"/agent/sessions?"+q.Encode(),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create clear sessions request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("clear sessions failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("clear sessions returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result ClearSessionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode clear sessions response: %w", err)
	}

	return &result, nil
}

func (s *AgentProxyService) decideApproval(
	ctx context.Context,
	requestID string,
	approved bool,
	reason string,
) (*ApprovalDecisionResponse, error) {
	if requestID == "" {
		return nil, fmt.Errorf("request id required")
	}

	payload, err := json.Marshal(ApprovalDecisionRequest{Reason: reason})
	if err != nil {
		return nil, fmt.Errorf("marshal approval request: %w", err)
	}

	pathSeg := "reject"
	if approved {
		pathSeg = "approve"
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		s.baseURL+"/agent/approvals/"+url.PathEscape(requestID)+"/"+pathSeg,
		bytes.NewReader(payload),
	)
	if err != nil {
		return nil, fmt.Errorf("create approval request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("approval request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("approval request returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result ApprovalDecisionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode approval response: %w", err)
	}
	return &result, nil
}

// ApprovePendingAction approves one pending high-risk tool call.
func (s *AgentProxyService) ApprovePendingAction(ctx context.Context, requestID string, reason string) (*ApprovalDecisionResponse, error) {
	return s.decideApproval(ctx, requestID, true, reason)
}

// RejectPendingAction rejects one pending high-risk tool call.
func (s *AgentProxyService) RejectPendingAction(ctx context.Context, requestID string, reason string) (*ApprovalDecisionResponse, error) {
	return s.decideApproval(ctx, requestID, false, reason)
}

// GetApprovalMetrics retrieves approval metrics from Python agent service.
func (s *AgentProxyService) GetApprovalMetrics(ctx context.Context) (*ApprovalMetricsResponse, error) {
	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/approvals/metrics",
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create approval metrics request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("approval metrics request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("approval metrics returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result ApprovalMetricsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode approval metrics response: %w", err)
	}
	return &result, nil
}

// GetCodingPolicyProfiles retrieves coding policy profile snapshot from Python agent service.
func (s *AgentProxyService) GetCodingPolicyProfiles(ctx context.Context) (*CodingPolicyProfilesResponse, error) {
	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/coding/policies",
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create coding policies request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("coding policies request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("coding policies returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result CodingPolicyProfilesResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode coding policies response: %w", err)
	}
	return &result, nil
}

// ListTaskTemplates retrieves task template catalog from Python agent service.
func (s *AgentProxyService) ListTaskTemplates(ctx context.Context) (*TaskTemplateListResponse, error) {
	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/task-templates",
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create task templates request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("task templates request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("task templates returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result TaskTemplateListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode task templates response: %w", err)
	}
	if result.Templates == nil {
		result.Templates = []TaskTemplateItem{}
	}
	return &result, nil
}

// StartTaskTemplate starts one task template execution in Python agent service.
func (s *AgentProxyService) StartTaskTemplate(
	ctx context.Context,
	req TaskTemplateStartRequest,
) (*TaskTemplateStartResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal task template start request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		s.baseURL+"/agent/task-templates/start",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create task template start request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("task template start request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("task template start returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result TaskTemplateStartResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode task template start response: %w", err)
	}
	return &result, nil
}

// ReportGraphCommandFeedback forwards graph command execution ACK from frontend.
func (s *AgentProxyService) ReportGraphCommandFeedback(
	ctx context.Context,
	req GraphCommandFeedbackRequest,
) (*GraphCommandFeedbackResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal graph feedback request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		s.baseURL+"/agent/graph/feedback",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create graph feedback request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("graph feedback request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph feedback returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result GraphCommandFeedbackResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode graph feedback response: %w", err)
	}
	return &result, nil
}

// ListGraphCommandFeedback fetches graph command execution timeline from Python.
func (s *AgentProxyService) ListGraphCommandFeedback(
	ctx context.Context,
	studentID string,
	agentName string,
	sessionID string,
	status string,
	command string,
	limit int,
) (*GraphCommandFeedbackListResponse, error) {
	if studentID == "" {
		return nil, fmt.Errorf("student id required")
	}

	query := url.Values{}
	query.Set("student_id", studentID)
	if agentName != "" {
		query.Set("agent_name", agentName)
	}
	if sessionID != "" {
		query.Set("session_id", sessionID)
	}
	if status != "" {
		query.Set("status", status)
	}
	if command != "" {
		query.Set("command", command)
	}
	if limit > 0 {
		query.Set("limit", fmt.Sprintf("%d", limit))
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/graph/feedback?"+query.Encode(),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create graph feedback list request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("graph feedback list request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph feedback list returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result GraphCommandFeedbackListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode graph feedback list response: %w", err)
	}
	return &result, nil
}

// ReportGraphBatchFeedback forwards graph batch execution receipt from frontend.
func (s *AgentProxyService) ReportGraphBatchFeedback(
	ctx context.Context,
	req GraphBatchFeedbackRequest,
) (*GraphBatchFeedbackResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal graph batch feedback request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		s.baseURL+"/agent/graph/batch-feedback",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create graph batch feedback request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("graph batch feedback request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph batch feedback returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result GraphBatchFeedbackResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode graph batch feedback response: %w", err)
	}
	return &result, nil
}

// ListGraphBatchFeedback fetches graph batch execution timeline from Python.
func (s *AgentProxyService) ListGraphBatchFeedback(
	ctx context.Context,
	studentID string,
	agentName string,
	sessionID string,
	status string,
	beforeTS int64,
	limit int,
) (*GraphBatchFeedbackListResponse, error) {
	if studentID == "" {
		return nil, fmt.Errorf("student id required")
	}

	query := url.Values{}
	query.Set("student_id", studentID)
	if agentName != "" {
		query.Set("agent_name", agentName)
	}
	if sessionID != "" {
		query.Set("session_id", sessionID)
	}
	if status != "" {
		query.Set("status", status)
	}
	if beforeTS > 0 {
		query.Set("before_ts", fmt.Sprintf("%d", beforeTS))
	}
	if limit > 0 {
		query.Set("limit", fmt.Sprintf("%d", limit))
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"GET",
		s.baseURL+"/agent/graph/batch-feedback?"+query.Encode(),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create graph batch feedback list request: %w", err)
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("graph batch feedback list request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph batch feedback list returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result GraphBatchFeedbackListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode graph batch feedback list response: %w", err)
	}
	return &result, nil
}

// SkillExecuteRequest is the request to execute a skill workflow
type SkillExecuteRequest struct {
	SkillName string                 `json:"skill_name"`
	Params    map[string]interface{} `json:"params,omitempty"`
	Role      string                 `json:"role,omitempty"`
}

// ListTools retrieves available tools from the Python service
func (s *AgentProxyService) ListTools(ctx context.Context) (json.RawMessage, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", s.baseURL+"/tools/list", nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("list tools failed: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read tools response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list tools returned %d: %s", resp.StatusCode, string(data))
	}

	return json.RawMessage(data), nil
}

// ListSkills retrieves available skills from the Python service
func (s *AgentProxyService) ListSkills(ctx context.Context) (json.RawMessage, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", s.baseURL+"/tools/skills", nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("list skills failed: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read skills response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list skills returned %d: %s", resp.StatusCode, string(data))
	}

	return json.RawMessage(data), nil
}

// ExecuteSkill runs a skill workflow on the Python service
func (s *AgentProxyService) ExecuteSkill(ctx context.Context, req SkillExecuteRequest) (json.RawMessage, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal skill request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+"/tools/skills/execute", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create skill request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return nil, fmt.Errorf("execute skill failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("skill execution returned %d: %s", resp.StatusCode, string(respBody))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read skill response: %w", err)
	}

	return json.RawMessage(data), nil
}

// HealthCheck checks if the Python service is running
func (s *AgentProxyService) HealthCheck(ctx context.Context) error {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", s.baseURL+"/health", nil)
	if err != nil {
		return err
	}

	resp, err := s.doRequest(s.httpClient, httpReq)
	if err != nil {
		return fmt.Errorf("python service unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("python service unhealthy: status %d", resp.StatusCode)
	}
	return nil
}
