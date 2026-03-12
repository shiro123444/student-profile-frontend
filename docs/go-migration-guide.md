# PathMind AI - Go 后端迁移指南

## 项目结构

```
server-go/
├── cmd/
│   └── api/
│       └── main.go                 # 应用入口
├── internal/
│   ├── config/                     # 配置管理
│   │   ├── config.go
│   │   └── database.go
│   ├── models/                     # 数据模型
│   │   ├── user.go
│   │   ├── student.go
│   │   ├── experiment.go
│   │   └── knowledge.go
│   ├── repository/                 # 数据访问层
│   │   ├── postgres/
│   │   │   ├── user_repo.go
│   │   │   └── experiment_repo.go
│   │   ├── neo4j/
│   │   │   ├── knowledge_repo.go
│   │   │   └── career_repo.go
│   │   └── redis/
│   │       └── cache_repo.go
│   ├── service/                    # 业务逻辑层
│   │   ├── auth_service.go
│   │   ├── user_service.go
│   │   ├── learning_service.go
│   │   ├── experiment_service.go
│   │   └── analytics_service.go
│   ├── handler/                    # HTTP 处理器
│   │   ├── auth_handler.go
│   │   ├── user_handler.go
│   │   ├── learning_handler.go
│   │   └── analytics_handler.go
│   ├── middleware/                 # 中间件
│   │   ├── auth.go
│   │   ├── cors.go
│   │   ├── logger.go
│   │   └── rate_limit.go
│   └── utils/                      # 工具函数
│       ├── jwt.go
│       ├── validator.go
│       └── response.go
├── pkg/                            # 可复用包
│   ├── logger/
│   └── errors/
├── migrations/                     # 数据库迁移
│   ├── postgres/
│   └── neo4j/
├── docs/                          # API 文档
│   └── swagger.yaml
├── go.mod
├── go.sum
└── .env.example
```

## 核心依赖

```go
// go.mod
module github.com/yourusername/pathmind-server

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1              // Web 框架
    github.com/neo4j/neo4j-go-driver/v5 v5.15.0  // Neo4j 驱动
    gorm.io/gorm v1.25.5                         // ORM
    gorm.io/driver/postgres v1.5.4               // PostgreSQL 驱动
    github.com/redis/go-redis/v9 v9.3.0          // Redis 客户端
    github.com/golang-jwt/jwt/v5 v5.2.0          // JWT
    github.com/casbin/casbin/v2 v2.81.0          // 权限控制
    github.com/go-playground/validator/v10 v10.16.0 // 数据验证
    go.uber.org/zap v1.26.0                      // 日志
    github.com/spf13/viper v1.18.2               // 配置管理
    github.com/swaggo/gin-swagger v1.6.0         // Swagger
    golang.org/x/crypto v0.17.0                  // 加密
)
```

## 数据库设计

### PostgreSQL 表结构

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL, -- admin, operator, teacher, student
    organization_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 学生扩展信息
CREATE TABLE students (
    id UUID PRIMARY KEY,
    user_id UUID UNIQUE REFERENCES users(id),
    student_number VARCHAR(50) UNIQUE,
    class_id UUID,
    mbti_type VARCHAR(4),
    enrollment_year INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 班级表
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    teacher_id UUID REFERENCES users(id),
    organization_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 实验表
CREATE TABLE experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    difficulty VARCHAR(20), -- beginner, intermediate, advanced
    estimated_duration INT, -- 分钟
    knowledge_point_ids TEXT[], -- 关联知识点 ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 学生实验记录
CREATE TABLE student_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id),
    experiment_id UUID REFERENCES experiments(id),
    status VARCHAR(20), -- not_started, in_progress, completed
    score DECIMAL(5,2),
    is_correct BOOLEAN,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    duration INT, -- 实际用时(分钟)
    submission_count INT DEFAULT 0
);

-- 学习记录
CREATE TABLE learning_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id),
    resource_type VARCHAR(50), -- course, experiment, material
    resource_id UUID,
    action VARCHAR(50), -- view, start, complete
    duration INT, -- 学习时长(分钟)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 知识点表
CREATE TABLE knowledge_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    level VARCHAR(20), -- beginner, intermediate, advanced
    parent_id UUID REFERENCES knowledge_points(id),
    description TEXT
);

-- 学生知识点掌握度
CREATE TABLE student_knowledge_mastery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id),
    knowledge_point_id UUID REFERENCES knowledge_points(id),
    mastery_level DECIMAL(3,2), -- 0.00 - 1.00
    last_practiced_at TIMESTAMP,
    practice_count INT DEFAULT 0,
    UNIQUE(student_id, knowledge_point_id)
);

-- 索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_student_experiments_student ON student_experiments(student_id);
CREATE INDEX idx_learning_records_student ON learning_records(student_id);
CREATE INDEX idx_knowledge_mastery_student ON student_knowledge_mastery(student_id);
```

### Neo4j 扩展

```cypher
// 保留现有节点和关系
// 新增知识点节点
CREATE (kp:KnowledgePoint {
  id: 'uuid',
  name: '知识点名称',
  category: 'programming',
  level: 'beginner',
  description: '描述'
})

// 新增实验节点
CREATE (exp:Experiment {
  id: 'uuid',
  title: '实验标题',
  difficulty: 'intermediate'
})

// 知识点依赖关系
CREATE (kp1:KnowledgePoint)-[:DEPENDS_ON]->(kp2:KnowledgePoint)

// 实验关联知识点
CREATE (exp:Experiment)-[:TESTS]->(kp:KnowledgePoint)

// 学生掌握知识点
CREATE (s:Student)-[:MASTERS {level: 0.85, lastPracticed: datetime()}]->(kp:KnowledgePoint)
```

## 核心代码示例

### 1. 配置管理 (config/config.go)

```go
package config

import (
    "github.com/spf13/viper"
)

type Config struct {
    Server   ServerConfig
    Database DatabaseConfig
    Redis    RedisConfig
    Neo4j    Neo4jConfig
    JWT      JWTConfig
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
    Secret     string
    ExpireHours int
}

func Load() (*Config, error) {
    viper.SetConfigFile(".env")
    viper.AutomaticEnv()

    if err := viper.ReadInConfig(); err != nil {
        return nil, err
    }

    config := &Config{
        Server: ServerConfig{
            Port: viper.GetString("PORT"),
            Mode: viper.GetString("GIN_MODE"),
        },
        Database: DatabaseConfig{
            Host:     viper.GetString("DB_HOST"),
            Port:     viper.GetString("DB_PORT"),
            User:     viper.GetString("DB_USER"),
            Password: viper.GetString("DB_PASSWORD"),
            DBName:   viper.GetString("DB_NAME"),
        },
        Redis: RedisConfig{
            Host:     viper.GetString("REDIS_HOST"),
            Port:     viper.GetString("REDIS_PORT"),
            Password: viper.GetString("REDIS_PASSWORD"),
            DB:       viper.GetInt("REDIS_DB"),
        },
        Neo4j: Neo4jConfig{
            URI:      viper.GetString("NEO4J_URI"),
            User:     viper.GetString("NEO4J_USER"),
            Password: viper.GetString("NEO4J_PASSWORD"),
        },
        JWT: JWTConfig{
            Secret:     viper.GetString("JWT_SECRET"),
            ExpireHours: viper.GetInt("JWT_EXPIRE_HOURS"),
        },
    }

    return config, nil
}
```

### 2. 数据模型 (models/user.go)

```go
package models

import (
    "time"
    "github.com/google/uuid"
)

type User struct {
    ID             uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
    Username       string     `gorm:"uniqueIndex;not null" json:"username"`
    Email          string     `gorm:"uniqueIndex;not null" json:"email"`
    PasswordHash   string     `gorm:"not null" json:"-"`
    Role           string     `gorm:"not null" json:"role"` // admin, operator, teacher, student
    OrganizationID *uuid.UUID `json:"organization_id,omitempty"`
    CreatedAt      time.Time  `json:"created_at"`
    UpdatedAt      time.Time  `json:"updated_at"`
}

type Student struct {
    ID             uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
    UserID         uuid.UUID  `gorm:"uniqueIndex;not null" json:"user_id"`
    User           User       `gorm:"foreignKey:UserID" json:"user,omitempty"`
    StudentNumber  string     `gorm:"uniqueIndex" json:"student_number"`
    ClassID        *uuid.UUID `json:"class_id,omitempty"`
    MBTIType       string     `json:"mbti_type,omitempty"`
    EnrollmentYear int        `json:"enrollment_year"`
}

type StudentProfile struct {
    StudentID            uuid.UUID `json:"student_id"`
    ExperimentCompletion float64   `json:"experiment_completion"`    // 实验完成度
    KnowledgeMastery     float64   `json:"knowledge_mastery"`        // 知识点掌握率
    LearningActivity     float64   `json:"learning_activity"`        // 学习活跃度
    ExperimentAccuracy   float64   `json:"experiment_accuracy"`      // 实验正确率
    TotalLearningHours   int       `json:"total_learning_hours"`     // 总学习时长
    OverallScore         float64   `json:"overall_score"`            // 综合评分
}
```

### 3. 认证中间件 (middleware/auth.go)

```go
package middleware

import (
    "net/http"
    "strings"
    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
)

type Claims struct {
    UserID string `json:"user_id"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

func AuthMiddleware(jwtSecret string) gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "未提供认证令牌"})
            c.Abort()
            return
        }

        tokenString := strings.TrimPrefix(authHeader, "Bearer ")

        token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
            return []byte(jwtSecret), nil
        })

        if err != nil || !token.Valid {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "无效的令牌"})
            c.Abort()
            return
        }

        claims, ok := token.Claims.(*Claims)
        if !ok {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "无效的令牌声明"})
            c.Abort()
            return
        }

        c.Set("user_id", claims.UserID)
        c.Set("role", claims.Role)
        c.Next()
    }
}

func RequireRole(roles ...string) gin.HandlerFunc {
    return func(c *gin.Context) {
        userRole, exists := c.Get("role")
        if !exists {
            c.JSON(http.StatusForbidden, gin.H{"error": "无权限"})
            c.Abort()
            return
        }

        roleStr := userRole.(string)
        for _, role := range roles {
            if roleStr == role {
                c.Next()
                return
            }
        }

        c.JSON(http.StatusForbidden, gin.H{"error": "权限不足"})
        c.Abort()
    }
}
```

### 4. 学生画像服务 (service/analytics_service.go)

```go
package service

import (
    "context"
    "time"
    "github.com/google/uuid"
    "pathmind/internal/models"
    "pathmind/internal/repository/postgres"
)

type AnalyticsService struct {
    experimentRepo *postgres.ExperimentRepository
    learningRepo   *postgres.LearningRepository
    knowledgeRepo  *postgres.KnowledgeRepository
}

func NewAnalyticsService(
    experimentRepo *postgres.ExperimentRepository,
    learningRepo *postgres.LearningRepository,
    knowledgeRepo *postgres.KnowledgeRepository,
) *AnalyticsService {
    return &AnalyticsService{
        experimentRepo: experimentRepo,
        learningRepo:   learningRepo,
        knowledgeRepo:  knowledgeRepo,
    }
}

func (s *AnalyticsService) GetStudentProfile(ctx context.Context, studentID uuid.UUID) (*models.StudentProfile, error) {
    // 1. 计算实验完成度
    totalExperiments, err := s.experimentRepo.CountTotal(ctx)
    if err != nil {
        return nil, err
    }

    completedExperiments, err := s.experimentRepo.CountCompleted(ctx, studentID)
    if err != nil {
        return nil, err
    }

    experimentCompletion := float64(completedExperiments) / float64(totalExperiments)

    // 2. 计算知识点掌握率
    totalKnowledgePoints, err := s.knowledgeRepo.CountTotal(ctx)
    if err != nil {
        return nil, err
    }

    masteredKnowledgePoints, err := s.knowledgeRepo.CountMastered(ctx, studentID, 0.7) // 掌握度 >= 0.7
    if err != nil {
        return nil, err
    }

    knowledgeMastery := float64(masteredKnowledgePoints) / float64(totalKnowledgePoints)

    // 3. 计算学习活跃度 (近30天)
    thirtyDaysAgo := time.Now().AddDate(0, 0, -30)
    activeDays, err := s.learningRepo.CountActiveDays(ctx, studentID, thirtyDaysAgo)
    if err != nil {
        return nil, err
    }

    learningActivity := float64(activeDays) / 30.0

    // 4. 计算实验正确率
    correctExperiments, err := s.experimentRepo.CountCorrect(ctx, studentID)
    if err != nil {
        return nil, err
    }

    experimentAccuracy := 0.0
    if completedExperiments > 0 {
        experimentAccuracy = float64(correctExperiments) / float64(completedExperiments)
    }

    // 5. 计算总学习时长
    totalHours, err := s.learningRepo.GetTotalLearningHours(ctx, studentID)
    if err != nil {
        return nil, err
    }

    // 6. 计算综合评分
    overallScore := experimentCompletion*0.3 +
        knowledgeMastery*0.3 +
        learningActivity*0.2 +
        experimentAccuracy*0.2

    return &models.StudentProfile{
        StudentID:            studentID,
        ExperimentCompletion: experimentCompletion,
        KnowledgeMastery:     knowledgeMastery,
        LearningActivity:     learningActivity,
        ExperimentAccuracy:   experimentAccuracy,
        TotalLearningHours:   totalHours,
        OverallScore:         overallScore,
    }, nil
}
```

### 5. 主程序入口 (cmd/api/main.go)

```go
package main

import (
    "log"
    "github.com/gin-gonic/gin"
    "pathmind/internal/config"
    "pathmind/internal/handler"
    "pathmind/internal/middleware"
    "pathmind/internal/repository/postgres"
    "pathmind/internal/repository/neo4j"
    "pathmind/internal/repository/redis"
    "pathmind/internal/service"
)

func main() {
    // 加载配置
    cfg, err := config.Load()
    if err != nil {
        log.Fatal("Failed to load config:", err)
    }

    // 初始化数据库连接
    db, err := config.InitPostgres(&cfg.Database)
    if err != nil {
        log.Fatal("Failed to connect to PostgreSQL:", err)
    }

    neo4jDriver, err := config.InitNeo4j(&cfg.Neo4j)
    if err != nil {
        log.Fatal("Failed to connect to Neo4j:", err)
    }
    defer neo4jDriver.Close()

    redisClient := config.InitRedis(&cfg.Redis)

    // 初始化仓储层
    userRepo := postgres.NewUserRepository(db)
    experimentRepo := postgres.NewExperimentRepository(db)
    learningRepo := postgres.NewLearningRepository(db)
    knowledgeRepo := postgres.NewKnowledgeRepository(db)

    careerRepo := neo4j.NewCareerRepository(neo4jDriver)
    knowledgeGraphRepo := neo4j.NewKnowledgeGraphRepository(neo4jDriver)

    cacheRepo := redis.NewCacheRepository(redisClient)

    // 初始化服务层
    authService := service.NewAuthService(userRepo, cfg.JWT.Secret, cfg.JWT.ExpireHours)
    analyticsService := service.NewAnalyticsService(experimentRepo, learningRepo, knowledgeRepo)
    learningService := service.NewLearningService(careerRepo, knowledgeGraphRepo, cacheRepo)

    // 初始化处理器
    authHandler := handler.NewAuthHandler(authService)
    analyticsHandler := handler.NewAnalyticsHandler(analyticsService)
    learningHandler := handler.NewLearningHandler(learningService)

    // 设置 Gin
    gin.SetMode(cfg.Server.Mode)
    r := gin.Default()

    // 中间件
    r.Use(middleware.CORS())
    r.Use(middleware.Logger())
    r.Use(middleware.RateLimiter())

    // 公开路由
    public := r.Group("/api/v1")
    {
        public.POST("/auth/login", authHandler.Login)
        public.POST("/auth/register", authHandler.Register)
    }

    // 需要认证的路由
    protected := r.Group("/api/v1")
    protected.Use(middleware.AuthMiddleware(cfg.JWT.Secret))
    {
        // 学生路由
        student := protected.Group("/student")
        student.Use(middleware.RequireRole("student"))
        {
            student.GET("/profile", analyticsHandler.GetStudentProfile)
            student.GET("/learning-path", learningHandler.GetRecommendedPath)
        }

        // 教师路由
        teacher := protected.Group("/teacher")
        teacher.Use(middleware.RequireRole("teacher"))
        {
            teacher.GET("/class/:id/overview", analyticsHandler.GetClassOverview)
            teacher.GET("/class/:id/students", analyticsHandler.GetClassStudents)
        }

        // 运营路由
        operator := protected.Group("/operator")
        operator.Use(middleware.RequireRole("operator", "admin"))
        {
            operator.GET("/reports/learning", analyticsHandler.GetLearningReport)
            operator.GET("/reports/teachers", analyticsHandler.GetTeacherReport)
        }
    }

    // 启动服务器
    log.Printf("Server starting on port %s", cfg.Server.Port)
    if err := r.Run(":" + cfg.Server.Port); err != nil {
        log.Fatal("Failed to start server:", err)
    }
}
```

## 迁移步骤

### Step 1: 环境准备
```bash
# 安装 Go 1.21+
# 安装 PostgreSQL 15+
# 安装 Redis 7+
# 保持 Neo4j 5.15

# 初始化 Go 项目
mkdir server-go && cd server-go
go mod init github.com/yourusername/pathmind-server
```

### Step 2: 安装依赖
```bash
go get github.com/gin-gonic/gin
go get github.com/neo4j/neo4j-go-driver/v5
go get gorm.io/gorm
go get gorm.io/driver/postgres
go get github.com/redis/go-redis/v9
go get github.com/golang-jwt/jwt/v5
go get github.com/casbin/casbin/v2
go get go.uber.org/zap
go get github.com/spf13/viper
```

### Step 3: 数据库迁移
```bash
# 创建 PostgreSQL 数据库
createdb pathmind

# 运行迁移脚本
psql -d pathmind -f migrations/postgres/001_initial_schema.sql

# Neo4j 保持现有数据，添加新约束
```

### Step 4: 逐步迁移 API
1. 先迁移认证相关 API
2. 再迁移查询类 API
3. 最后迁移写入类 API
4. 保持新旧系统并行运行一段时间

### Step 5: 性能测试
```bash
# 使用 wrk 或 ab 进行压力测试
wrk -t12 -c400 -d30s http://localhost:3001/api/v1/careers

# 监控指标
# - QPS (每秒请求数)
# - 响应时间 (P50, P95, P99)
# - 错误率
# - CPU/内存使用率
```

## 性能对比预期

| 指标 | Node.js (当前) | Go (预期) | 提升 |
|------|---------------|-----------|------|
| QPS | ~2000 | ~10000 | 5x |
| P95 延迟 | ~200ms | ~50ms | 4x |
| 内存占用 | ~500MB | ~100MB | 5x |
| CPU 使用率 | ~80% | ~40% | 2x |

## 注意事项

1. **数据一致性**: 迁移期间确保 PostgreSQL 和 Neo4j 数据同步
2. **API 兼容性**: 保持 API 接口不变，前端无需修改
3. **错误处理**: 完善的错误日志和监控
4. **测试覆盖**: 单元测试 + 集成测试覆盖率 > 80%
5. **文档更新**: 及时更新 API 文档和部署文档
