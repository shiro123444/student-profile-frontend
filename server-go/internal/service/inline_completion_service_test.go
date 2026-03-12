package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"pathmind-server/internal/config"
)

func TestInlineCompletionService_UsesNIMChatCompletionsContract(t *testing.T) {
	var gotMethod string
	var gotPath string
	var gotAuth string
	var gotBody nimChatCompletionRequest
	var handlerErr error

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")

		body, err := io.ReadAll(r.Body)
		if err != nil {
			handlerErr = err
			http.Error(w, "read body failed", http.StatusInternalServerError)
			return
		}
		if err := json.Unmarshal(body, &gotBody); err != nil {
			handlerErr = err
			http.Error(w, "decode body failed", http.StatusInternalServerError)
			return
		}

		_, _ = w.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"```ts\\nresult := left + right\\n```\"}}]}"))
	}))
	defer server.Close()

	svc := NewInlineCompletionService(config.InlineCompletionConfig{
		BaseURL:             server.URL,
		APIKey:              "nim-test-key",
		Model:               "qwen/qwen3-next-80b-a3b-instruct",
		RequestTimeoutSec:   5,
		MaxIdleConns:        16,
		MaxIdleConnsPerHost: 8,
		IdleConnTimeoutSec:  30,
	}, zap.NewNop())

	completion, err := svc.Complete(
		context.Background(),
		"func add(left, right int) int {\n\treturn ",
		"\n}",
		"",
		"code",
		"go",
	)
	if err != nil {
		t.Fatalf("Complete returned error: %v", err)
	}
	if handlerErr != nil {
		t.Fatalf("handler err: %v", handlerErr)
	}

	if gotMethod != http.MethodPost {
		t.Fatalf("expected POST, got %s", gotMethod)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("expected /v1/chat/completions, got %s", gotPath)
	}
	if gotAuth != "Bearer nim-test-key" {
		t.Fatalf("expected bearer auth header, got %q", gotAuth)
	}

	if gotBody.Stream {
		t.Fatalf("expected stream=false")
	}
	if gotBody.Temperature != 0.1 {
		t.Fatalf("expected temperature=0.1, got %v", gotBody.Temperature)
	}
	if gotBody.MaxTokens != 15 {
		t.Fatalf("expected max_tokens=15, got %d", gotBody.MaxTokens)
	}
	if len(gotBody.Stop) != 2 || gotBody.Stop[0] != "\n\n" || gotBody.Stop[1] != "```" {
		t.Fatalf("unexpected stop config: %#v", gotBody.Stop)
	}
	if len(gotBody.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(gotBody.Messages))
	}
	if gotBody.Messages[0].Role != "system" {
		t.Fatalf("expected system message first, got %s", gotBody.Messages[0].Role)
	}
	if !strings.Contains(gotBody.Messages[0].Content, "fenced markdown code block") {
		t.Fatalf("expected system prompt to encode code mode, got %q", gotBody.Messages[0].Content)
	}
	if !strings.Contains(gotBody.Messages[0].Content, "Preferred code language: go.") {
		t.Fatalf("expected system prompt language hint, got %q", gotBody.Messages[0].Content)
	}
	if !strings.Contains(gotBody.Messages[1].Content, "[CURSOR]") {
		t.Fatalf("expected user message to include [CURSOR], got %q", gotBody.Messages[1].Content)
	}

	if completion != "result := left + right" {
		t.Fatalf("unexpected completion: %q", completion)
	}
}

func TestBuildInlineCompletionSystemPrompt_ProseMode(t *testing.T) {
	prompt := buildInlineCompletionSystemPrompt("prose", "typescript", "当前主题：学习计划")
	if !strings.Contains(prompt, "inline markdown continuation engine") {
		t.Fatalf("expected prose prompt, got %q", prompt)
	}
	if strings.Contains(prompt, "fenced markdown code block") {
		t.Fatalf("prose prompt should not contain code-block instruction: %q", prompt)
	}
	if !strings.Contains(prompt, "当前主题：学习计划") {
		t.Fatalf("expected context summary injection, got %q", prompt)
	}
}
