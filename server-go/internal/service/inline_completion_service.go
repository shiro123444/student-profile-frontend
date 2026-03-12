package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"pathmind-server/internal/config"
)

const inlineCompletionCodeSystemPrompt = "You are an inline code completion engine embedded inside a markdown fenced code block. " +
	"Return ONLY the raw code tokens that should be inserted at the [CURSOR] position. " +
	"CRITICAL RULES: Never wrap output in markdown fences (```). Never add comments or explanations. " +
	"Never repeat code that already exists before [CURSOR]. Output exactly the next few tokens of code, nothing else."

const inlineCompletionProseSystemPrompt = "You are an inline markdown continuation engine. " +
	"Return only the plain text that should be inserted at [CURSOR]. " +
	"Do not include markdown fences, explanations, or commentary."

var (
	inlineCompletionClientOnce sync.Once
	inlineCompletionClient     *http.Client
)

type nimChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type nimChatCompletionRequest struct {
	Model       string           `json:"model"`
	Messages    []nimChatMessage `json:"messages"`
	Temperature float64          `json:"temperature"`
	MaxTokens   int              `json:"max_tokens"`
	Stop        []string         `json:"stop"`
	Stream      bool             `json:"stream"`
}

type nimChatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type nvcfCompletionRequest struct {
	Prompt      string  `json:"prompt"`
	Temperature float64 `json:"temperature"`
	TopP        float64 `json:"top_p"`
	MaxTokens   int     `json:"max_tokens"`
	Stream      bool    `json:"stream"`
}

type nvcfCompletionResponse struct {
	Choices []struct {
		Text string `json:"text"`
	} `json:"choices"`
}

// InlineCompletionService handles markdown editor inline completion requests.
type InlineCompletionService struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
	logger  *zap.Logger
}

// NewInlineCompletionService creates a completion service with a shared keep-alive HTTP client.
func NewInlineCompletionService(cfg config.InlineCompletionConfig, logger *zap.Logger) *InlineCompletionService {
	return &InlineCompletionService{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:  strings.TrimSpace(cfg.APIKey),
		model:   strings.TrimSpace(cfg.Model),
		client:  getInlineCompletionClient(cfg),
		logger:  logger,
	}
}

func getInlineCompletionClient(cfg config.InlineCompletionConfig) *http.Client {
	inlineCompletionClientOnce.Do(func() {
		timeoutSec := positiveOrDefault(cfg.RequestTimeoutSec, 8)
		maxIdleConns := positiveOrDefault(cfg.MaxIdleConns, 512)
		maxIdleConnsPerHost := positiveOrDefault(cfg.MaxIdleConnsPerHost, 256)
		idleConnTimeoutSec := positiveOrDefault(cfg.IdleConnTimeoutSec, 90)

		transport := &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   4 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:          maxIdleConns,
			MaxIdleConnsPerHost:   maxIdleConnsPerHost,
			IdleConnTimeout:       time.Duration(idleConnTimeoutSec) * time.Second,
			TLSHandshakeTimeout:   6 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
			ForceAttemptHTTP2:     true,
		}

		inlineCompletionClient = &http.Client{
			Timeout:   time.Duration(timeoutSec) * time.Second,
			Transport: transport,
		}
	})

	return inlineCompletionClient
}

// Complete requests a short inline completion at [CURSOR] using NVIDIA NIM chat completions.
func (s *InlineCompletionService) Complete(
	ctx context.Context,
	prefix string,
	suffix string,
	contextSummary string,
	mode string,
	language string,
) (string, error) {
	if s.client == nil {
		return "", fmt.Errorf("inline completion client not initialized")
	}
	if s.baseURL == "" {
		return "", fmt.Errorf("inline completion base url not configured")
	}
	if s.apiKey == "" {
		return "", fmt.Errorf("inline completion api key not configured")
	}
	if s.model == "" {
		return "", fmt.Errorf("inline completion model not configured")
	}

	// Check if model is StarCoder (uses NVCF API)
	if strings.Contains(s.model, "starcoder") {
		return s.completeWithNVCF(ctx, prefix, suffix)
	}

	// Default: use chat completions API
	return s.completeWithChat(ctx, prefix, suffix, contextSummary, mode, language)
}

func (s *InlineCompletionService) completeWithNVCF(
	ctx context.Context,
	prefix string,
	suffix string,
) (string, error) {
	// StarCoder uses FIM (Fill-In-Middle) format
	prompt := prefix + "<fim_suffix>" + suffix + "<fim_middle>"

	requestBody := nvcfCompletionRequest{
		Prompt:      prompt,
		Temperature: 0.1,
		TopP:        0.7,
		MaxTokens:   64,
		Stream:      false,
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("marshal nvcf completion request: %w", err)
	}

	// Use OpenAI-compatible completions endpoint
	completionURL := s.baseURL + "/completions"

	httpReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		completionURL,
		bytes.NewReader(payload),
	)
	if err != nil {
		return "", fmt.Errorf("build nvcf completion request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+s.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("nvcf completion request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("nvcf completion upstream status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var decoded nvcfCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", fmt.Errorf("decode nvcf completion response: %w", err)
	}
	if len(decoded.Choices) == 0 {
		return "", nil
	}

	completion := sanitizeInlineCompletion(decoded.Choices[0].Text)
	if completion != "" {
		s.logger.Debug("nvcf completion generated",
			zap.Int("chars", len(completion)),
			zap.String("model", s.model),
		)
	}
	return completion, nil
}

func (s *InlineCompletionService) pollNVCFResult(ctx context.Context, requestID string) (string, error) {
	fetchURL := "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/" + requestID
	maxRetries := 10
	retryDelay := 200 * time.Millisecond

	for i := 0; i < maxRetries; i++ {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(retryDelay):
		}

		httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, fetchURL, nil)
		if err != nil {
			return "", fmt.Errorf("build nvcf poll request: %w", err)
		}
		httpReq.Header.Set("Authorization", "Bearer "+s.apiKey)
		httpReq.Header.Set("Accept", "application/json")

		resp, err := s.client.Do(httpReq)
		if err != nil {
			return "", fmt.Errorf("nvcf poll request failed: %w", err)
		}

		if resp.StatusCode == http.StatusAccepted {
			resp.Body.Close()
			retryDelay = time.Duration(float64(retryDelay) * 1.5)
			continue
		}

		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			return "", fmt.Errorf("nvcf poll status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		}

		var decoded nvcfCompletionResponse
		if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
			return "", fmt.Errorf("decode nvcf poll response: %w", err)
		}
		if len(decoded.Choices) == 0 {
			return "", nil
		}

		return sanitizeInlineCompletion(decoded.Choices[0].Text), nil
	}

	return "", fmt.Errorf("nvcf polling timeout after %d retries", maxRetries)
}

func (s *InlineCompletionService) completeWithChat(
	ctx context.Context,
	prefix string,
	suffix string,
	contextSummary string,
	mode string,
	language string,
) (string, error) {
	userPrompt := prefix + "[CURSOR]" + suffix
	normalizedMode := normalizeInlineCompletionMode(mode)
	systemPrompt := buildInlineCompletionSystemPrompt(mode, language, contextSummary)

	// Code mode: allow more tokens and don't stop at ``` (we're inside a code block)
	maxTokens := 15
	stopSeqs := []string{"\n\n", "```"}
	if normalizedMode == "code" {
		maxTokens = 40
		stopSeqs = []string{"```"}
	}

	requestBody := nimChatCompletionRequest{
		Model: s.model,
		Messages: []nimChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature: 0.1,
		MaxTokens:   maxTokens,
		Stop:        stopSeqs,
		Stream:      false,
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("marshal inline completion request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.baseURL+"/v1/chat/completions",
		bytes.NewReader(payload),
	)
	if err != nil {
		return "", fmt.Errorf("build inline completion request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+s.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("inline completion request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("inline completion upstream status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var decoded nimChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", fmt.Errorf("decode inline completion response: %w", err)
	}
	if len(decoded.Choices) == 0 {
		return "", nil
	}

	completion := sanitizeInlineCompletion(decoded.Choices[0].Message.Content)
	if completion != "" {
		s.logger.Debug("inline completion generated",
			zap.Int("chars", len(completion)),
			zap.String("model", s.model),
		)
	}
	return completion, nil
}

func buildInlineCompletionSystemPrompt(mode string, language string, contextSummary string) string {
	normalizedMode := normalizeInlineCompletionMode(mode)
	systemPrompt := inlineCompletionCodeSystemPrompt

	switch normalizedMode {
	case "prose":
		systemPrompt = inlineCompletionProseSystemPrompt
	case "code":
		systemPrompt = inlineCompletionCodeSystemPrompt +
			"\n\nCursor location: inside a fenced markdown code block."
		if lang := normalizeInlineCompletionLanguage(language); lang != "" {
			systemPrompt += "\nPreferred code language: " + lang + "."
		}
	}

	if summary := strings.TrimSpace(contextSummary); summary != "" {
		systemPrompt += "\n\nRecent working context (for consistency only):\n" + clipRunes(summary, 800)
	}

	return systemPrompt
}

func normalizeInlineCompletionMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "prose":
		return "prose"
	default:
		return "code"
	}
}

func normalizeInlineCompletionLanguage(raw string) string {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(trimmed))
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '+' || r == '#' || r == '.' || r == '-' {
			b.WriteRune(r)
		}
	}

	result := b.String()
	if result == "plain" || result == "text" {
		return ""
	}
	if len(result) > 24 {
		return result[:24]
	}
	return result
}

func sanitizeInlineCompletion(raw string) string {
	text := strings.TrimSpace(strings.ReplaceAll(raw, "\r", ""))
	if text == "" {
		return ""
	}

	if strings.HasPrefix(text, "```") {
		if nl := strings.Index(text, "\n"); nl >= 0 {
			text = text[nl+1:]
		}
		text = strings.TrimSpace(text)
		text = strings.TrimSuffix(text, "```")
	}

	return strings.TrimSpace(text)
}

func positiveOrDefault(value int, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func clipRunes(input string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(input)
	if len(runes) <= limit {
		return input
	}
	return string(runes[:limit])
}
