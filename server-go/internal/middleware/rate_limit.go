package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type fixedWindowCounter struct {
	windowStart time.Time
	count       int
}

type fixedWindowLimiter struct {
	maxRequests int
	window      time.Duration

	mu       sync.Mutex
	counters map[string]fixedWindowCounter
}

func newFixedWindowLimiter(maxRequests int, window time.Duration) *fixedWindowLimiter {
	if maxRequests <= 0 {
		maxRequests = 30
	}
	if window <= 0 {
		window = 60 * time.Second
	}

	return &fixedWindowLimiter{
		maxRequests: maxRequests,
		window:      window,
		counters:    make(map[string]fixedWindowCounter),
	}
}

func (l *fixedWindowLimiter) allow(key string) (bool, time.Duration) {
	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.counters) > 10000 {
		cutoff := now.Add(-2 * l.window)
		for k, v := range l.counters {
			if v.windowStart.Before(cutoff) {
				delete(l.counters, k)
			}
		}
	}

	counter, ok := l.counters[key]
	if !ok || now.Sub(counter.windowStart) >= l.window {
		l.counters[key] = fixedWindowCounter{windowStart: now, count: 1}
		return true, 0
	}

	if counter.count >= l.maxRequests {
		retryAfter := l.window - now.Sub(counter.windowStart)
		if retryAfter < 0 {
			retryAfter = 0
		}
		return false, retryAfter
	}

	counter.count++
	l.counters[key] = counter
	return true, 0
}

func AgentRateLimitMiddleware(maxRequests int, window time.Duration) gin.HandlerFunc {
	limiter := newFixedWindowLimiter(maxRequests, window)

	return func(c *gin.Context) {
		principal := c.ClientIP()
		if userID, ok := c.Get("user_id"); ok {
			principal = fmt.Sprintf("user:%v", userID)
		} else {
			principal = "ip:" + principal
		}

		allowed, retryAfter := limiter.allow(principal)
		if !allowed {
			c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate limit exceeded",
				"retry_after": retryAfter.String(),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func PublicAgentRateLimitMiddleware(maxRequests int, window time.Duration) gin.HandlerFunc {
	limiter := newFixedWindowLimiter(maxRequests, window)

	return func(c *gin.Context) {
		principal := "ip:" + c.ClientIP()
		allowed, retryAfter := limiter.allow(principal)
		if !allowed {
			c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "public agent rate limit exceeded",
				"retry_after": retryAfter.String(),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
