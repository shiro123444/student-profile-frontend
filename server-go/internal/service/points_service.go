package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
	"pathmind-server/internal/repository/redis"
)

// PointsConfig holds points system configuration
type PointsConfig struct {
	DailyCheckinBase   int
	StreakMultiplier    float64
	MaxStreakBonus      int
	CreditExchangeRate float64 // points per $0.01
}

// DefaultPointsConfig returns default points configuration
func DefaultPointsConfig() PointsConfig {
	return PointsConfig{
		DailyCheckinBase:   10,
		StreakMultiplier:    0.5,
		MaxStreakBonus:      50,
		CreditExchangeRate: 100, // 100 points = $0.01
	}
}

// PointsService handles points, credits, and gamification
type PointsService struct {
	db     *gorm.DB
	cache  *redis.CacheRepository
	config PointsConfig
	logger *zap.Logger
}

// NewPointsService creates a new PointsService
func NewPointsService(db *gorm.DB, cache *redis.CacheRepository, logger *zap.Logger) *PointsService {
	return &PointsService{
		db:     db,
		cache:  cache,
		config: DefaultPointsConfig(),
		logger: logger,
	}
}

// GetBalance retrieves a student's current point and credit balance
func (s *PointsService) GetBalance(ctx context.Context, studentID uuid.UUID) (*models.PointBalance, error) {
	var balance models.PointBalance
	result := s.db.WithContext(ctx).Where("student_id = ?", studentID).First(&balance)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			// Initialize balance for new student
			balance = models.PointBalance{
				StudentID: studentID,
				Points:    0,
				Credits:   0,
				UpdatedAt: time.Now(),
			}
			if err := s.db.WithContext(ctx).Create(&balance).Error; err != nil {
				return nil, err
			}
		} else {
			return nil, result.Error
		}
	}
	return &balance, nil
}

// DailyCheckin performs a daily check-in for a student
func (s *PointsService) DailyCheckin(ctx context.Context, studentID uuid.UUID) (int, int, error) {
	today := time.Now().Truncate(24 * time.Hour)

	// Check if already checked in today
	var existing models.DailyCheckin
	if err := s.db.WithContext(ctx).
		Where("student_id = ? AND checkin_date = ?", studentID, today).
		First(&existing).Error; err == nil {
		return 0, 0, fmt.Errorf("already checked in today")
	}

	// Get current balance to calculate streak
	balance, err := s.GetBalance(ctx, studentID)
	if err != nil {
		return 0, 0, err
	}

	// Calculate streak
	streakDays := 0
	if balance.LastCheckinDate != nil {
		yesterday := today.AddDate(0, 0, -1)
		lastCheckin := balance.LastCheckinDate.Truncate(24 * time.Hour)
		if lastCheckin.Equal(yesterday) {
			streakDays = balance.StreakDays + 1
		}
	}

	// Calculate bonus
	streakBonus := int(math.Min(
		float64(streakDays)*s.config.StreakMultiplier*float64(s.config.DailyCheckinBase),
		float64(s.config.MaxStreakBonus),
	))
	totalPoints := s.config.DailyCheckinBase + streakBonus

	// Create checkin record
	checkin := models.DailyCheckin{
		StudentID:     studentID,
		CheckinDate:   today,
		PointsAwarded: totalPoints,
		StreakBonus:    streakBonus,
		CreatedAt:     time.Now(),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&checkin).Error; err != nil {
			return err
		}
		return s.addPointsTx(tx, ctx, studentID, totalPoints, "daily_checkin", nil, "每日签到")
	})

	if err != nil {
		return 0, 0, err
	}

	return totalPoints, streakBonus, nil
}

// AwardPoints adds points for a specific action
func (s *PointsService) AwardPoints(ctx context.Context, studentID uuid.UUID, amount int, txType string, refID *uuid.UUID, desc string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return s.addPointsTx(tx, ctx, studentID, amount, txType, refID, desc)
	})
}

// ExchangeCredits converts points to AI credits
func (s *PointsService) ExchangeCredits(ctx context.Context, studentID uuid.UUID, points int) (float64, error) {
	if points <= 0 || points%int(s.config.CreditExchangeRate) != 0 {
		return 0, fmt.Errorf("points must be a positive multiple of %d", int(s.config.CreditExchangeRate))
	}

	credits := float64(points) / s.config.CreditExchangeRate * 0.01

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check sufficient points
		var balance models.PointBalance
		if err := tx.Where("student_id = ?", studentID).First(&balance).Error; err != nil {
			return err
		}
		if balance.Points < points {
			return fmt.Errorf("insufficient points: have %d, need %d", balance.Points, points)
		}

		// Deduct points
		if err := s.addPointsTx(tx, ctx, studentID, -points, "credit_exchange", nil, fmt.Sprintf("兑换 $%.4f AI 额度", credits)); err != nil {
			return err
		}

		// Add credits
		return tx.Model(&models.PointBalance{}).
			Where("student_id = ?", studentID).
			Update("credits", gorm.Expr("credits + ?", credits)).Error
	})

	return credits, err
}

// DeductCredits deducts AI credits for agent usage
func (s *PointsService) DeductCredits(ctx context.Context, studentID uuid.UUID, amount float64, agentName string) error {
	result := s.db.WithContext(ctx).Model(&models.PointBalance{}).
		Where("student_id = ? AND credits >= ?", studentID, amount).
		Update("credits", gorm.Expr("credits - ?", amount))
	if result.RowsAffected == 0 {
		return fmt.Errorf("insufficient credits")
	}
	return result.Error
}

// GetTransactions retrieves point transaction history
func (s *PointsService) GetTransactions(ctx context.Context, studentID uuid.UUID, page, pageSize int) ([]models.PointTransaction, int64, error) {
	var total int64
	s.db.WithContext(ctx).Model(&models.PointTransaction{}).
		Where("student_id = ?", studentID).Count(&total)

	var txns []models.PointTransaction
	offset := (page - 1) * pageSize
	err := s.db.WithContext(ctx).
		Where("student_id = ?", studentID).
		Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&txns).Error

	return txns, total, err
}

// GetLeaderboard retrieves the top students by points
func (s *PointsService) GetLeaderboard(ctx context.Context, limit int) ([]map[string]interface{}, error) {
	var results []map[string]interface{}
	err := s.db.WithContext(ctx).Raw(`
		SELECT pb.student_id, u.username, s.student_number,
		       pb.points, pb.total_earned, pb.streak_days,
		       COALESCE(sp.level, 'D') as level
		FROM point_balances pb
		JOIN students s ON pb.student_id = s.id
		JOIN users u ON s.user_id = u.id
		LEFT JOIN student_profiles sp ON pb.student_id = sp.student_id
		WHERE u.is_active = true
		ORDER BY pb.points DESC
		LIMIT ?
	`, limit).Scan(&results).Error
	return results, err
}

// addPointsTx is the internal transaction helper
func (s *PointsService) addPointsTx(tx *gorm.DB, ctx context.Context, studentID uuid.UUID, amount int, txType string, refID *uuid.UUID, desc string) error {
	// Ensure balance exists
	var balance models.PointBalance
	if err := tx.Where("student_id = ?", studentID).First(&balance).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			balance = models.PointBalance{StudentID: studentID, UpdatedAt: time.Now()}
			if err := tx.Create(&balance).Error; err != nil {
				return err
			}
		} else {
			return err
		}
	}

	newBalance := balance.Points + amount

	// Update balance
	updates := map[string]interface{}{
		"points":     newBalance,
		"updated_at": time.Now(),
	}
	if amount > 0 {
		updates["total_earned"] = gorm.Expr("total_earned + ?", amount)
	} else {
		updates["total_spent"] = gorm.Expr("total_spent + ?", -amount)
	}
	if txType == "daily_checkin" {
		today := time.Now().Truncate(24 * time.Hour)
		updates["last_checkin_date"] = today
		if balance.LastCheckinDate != nil {
			yesterday := today.AddDate(0, 0, -1)
			if balance.LastCheckinDate.Truncate(24*time.Hour).Equal(yesterday) {
				updates["streak_days"] = gorm.Expr("streak_days + 1")
			} else {
				updates["streak_days"] = 1
			}
		} else {
			updates["streak_days"] = 1
		}
	}

	if err := tx.Model(&models.PointBalance{}).Where("student_id = ?", studentID).Updates(updates).Error; err != nil {
		return err
	}

	// Record transaction
	txn := models.PointTransaction{
		StudentID:       studentID,
		Amount:          amount,
		BalanceAfter:    newBalance,
		TransactionType: txType,
		ReferenceID:     refID,
		Description:     desc,
		CreatedAt:       time.Now(),
	}
	return tx.Create(&txn).Error
}
