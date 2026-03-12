package config

import (
	"context"
	"fmt"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Database struct {
	PG     *gorm.DB
	Neo4j  neo4j.DriverWithContext
	Redis  *redis.Client
	Logger *zap.Logger
}

func InitDatabase(cfg *Config, log *zap.Logger) (*Database, error) {
	db := &Database{Logger: log}

	// Initialize PostgreSQL
	pg, err := initPostgreSQL(cfg, log)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize PostgreSQL: %w", err)
	}
	db.PG = pg

	// Initialize Neo4j
	neo4jDriver, err := initNeo4j(cfg, log)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Neo4j: %w", err)
	}
	db.Neo4j = neo4jDriver

	// Initialize Redis
	redisClient := initRedis(cfg, log)
	db.Redis = redisClient

	return db, nil
}

func initPostgreSQL(cfg *Config, log *zap.Logger) (*gorm.DB, error) {
	dsn := cfg.GetDSN()

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// Connection pool settings
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping PostgreSQL: %w", err)
	}

	log.Info("PostgreSQL connected successfully")
	return db, nil
}

func initNeo4j(cfg *Config, log *zap.Logger) (neo4j.DriverWithContext, error) {
	driver, err := neo4j.NewDriverWithContext(
		cfg.Neo4j.URI,
		neo4j.BasicAuth(cfg.Neo4j.User, cfg.Neo4j.Password, ""),
		func(c *neo4j.Config) {
			c.MaxConnectionPoolSize = 100
			c.ConnectionAcquisitionTimeout = 60 * time.Second
		},
	)
	if err != nil {
		return nil, err
	}

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := driver.VerifyConnectivity(ctx); err != nil {
		return nil, fmt.Errorf("failed to verify Neo4j connectivity: %w", err)
	}

	log.Info("Neo4j connected successfully")
	return driver, nil
}

func initRedis(cfg *Config, log *zap.Logger) *redis.Client {
	client := redis.NewClient(&redis.Options{
		Addr:         cfg.GetRedisAddr(),
		Password:     cfg.Redis.Password,
		DB:           cfg.Redis.DB,
		PoolSize:     10,
		MinIdleConns: 5,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Warn("Redis connection failed, continuing without cache", zap.Error(err))
	} else {
		log.Info("Redis connected successfully")
	}

	return client
}

func (db *Database) Close() error {
	var errs []error

	// Close PostgreSQL
	if db.PG != nil {
		sqlDB, err := db.PG.DB()
		if err == nil {
			if err := sqlDB.Close(); err != nil {
				errs = append(errs, fmt.Errorf("failed to close PostgreSQL: %w", err))
			}
		}
	}

	// Close Neo4j
	if db.Neo4j != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := db.Neo4j.Close(ctx); err != nil {
			errs = append(errs, fmt.Errorf("failed to close Neo4j: %w", err))
		}
	}

	// Close Redis
	if db.Redis != nil {
		if err := db.Redis.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close Redis: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing databases: %v", errs)
	}

	return nil
}
