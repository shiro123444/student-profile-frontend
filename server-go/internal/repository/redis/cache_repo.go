package redis

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type CacheRepository struct {
	client *redis.Client
	logger *zap.Logger
}

func NewCacheRepository(client *redis.Client, logger *zap.Logger) *CacheRepository {
	return &CacheRepository{
		client: client,
		logger: logger,
	}
}

// Set stores a value in cache with expiration
func (r *CacheRepository) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		r.logger.Error("Failed to marshal cache value", zap.String("key", key), zap.Error(err))
		return err
	}

	err = r.client.Set(ctx, key, data, expiration).Err()
	if err != nil {
		r.logger.Error("Failed to set cache", zap.String("key", key), zap.Error(err))
		return err
	}

	return nil
}

// Get retrieves a value from cache
func (r *CacheRepository) Get(ctx context.Context, key string, dest interface{}) error {
	data, err := r.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil // Cache miss
		}
		r.logger.Error("Failed to get cache", zap.String("key", key), zap.Error(err))
		return err
	}

	err = json.Unmarshal(data, dest)
	if err != nil {
		r.logger.Error("Failed to unmarshal cache value", zap.String("key", key), zap.Error(err))
		return err
	}

	return nil
}

// Delete removes a value from cache
func (r *CacheRepository) Delete(ctx context.Context, key string) error {
	err := r.client.Del(ctx, key).Err()
	if err != nil {
		r.logger.Error("Failed to delete cache", zap.String("key", key), zap.Error(err))
		return err
	}

	return nil
}

// DeletePattern removes all keys matching a pattern
func (r *CacheRepository) DeletePattern(ctx context.Context, pattern string) error {
	iter := r.client.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		err := r.client.Del(ctx, iter.Val()).Err()
		if err != nil {
			r.logger.Error("Failed to delete cache key", zap.String("key", iter.Val()), zap.Error(err))
		}
	}

	if err := iter.Err(); err != nil {
		r.logger.Error("Failed to scan cache keys", zap.String("pattern", pattern), zap.Error(err))
		return err
	}

	return nil
}

// Exists checks if a key exists in cache
func (r *CacheRepository) Exists(ctx context.Context, key string) (bool, error) {
	count, err := r.client.Exists(ctx, key).Result()
	if err != nil {
		r.logger.Error("Failed to check cache existence", zap.String("key", key), zap.Error(err))
		return false, err
	}

	return count > 0, nil
}

// SetNX sets a value only if the key doesn't exist (for distributed locks)
func (r *CacheRepository) SetNX(ctx context.Context, key string, value interface{}, expiration time.Duration) (bool, error) {
	data, err := json.Marshal(value)
	if err != nil {
		r.logger.Error("Failed to marshal cache value", zap.String("key", key), zap.Error(err))
		return false, err
	}

	success, err := r.client.SetNX(ctx, key, data, expiration).Result()
	if err != nil {
		r.logger.Error("Failed to set cache with NX", zap.String("key", key), zap.Error(err))
		return false, err
	}

	return success, nil
}

// Increment increments a counter
func (r *CacheRepository) Increment(ctx context.Context, key string) (int64, error) {
	val, err := r.client.Incr(ctx, key).Result()
	if err != nil {
		r.logger.Error("Failed to increment cache counter", zap.String("key", key), zap.Error(err))
		return 0, err
	}

	return val, nil
}

// Cache key constants
const (
	StudentProfileKey = "student:profile:%s"
	ClassOverviewKey  = "class:overview:%s"
	LeaderboardKey    = "leaderboard:class:%s"
	CareerKey         = "career:%s"
	MBTITypeKey       = "mbti:type:%s"
	LearningPathKey   = "learning_path:%s"
)

// Cache expiration durations
const (
	StudentProfileExpiration = 1 * time.Hour
	ClassOverviewExpiration  = 30 * time.Minute
	LeaderboardExpiration    = 1 * time.Hour
	CareerExpiration         = 24 * time.Hour
	MBTITypeExpiration       = 0 // Never expire
	LearningPathExpiration   = 24 * time.Hour
)
