package observability

import (
	"strings"
	"sync"
	"time"
)

const (
	trendBucketSec = int64(15)
	trendMaxPoints = 360
)

type routeMetrics struct {
	Count          int64   `json:"count"`
	LatencyAvgMs   float64 `json:"latency_avg_ms"`
	LatencyMaxMs   float64 `json:"latency_max_ms"`
	LatencyTotalMs float64 `json:"latency_total_ms"`
}

type dimensionMetrics struct {
	RequestsTotal               int64            `json:"requests_total"`
	RateLimited429Total         int64            `json:"rate_limited_429_total"`
	UpstreamUnavailable503Total int64            `json:"upstream_unavailable_503_total"`
	StatusCounts                map[string]int64 `json:"status_counts"`
	LatencyAvgMs                float64          `json:"latency_avg_ms"`
	LatencyMaxMs                float64          `json:"latency_max_ms"`
	LatencyTotalMs              float64          `json:"latency_total_ms"`
}

type scopeMetrics struct {
	RequestsTotal               int64                       `json:"requests_total"`
	RateLimited429Total         int64                       `json:"rate_limited_429_total"`
	UpstreamUnavailable503Total int64                       `json:"upstream_unavailable_503_total"`
	StatusCounts                map[string]int64            `json:"status_counts"`
	Routes                      map[string]routeMetrics     `json:"routes"`
	Agents                      map[string]dimensionMetrics `json:"agents"`
	Workspaces                  map[string]dimensionMetrics `json:"workspaces"`
}

type circuitMetrics struct {
	CurrentState    string           `json:"current_state"`
	UpdatedAt       int64            `json:"updated_at"`
	TransitionCount map[string]int64 `json:"transition_count"`
}

type trendPoint struct {
	Ts                          int64   `json:"ts"`
	RequestsTotal               int64   `json:"requests_total"`
	RateLimited429Total         int64   `json:"rate_limited_429_total"`
	UpstreamUnavailable503Total int64   `json:"upstream_unavailable_503_total"`
	Status4xx                   int64   `json:"status_4xx"`
	Status5xx                   int64   `json:"status_5xx"`
	LatencyAvgMs                float64 `json:"latency_avg_ms"`
}

type trendAccumulator struct {
	RequestsTotal               int64
	RateLimited429Total         int64
	UpstreamUnavailable503Total int64
	Status4xx                   int64
	Status5xx                   int64
	LatencyTotalMs              float64
	LatencyCount                int64
	LatencyMaxMs                float64
}

type AgentMetricsSnapshot struct {
	GeneratedAt       int64                   `json:"generated_at"`
	Global            scopeMetrics            `json:"global"`
	Scopes            map[string]scopeMetrics `json:"scopes"`
	Circuit           circuitMetrics          `json:"circuit"`
	TrendBucketSec    int64                   `json:"trend_bucket_sec"`
	Trend             []trendPoint            `json:"trend"`
	WindowSec         int64                   `json:"window_sec,omitempty"`
	SelectedAgent     string                  `json:"selected_agent,omitempty"`
	SelectedWorkspace string                  `json:"selected_workspace,omitempty"`
	Filtered          *dimensionMetrics       `json:"filtered,omitempty"`
}

type agentMetricsCollector struct {
	mu sync.RWMutex

	global  scopeMetrics
	scopes  map[string]scopeMetrics
	circuit circuitMetrics

	trend      map[int64]*trendAccumulator
	trendOrder []int64

	agentTrend          map[string]map[int64]*trendAccumulator
	workspaceTrend      map[string]map[int64]*trendAccumulator
	agentWorkspaceTrend map[string]map[int64]*trendAccumulator
}

func newCollector() *agentMetricsCollector {
	return &agentMetricsCollector{
		global: ensureScopeMetrics("global"),
		scopes: map[string]scopeMetrics{},
		circuit: circuitMetrics{
			CurrentState:    "closed",
			UpdatedAt:       time.Now().Unix(),
			TransitionCount: map[string]int64{"closed": 1},
		},
		trend:               map[int64]*trendAccumulator{},
		trendOrder:          []int64{},
		agentTrend:          map[string]map[int64]*trendAccumulator{},
		workspaceTrend:      map[string]map[int64]*trendAccumulator{},
		agentWorkspaceTrend: map[string]map[int64]*trendAccumulator{},
	}
}

var agentCollector = newCollector()

func ensureScopeMetrics(_ string) scopeMetrics {
	return scopeMetrics{
		StatusCounts: map[string]int64{},
		Routes:       map[string]routeMetrics{},
		Agents:       map[string]dimensionMetrics{},
		Workspaces:   map[string]dimensionMetrics{},
	}
}

func ensureDimensionMetricsMap(target map[string]dimensionMetrics, key string) {
	if _, exists := target[key]; exists {
		return
	}
	target[key] = dimensionMetrics{
		StatusCounts: map[string]int64{},
	}
}

func updateDimensionMetrics(
	target map[string]dimensionMetrics,
	key string,
	status int,
	bucket string,
	latencyMs float64,
) {
	if key == "" {
		return
	}
	ensureDimensionMetricsMap(target, key)
	current := target[key]
	current.RequestsTotal++
	current.StatusCounts[bucket]++
	current.LatencyTotalMs += latencyMs
	if latencyMs > current.LatencyMaxMs {
		current.LatencyMaxMs = latencyMs
	}
	if current.RequestsTotal > 0 {
		current.LatencyAvgMs = current.LatencyTotalMs / float64(current.RequestsTotal)
	}
	if status == 429 {
		current.RateLimited429Total++
	}
	if status == 503 {
		current.UpstreamUnavailable503Total++
	}
	target[key] = current
}

func statusBucket(status int) string {
	if status < 100 {
		return "unknown"
	}
	group := status / 100
	if group < 1 || group > 5 {
		return "unknown"
	}
	return string(rune('0'+group)) + "xx"
}

func normalizeDimension(raw string, fallback string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback
	}
	return value
}

func composeAgentWorkspaceKey(agentName string, workspaceID string) string {
	return agentName + "|" + workspaceID
}

func ensureTrendBucket(
	target map[int64]*trendAccumulator,
	bucketTs int64,
) *trendAccumulator {
	acc, exists := target[bucketTs]
	if !exists {
		acc = &trendAccumulator{}
		target[bucketTs] = acc
	}
	return acc
}

func updateTrendAccumulator(
	acc *trendAccumulator,
	status int,
	bucket string,
	latencyMs float64,
) {
	if acc == nil {
		return
	}
	acc.RequestsTotal++
	acc.LatencyTotalMs += latencyMs
	acc.LatencyCount++
	if latencyMs > acc.LatencyMaxMs {
		acc.LatencyMaxMs = latencyMs
	}
	if status == 429 {
		acc.RateLimited429Total++
	}
	if status == 503 {
		acc.UpstreamUnavailable503Total++
	}
	if bucket == "4xx" {
		acc.Status4xx++
	}
	if bucket == "5xx" {
		acc.Status5xx++
	}
}

func recordDimensionalTrend(
	target map[string]map[int64]*trendAccumulator,
	key string,
	bucketTs int64,
	status int,
	bucket string,
	latencyMs float64,
) {
	if key == "" {
		return
	}
	series, exists := target[key]
	if !exists {
		series = map[int64]*trendAccumulator{}
		target[key] = series
	}
	acc := ensureTrendBucket(series, bucketTs)
	updateTrendAccumulator(acc, status, bucket, latencyMs)
}

func pruneTrendFromDimensionalMap(
	target map[string]map[int64]*trendAccumulator,
	ts int64,
) {
	for key, series := range target {
		delete(series, ts)
		if len(series) == 0 {
			delete(target, key)
		}
	}
}

func (collector *agentMetricsCollector) pruneTrendIfNeeded() {
	if len(collector.trendOrder) <= trendMaxPoints {
		return
	}

	excess := len(collector.trendOrder) - trendMaxPoints
	for idx := 0; idx < excess; idx++ {
		oldTs := collector.trendOrder[idx]
		delete(collector.trend, oldTs)
		pruneTrendFromDimensionalMap(collector.agentTrend, oldTs)
		pruneTrendFromDimensionalMap(collector.workspaceTrend, oldTs)
		pruneTrendFromDimensionalMap(collector.agentWorkspaceTrend, oldTs)
	}

	collector.trendOrder = append([]int64{}, collector.trendOrder[excess:]...)
}

func copyDimensionMap(source map[string]dimensionMetrics) map[string]dimensionMetrics {
	copied := make(map[string]dimensionMetrics, len(source))
	for key, value := range source {
		statusCopy := map[string]int64{}
		for status, count := range value.StatusCounts {
			statusCopy[status] = count
		}
		value.StatusCounts = statusCopy
		copied[key] = value
	}
	return copied
}

func copyScopeMetrics(source scopeMetrics) scopeMetrics {
	copyVal := scopeMetrics{
		RequestsTotal:               source.RequestsTotal,
		RateLimited429Total:         source.RateLimited429Total,
		UpstreamUnavailable503Total: source.UpstreamUnavailable503Total,
		StatusCounts:                map[string]int64{},
		Routes:                      map[string]routeMetrics{},
		Agents:                      copyDimensionMap(source.Agents),
		Workspaces:                  copyDimensionMap(source.Workspaces),
	}
	for key, value := range source.StatusCounts {
		copyVal.StatusCounts[key] = value
	}
	for key, value := range source.Routes {
		copyVal.Routes[key] = value
	}
	return copyVal
}

func buildTrendPointsLocked(
	trendOrder []int64,
	source map[int64]*trendAccumulator,
	cutoffTs int64,
) []trendPoint {
	points := make([]trendPoint, 0, len(trendOrder))
	for _, ts := range trendOrder {
		if cutoffTs > 0 && ts < cutoffTs {
			continue
		}
		acc := source[ts]
		if acc == nil {
			continue
		}
		latencyAvg := 0.0
		if acc.LatencyCount > 0 {
			latencyAvg = acc.LatencyTotalMs / float64(acc.LatencyCount)
		}
		points = append(points, trendPoint{
			Ts:                          ts,
			RequestsTotal:               acc.RequestsTotal,
			RateLimited429Total:         acc.RateLimited429Total,
			UpstreamUnavailable503Total: acc.UpstreamUnavailable503Total,
			Status4xx:                   acc.Status4xx,
			Status5xx:                   acc.Status5xx,
			LatencyAvgMs:                latencyAvg,
		})
	}
	return points
}

func dimensionMetricsFromTrend(points []trendPoint) *dimensionMetrics {
	if len(points) == 0 {
		return nil
	}
	var summary dimensionMetrics
	summary.StatusCounts = map[string]int64{}
	var weightedLatencyTotal float64
	var weightedLatencyCount int64

	for _, point := range points {
		summary.RequestsTotal += point.RequestsTotal
		summary.RateLimited429Total += point.RateLimited429Total
		summary.UpstreamUnavailable503Total += point.UpstreamUnavailable503Total
		summary.StatusCounts["4xx"] += point.Status4xx
		summary.StatusCounts["5xx"] += point.Status5xx
		weightedLatencyTotal += point.LatencyAvgMs * float64(point.RequestsTotal)
		weightedLatencyCount += point.RequestsTotal
	}
	if weightedLatencyCount > 0 {
		summary.LatencyAvgMs = weightedLatencyTotal / float64(weightedLatencyCount)
	}
	return &summary
}

func RecordAgentRequest(scope, route string, status int, latency time.Duration) {
	RecordAgentRequestWithDimensions(scope, route, "", "", status, latency)
}

func RecordAgentRequestWithDimensions(
	scope string,
	route string,
	agentName string,
	workspaceID string,
	status int,
	latency time.Duration,
) {
	if scope == "" {
		scope = "unknown"
	}
	if route == "" {
		route = "unknown"
	}

	agentName = normalizeDimension(agentName, "unknown")
	workspaceID = normalizeDimension(workspaceID, "default")

	latencyMs := float64(latency.Milliseconds())
	bucket := statusBucket(status)
	nowTs := time.Now().Unix()
	bucketTs := nowTs - (nowTs % trendBucketSec)

	agentCollector.mu.Lock()
	defer agentCollector.mu.Unlock()

	agentCollector.global.RequestsTotal++
	agentCollector.global.StatusCounts[bucket]++
	if status == 429 {
		agentCollector.global.RateLimited429Total++
	}
	if status == 503 {
		agentCollector.global.UpstreamUnavailable503Total++
	}
	globalRoute := agentCollector.global.Routes[route]
	globalRoute.Count++
	globalRoute.LatencyTotalMs += latencyMs
	if latencyMs > globalRoute.LatencyMaxMs {
		globalRoute.LatencyMaxMs = latencyMs
	}
	globalRoute.LatencyAvgMs = globalRoute.LatencyTotalMs / float64(globalRoute.Count)
	agentCollector.global.Routes[route] = globalRoute
	updateDimensionMetrics(agentCollector.global.Agents, agentName, status, bucket, latencyMs)
	updateDimensionMetrics(agentCollector.global.Workspaces, workspaceID, status, bucket, latencyMs)

	scopeMetricsVal, ok := agentCollector.scopes[scope]
	if !ok {
		scopeMetricsVal = ensureScopeMetrics(scope)
	}
	scopeMetricsVal.RequestsTotal++
	scopeMetricsVal.StatusCounts[bucket]++
	if status == 429 {
		scopeMetricsVal.RateLimited429Total++
	}
	if status == 503 {
		scopeMetricsVal.UpstreamUnavailable503Total++
	}
	routeMetricsVal := scopeMetricsVal.Routes[route]
	routeMetricsVal.Count++
	routeMetricsVal.LatencyTotalMs += latencyMs
	if latencyMs > routeMetricsVal.LatencyMaxMs {
		routeMetricsVal.LatencyMaxMs = latencyMs
	}
	routeMetricsVal.LatencyAvgMs = routeMetricsVal.LatencyTotalMs / float64(routeMetricsVal.Count)
	scopeMetricsVal.Routes[route] = routeMetricsVal
	updateDimensionMetrics(scopeMetricsVal.Agents, agentName, status, bucket, latencyMs)
	updateDimensionMetrics(scopeMetricsVal.Workspaces, workspaceID, status, bucket, latencyMs)
	agentCollector.scopes[scope] = scopeMetricsVal

	globalTrendBucket := ensureTrendBucket(agentCollector.trend, bucketTs)
	if len(agentCollector.trendOrder) == 0 || agentCollector.trendOrder[len(agentCollector.trendOrder)-1] != bucketTs {
		agentCollector.trendOrder = append(agentCollector.trendOrder, bucketTs)
	}
	updateTrendAccumulator(globalTrendBucket, status, bucket, latencyMs)

	recordDimensionalTrend(agentCollector.agentTrend, agentName, bucketTs, status, bucket, latencyMs)
	recordDimensionalTrend(agentCollector.workspaceTrend, workspaceID, bucketTs, status, bucket, latencyMs)
	recordDimensionalTrend(
		agentCollector.agentWorkspaceTrend,
		composeAgentWorkspaceKey(agentName, workspaceID),
		bucketTs,
		status,
		bucket,
		latencyMs,
	)

	agentCollector.pruneTrendIfNeeded()
}

func RecordCircuitState(state string) {
	if state == "" {
		state = "unknown"
	}

	agentCollector.mu.Lock()
	defer agentCollector.mu.Unlock()

	if agentCollector.circuit.CurrentState != state {
		agentCollector.circuit.CurrentState = state
		agentCollector.circuit.UpdatedAt = time.Now().Unix()
		agentCollector.circuit.TransitionCount[state]++
	}
}

func GetAgentMetricsSnapshot() AgentMetricsSnapshot {
	return GetAgentMetricsSnapshotFiltered("", "", 0)
}

func GetAgentMetricsSnapshotFiltered(
	agentName string,
	workspaceID string,
	windowSec int64,
) AgentMetricsSnapshot {
	agentName = strings.TrimSpace(agentName)
	workspaceID = strings.TrimSpace(workspaceID)
	if windowSec < 0 {
		windowSec = 0
	}

	var cutoffTs int64
	if windowSec > 0 {
		cutoffTs = time.Now().Unix() - windowSec
	}

	agentCollector.mu.RLock()
	defer agentCollector.mu.RUnlock()

	globalCopy := copyScopeMetrics(agentCollector.global)

	scopesCopy := make(map[string]scopeMetrics, len(agentCollector.scopes))
	for scope, metricsVal := range agentCollector.scopes {
		scopesCopy[scope] = copyScopeMetrics(metricsVal)
	}

	circuitCopy := circuitMetrics{
		CurrentState:    agentCollector.circuit.CurrentState,
		UpdatedAt:       agentCollector.circuit.UpdatedAt,
		TransitionCount: map[string]int64{},
	}
	for key, value := range agentCollector.circuit.TransitionCount {
		circuitCopy.TransitionCount[key] = value
	}

	trendSource := agentCollector.trend
	if agentName != "" && workspaceID != "" {
		if series, exists := agentCollector.agentWorkspaceTrend[composeAgentWorkspaceKey(agentName, workspaceID)]; exists {
			trendSource = series
		} else {
			trendSource = map[int64]*trendAccumulator{}
		}
	} else if agentName != "" {
		if series, exists := agentCollector.agentTrend[agentName]; exists {
			trendSource = series
		} else {
			trendSource = map[int64]*trendAccumulator{}
		}
	} else if workspaceID != "" {
		if series, exists := agentCollector.workspaceTrend[workspaceID]; exists {
			trendSource = series
		} else {
			trendSource = map[int64]*trendAccumulator{}
		}
	}

	trendCopy := buildTrendPointsLocked(agentCollector.trendOrder, trendSource, cutoffTs)
	filtered := dimensionMetricsFromTrend(trendCopy)

	return AgentMetricsSnapshot{
		GeneratedAt:       time.Now().Unix(),
		Global:            globalCopy,
		Scopes:            scopesCopy,
		Circuit:           circuitCopy,
		TrendBucketSec:    trendBucketSec,
		Trend:             trendCopy,
		WindowSec:         windowSec,
		SelectedAgent:     agentName,
		SelectedWorkspace: workspaceID,
		Filtered:          filtered,
	}
}
