package service

import (
	"context"
	"fmt"
	"time"

	"pathmind-server/internal/repository/redis"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// StatsService provides platform-level aggregate statistics.
type StatsService struct {
	db     *gorm.DB
	cache  *redis.CacheRepository
	logger *zap.Logger
}

func NewStatsService(db *gorm.DB, cache *redis.CacheRepository, logger *zap.Logger) *StatsService {
	return &StatsService{db: db, cache: cache, logger: logger}
}

// PlatformStats holds aggregate platform metrics.
type PlatformStats struct {
	TotalUsers          int64 `json:"total_users"`
	CompletedExperiments int64 `json:"completed_experiments"`
	MBTITestsCompleted  int64 `json:"mbti_tests_completed"`
	ActiveLearningPaths int64 `json:"active_learning_paths"`
}

// TrendingCareer represents a popular career recommendation.
type TrendingCareer struct {
	CareerName  string `json:"career_name"`
	MBTITypes   string `json:"mbti_types"`
	Popularity  int64  `json:"popularity"`
	Description string `json:"description"`
}

// FeaturedExperiment represents a popular experiment.
type FeaturedExperiment struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	Difficulty     string  `json:"difficulty"`
	CompletionRate float64 `json:"completion_rate"`
	TotalAttempts  int64   `json:"total_attempts"`
}

// GetPlatformStats returns aggregate platform statistics with caching.
func (s *StatsService) GetPlatformStats(ctx context.Context) (*PlatformStats, error) {
	cacheKey := "stats:platform"
	var stats PlatformStats

	if err := s.cache.Get(ctx, cacheKey, &stats); err == nil && stats.TotalUsers > 0 {
		return &stats, nil
	}

	// Total users
	if err := s.db.WithContext(ctx).Table("users").Count(&stats.TotalUsers).Error; err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}

	// Completed experiments
	if err := s.db.WithContext(ctx).Table("student_experiments").
		Where("status = ?", "completed").
		Count(&stats.CompletedExperiments).Error; err != nil {
		return nil, fmt.Errorf("count experiments: %w", err)
	}

	// MBTI tests completed
	if err := s.db.WithContext(ctx).Table("mbti_test_results").
		Count(&stats.MBTITestsCompleted).Error; err != nil {
		return nil, fmt.Errorf("count mbti tests: %w", err)
	}

	// Active learning paths (students with activity in last 30 days)
	thirtyDaysAgo := time.Now().AddDate(0, 0, -30)
	if err := s.db.WithContext(ctx).Table("learning_records").
		Where("created_at > ?", thirtyDaysAgo).
		Distinct("student_id").
		Count(&stats.ActiveLearningPaths).Error; err != nil {
		return nil, fmt.Errorf("count active paths: %w", err)
	}

	_ = s.cache.Set(ctx, cacheKey, &stats, 10*time.Minute)
	return &stats, nil
}

// GetTrendingCareers returns the most recommended careers based on MBTI distribution.
func (s *StatsService) GetTrendingCareers(ctx context.Context, limit int) ([]TrendingCareer, error) {
	cacheKey := fmt.Sprintf("stats:trending_careers:%d", limit)
	var careers []TrendingCareer

	if err := s.cache.Get(ctx, cacheKey, &careers); err == nil && len(careers) > 0 {
		return careers, nil
	}

	// Query most common MBTI types and map to career suggestions
	type mbtiCount struct {
		MBTICode string
		Count    int64
	}
	var topTypes []mbtiCount

	if err := s.db.WithContext(ctx).Table("mbti_test_results").
		Select("mbti_code, COUNT(*) as count").
		Group("mbti_code").
		Order("count DESC").
		Limit(limit).
		Find(&topTypes).Error; err != nil {
		return nil, fmt.Errorf("query trending: %w", err)
	}

	// Map MBTI types to career suggestions
	careerMap := map[string]TrendingCareer{
		"INTJ": {CareerName: "AI 算法工程师", MBTITypes: "INTJ", Description: "设计和优化机器学习模型，适合战略性思维者"},
		"INTP": {CareerName: "数据科学家", MBTITypes: "INTP", Description: "探索数据中的模式和洞察，适合逻辑分析者"},
		"ENTJ": {CareerName: "技术项目经理", MBTITypes: "ENTJ", Description: "领导技术团队交付复杂项目，适合天生领导者"},
		"ENTP": {CareerName: "产品经理", MBTITypes: "ENTP", Description: "定义产品方向和创新策略，适合创意思考者"},
		"INFJ": {CareerName: "UX 研究员", MBTITypes: "INFJ", Description: "深入理解用户需求和行为，适合洞察力强的人"},
		"INFP": {CareerName: "技术写作", MBTITypes: "INFP", Description: "将复杂技术转化为清晰文档，适合表达力强的人"},
		"ENFJ": {CareerName: "技术培训师", MBTITypes: "ENFJ", Description: "帮助团队成长和学习新技术，适合天生教育者"},
		"ENFP": {CareerName: "开发者关系", MBTITypes: "ENFP", Description: "连接开发者社区和产品团队，适合热情沟通者"},
		"ISTJ": {CareerName: "后端工程师", MBTITypes: "ISTJ", Description: "构建可靠稳定的服务端系统，适合务实执行者"},
		"ISFJ": {CareerName: "QA 工程师", MBTITypes: "ISFJ", Description: "确保软件质量和用户体验，适合细心守护者"},
		"ESTJ": {CareerName: "DevOps 工程师", MBTITypes: "ESTJ", Description: "管理部署流程和基础设施，适合高效组织者"},
		"ESFJ": {CareerName: "客户成功经理", MBTITypes: "ESFJ", Description: "帮助客户实现技术目标，适合热心协调者"},
		"ISTP": {CareerName: "安全工程师", MBTITypes: "ISTP", Description: "发现和修复安全漏洞，适合冷静实践者"},
		"ISFP": {CareerName: "前端工程师", MBTITypes: "ISFP", Description: "创造美观的用户界面，适合审美敏感的人"},
		"ESTP": {CareerName: "全栈工程师", MBTITypes: "ESTP", Description: "快速构建端到端解决方案，适合行动派"},
		"ESFP": {CareerName: "游戏开发者", MBTITypes: "ESFP", Description: "创造有趣的互动体验，适合活力创造者"},
	}

	for _, tc := range topTypes {
		if career, ok := careerMap[tc.MBTICode]; ok {
			career.Popularity = tc.Count
			careers = append(careers, career)
		}
	}

	// Fallback if no MBTI data yet
	if len(careers) == 0 {
		careers = []TrendingCareer{
			{CareerName: "AI 算法工程师", MBTITypes: "INTJ/INTP", Popularity: 0, Description: "设计和优化机器学习模型"},
			{CareerName: "全栈工程师", MBTITypes: "ESTP/ISTP", Popularity: 0, Description: "快速构建端到端解决方案"},
			{CareerName: "数据科学家", MBTITypes: "INTP/INTJ", Popularity: 0, Description: "探索数据中的模式和洞察"},
			{CareerName: "产品经理", MBTITypes: "ENTP/ENTJ", Popularity: 0, Description: "定义产品方向和创新策略"},
			{CareerName: "前端工程师", MBTITypes: "ISFP/INFP", Popularity: 0, Description: "创造美观的用户界面"},
		}
	}

	_ = s.cache.Set(ctx, cacheKey, &careers, 30*time.Minute)
	return careers, nil
}

// GetFeaturedExperiments returns the most popular experiments by completion rate.
func (s *StatsService) GetFeaturedExperiments(ctx context.Context, limit int) ([]FeaturedExperiment, error) {
	cacheKey := fmt.Sprintf("stats:featured_experiments:%d", limit)
	var featured []FeaturedExperiment

	if err := s.cache.Get(ctx, cacheKey, &featured); err == nil && len(featured) > 0 {
		return featured, nil
	}

	// Query experiments with highest completion rates
	rows, err := s.db.WithContext(ctx).Raw(`
		SELECT
			e.id,
			e.title,
			e.difficulty,
			COUNT(se.id) AS total_attempts,
			COALESCE(SUM(CASE WHEN se.status = 'completed' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(se.id), 0), 0) AS completion_rate
		FROM experiments e
		LEFT JOIN student_experiments se ON se.experiment_id = e.id
		GROUP BY e.id, e.title, e.difficulty
		HAVING COUNT(se.id) > 0
		ORDER BY completion_rate DESC, total_attempts DESC
		LIMIT ?
	`, limit).Rows()
	if err != nil {
		return nil, fmt.Errorf("query featured experiments: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var f FeaturedExperiment
		if err := rows.Scan(&f.ID, &f.Title, &f.Difficulty, &f.TotalAttempts, &f.CompletionRate); err != nil {
			continue
		}
		featured = append(featured, f)
	}

	// Fallback if no experiment data
	if len(featured) == 0 {
		featured = []FeaturedExperiment{
			{Title: "Python 基础入门", Difficulty: "beginner", CompletionRate: 0.85, TotalAttempts: 0},
			{Title: "机器学习实战", Difficulty: "intermediate", CompletionRate: 0.72, TotalAttempts: 0},
			{Title: "深度学习项目", Difficulty: "advanced", CompletionRate: 0.58, TotalAttempts: 0},
		}
	}

	_ = s.cache.Set(ctx, cacheKey, &featured, 30*time.Minute)
	return featured, nil
}
