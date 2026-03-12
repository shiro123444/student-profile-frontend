package database

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"pathmind-server/internal/config"
	"pathmind-server/internal/models"
)

type Database struct {
	PG    *gorm.DB
	Neo4j neo4j.DriverWithContext
	Redis *redis.Client
}

func InitPostgres(cfg *config.Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.DBName,
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to postgres: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)

	// Auto-migrate platform models
	if err := db.AutoMigrate(
		&models.PointTransaction{},
		&models.PointBalance{},
		&models.DailyCheckin{},
		&models.AIUsageLog{},
		&models.AgentSession{},
		&models.Document{},
		&models.AlgorithmChallenge{},
		&models.ChallengeSubmission{},
		&models.MBTITestResult{},
		&models.Note{},
		&models.NoteFolder{},
		&models.NoteLink{},
		&models.AgentActionAudit{},
		&models.AgentRequestMetric{},
	); err != nil {
		return nil, fmt.Errorf("failed to auto-migrate platform models: %w", err)
	}

	log.Println("PostgreSQL connected successfully")
	return db, nil
}

func InitNeo4j(cfg *config.Config) (neo4j.DriverWithContext, error) {
	driver, err := neo4j.NewDriverWithContext(
		cfg.Neo4j.URI,
		neo4j.BasicAuth(cfg.Neo4j.User, cfg.Neo4j.Password, ""),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create neo4j driver: %w", err)
	}

	log.Println("Neo4j connected successfully")
	return driver, nil
}

func InitRedis(cfg *config.Config) *redis.Client {
	client := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.Redis.Host, cfg.Redis.Port),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	log.Println("Redis connected successfully")
	return client
}

func Init(cfg *config.Config) (*Database, error) {
	pg, err := InitPostgres(cfg)
	if err != nil {
		return nil, err
	}

	neo4jDriver, err := InitNeo4j(cfg)
	if err != nil {
		return nil, err
	}

	redisClient := InitRedis(cfg)

	return &Database{
		PG:    pg,
		Neo4j: neo4jDriver,
		Redis: redisClient,
	}, nil
}

func (d *Database) Close() error {
	if d.PG != nil {
		sqlDB, err := d.PG.DB()
		if err == nil {
			sqlDB.Close()
		}
	}

	if d.Neo4j != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		d.Neo4j.Close(ctx)
	}

	if d.Redis != nil {
		d.Redis.Close()
	}

	return nil
}
