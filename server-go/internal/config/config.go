package config

import (
	"fmt"
	"log"
	"strings"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	Server           ServerConfig
	Database         DatabaseConfig
	Redis            RedisConfig
	Neo4j            Neo4jConfig
	JWT              JWTConfig
	AgentService     AgentServiceConfig
	InlineCompletion InlineCompletionConfig
	CORS             CORSConfig
	Log              LogConfig
	UploadDir        string
}

type InlineCompletionConfig struct {
	BaseURL             string
	APIKey              string
	Model               string
	RequestTimeoutSec   int
	MaxIdleConns        int
	MaxIdleConnsPerHost int
	IdleConnTimeoutSec  int
}

type AgentServiceConfig struct {
	URL string // Python Agent Service base URL

	RequestTimeoutSec              int
	ResponseHeaderTimeoutSec       int
	StreamHeaderTimeoutSec         int
	MaxIdleConns                   int
	MaxIdleConnsPerHost            int
	IdleConnTimeoutSec             int
	CircuitBreakerFailureThreshold int
	CircuitBreakerOpenSec          int

	RateLimitRequests        int
	RateLimitWindowSec       int
	PublicRateLimitRequests  int
	PublicRateLimitWindowSec int

	MetricsHistoryEnabled          bool
	MetricsHistoryDefaultWindowSec int
	MetricsHistoryMaxWindowSec     int
	MetricsHistoryDefaultBucketSec int
	MetricsHistoryMaxBucketSec     int
	MetricsHistoryQueueSize        int
	MetricsHistoryBatchSize        int
	MetricsHistoryFlushSec         int
}

type ServerConfig struct {
	Port string
	Mode string
}

type DatabaseConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
}

type RedisConfig struct {
	Host     string
	Port     string
	Password string
	DB       int
}

type Neo4jConfig struct {
	URI      string
	User     string
	Password string
}

type JWTConfig struct {
	Secret      string
	ExpireHours int
}

type CORSConfig struct {
	AllowedOrigins []string
}

type LogConfig struct {
	Level string
	File  string
}

func Load() (*Config, error) {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}
	// In this monorepo, Python agent env may hold shared OpenAI-compatible credentials.
	// Load as fallback only (will not override values that are already set).
	_ = godotenv.Load("../server-py/.env")

	viper.AutomaticEnv()

	inlineAPIKey := strings.TrimSpace(getEnv("INLINE_COMPLETION_API_KEY", ""))
	if inlineAPIKey == "" {
		inlineAPIKey = strings.TrimSpace(getEnv("PATHMIND_OPENAI_API_KEY", ""))
	}
	if inlineAPIKey == "" {
		inlineAPIKey = strings.TrimSpace(getEnv("OPENAI_API_KEY", ""))
	}
	if inlineAPIKey == "" {
		inlineAPIKey = strings.TrimSpace(getEnv("NVIDIA_API_KEY", ""))
	}

	inlineBaseURL := normalizeInlineCompletionBaseURL(strings.TrimSpace(getEnv("INLINE_COMPLETION_BASE_URL", "")))
	if inlineBaseURL == "" {
		inlineBaseURL = normalizeInlineCompletionBaseURL(strings.TrimSpace(getEnv("PATHMIND_OPENAI_BASE_URL", "")))
	}
	if inlineBaseURL == "" {
		inlineBaseURL = normalizeInlineCompletionBaseURL(strings.TrimSpace(getEnv("OPENAI_BASE_URL", "")))
	}
	if inlineBaseURL == "" {
		inlineBaseURL = "https://integrate.api.nvidia.com"
	}

	config := &Config{
		UploadDir: getEnv("UPLOAD_DIR", "./uploads"),
		Server: ServerConfig{
			Port: getEnv("SERVER_PORT", "8080"),
			Mode: getEnv("SERVER_MODE", "development"),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "postgres"),
			Password: getEnv("DB_PASSWORD", ""),
			DBName:   getEnv("DB_NAME", "pathmind"),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       viper.GetInt("REDIS_DB"),
		},
		Neo4j: Neo4jConfig{
			URI:      getEnv("NEO4J_URI", "bolt://localhost:7687"),
			User:     getEnv("NEO4J_USERNAME", "neo4j"),
			Password: getEnv("NEO4J_PASSWORD", ""),
		},
		JWT: JWTConfig{
			Secret:      getEnv("JWT_SECRET", "change-me-in-production"),
			ExpireHours: viper.GetInt("JWT_EXPIRE_HOURS"),
		},
		AgentService: AgentServiceConfig{
			URL:                            getEnv("AGENT_SERVICE_URL", "http://localhost:9090"),
			RequestTimeoutSec:              getEnvInt("AGENT_SERVICE_REQUEST_TIMEOUT_SEC", 120),
			ResponseHeaderTimeoutSec:       getEnvInt("AGENT_SERVICE_RESPONSE_HEADER_TIMEOUT_SEC", 30),
			StreamHeaderTimeoutSec:         getEnvInt("AGENT_SERVICE_STREAM_HEADER_TIMEOUT_SEC", 45),
			MaxIdleConns:                   getEnvInt("AGENT_SERVICE_MAX_IDLE_CONNS", 200),
			MaxIdleConnsPerHost:            getEnvInt("AGENT_SERVICE_MAX_IDLE_CONNS_PER_HOST", 50),
			IdleConnTimeoutSec:             getEnvInt("AGENT_SERVICE_IDLE_CONN_TIMEOUT_SEC", 90),
			CircuitBreakerFailureThreshold: getEnvInt("AGENT_SERVICE_CB_FAILURE_THRESHOLD", 5),
			CircuitBreakerOpenSec:          getEnvInt("AGENT_SERVICE_CB_OPEN_SEC", 20),
			RateLimitRequests:              getEnvInt("AGENT_RATE_LIMIT_REQUESTS", 30),
			RateLimitWindowSec:             getEnvInt("AGENT_RATE_LIMIT_WINDOW_SEC", 60),
			PublicRateLimitRequests:        getEnvInt("AGENT_PUBLIC_RATE_LIMIT_REQUESTS", 10),
			PublicRateLimitWindowSec:       getEnvInt("AGENT_PUBLIC_RATE_LIMIT_WINDOW_SEC", 60),
			MetricsHistoryEnabled:          getEnvBool("AGENT_METRICS_HISTORY_ENABLED", true),
			MetricsHistoryDefaultWindowSec: getEnvInt("AGENT_METRICS_HISTORY_DEFAULT_WINDOW_SEC", 900),
			MetricsHistoryMaxWindowSec:     getEnvInt("AGENT_METRICS_HISTORY_MAX_WINDOW_SEC", 86400),
			MetricsHistoryDefaultBucketSec: getEnvInt("AGENT_METRICS_HISTORY_DEFAULT_BUCKET_SEC", 60),
			MetricsHistoryMaxBucketSec:     getEnvInt("AGENT_METRICS_HISTORY_MAX_BUCKET_SEC", 900),
			MetricsHistoryQueueSize:        getEnvInt("AGENT_METRICS_HISTORY_QUEUE_SIZE", 4096),
			MetricsHistoryBatchSize:        getEnvInt("AGENT_METRICS_HISTORY_BATCH_SIZE", 128),
			MetricsHistoryFlushSec:         getEnvInt("AGENT_METRICS_HISTORY_FLUSH_SEC", 2),
		},
		InlineCompletion: InlineCompletionConfig{
			BaseURL:             inlineBaseURL,
			APIKey:              inlineAPIKey,
			Model:               getEnv("INLINE_COMPLETION_MODEL", "qwen/qwen2.5-coder-32b-instruct"),
			RequestTimeoutSec:   getEnvInt("INLINE_COMPLETION_REQUEST_TIMEOUT_SEC", 8),
			MaxIdleConns:        getEnvInt("INLINE_COMPLETION_MAX_IDLE_CONNS", 512),
			MaxIdleConnsPerHost: getEnvInt("INLINE_COMPLETION_MAX_IDLE_CONNS_PER_HOST", 256),
			IdleConnTimeoutSec:  getEnvInt("INLINE_COMPLETION_IDLE_CONN_TIMEOUT_SEC", 90),
		},
		CORS: CORSConfig{
			AllowedOrigins: viper.GetStringSlice("CORS_ALLOWED_ORIGINS"),
		},
		Log: LogConfig{
			Level: getEnv("LOG_LEVEL", "debug"),
			File:  getEnv("LOG_FILE", "./logs/app.log"),
		},
	}

	// Set defaults
	if config.JWT.ExpireHours == 0 {
		config.JWT.ExpireHours = 24
	}

	if len(config.CORS.AllowedOrigins) == 0 {
		config.CORS.AllowedOrigins = []string{"http://localhost:5173"}
	}

	return config, nil
}

func getEnv(key, defaultValue string) string {
	viper.SetDefault(key, defaultValue)
	return viper.GetString(key)
}

func getEnvInt(key string, defaultValue int) int {
	viper.SetDefault(key, defaultValue)
	return viper.GetInt(key)
}

func getEnvBool(key string, defaultValue bool) bool {
	viper.SetDefault(key, defaultValue)
	return viper.GetBool(key)
}

func normalizeInlineCompletionBaseURL(raw string) string {
	value := strings.TrimSpace(raw)
	value = strings.TrimRight(value, "/")
	value = strings.TrimSuffix(value, "/v1")
	return value
}

func (c *Config) GetDSN() string {
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		c.Database.Host,
		c.Database.Port,
		c.Database.User,
		c.Database.Password,
		c.Database.DBName,
	)
}

func (c *Config) GetRedisAddr() string {
	return fmt.Sprintf("%s:%s", c.Redis.Host, c.Redis.Port)
}
