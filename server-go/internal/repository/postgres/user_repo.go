package postgres

import (
	"context"

	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type UserRepository struct {
	db     *gorm.DB
	logger *zap.Logger
}

func NewUserRepository(db *gorm.DB, logger *zap.Logger) *UserRepository {
	return &UserRepository{
		db:     db,
		logger: logger,
	}
}

// FindByUsername retrieves a user by username
func (r *UserRepository) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// FindByEmail retrieves a user by email
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// FindByID retrieves a user by ID
func (r *UserRepository) FindByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).First(&user, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// CreateUser creates a new user
func (r *UserRepository) CreateUser(ctx context.Context, user *models.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

// CreateStudent creates a new student record linked to a user
func (r *UserRepository) CreateStudent(ctx context.Context, student *models.Student) error {
	return r.db.WithContext(ctx).Create(student).Error
}

// FindStudentByUserID retrieves a student by user ID
func (r *UserRepository) FindStudentByUserID(ctx context.Context, userID uuid.UUID) (*models.Student, error) {
	var student models.Student
	err := r.db.WithContext(ctx).
		Preload("User").
		Preload("Class").
		Where("user_id = ?", userID).
		First(&student).Error
	if err != nil {
		return nil, err
	}
	return &student, nil
}

// FindStudentByStudentNumber retrieves a student by student number
func (r *UserRepository) FindStudentByStudentNumber(ctx context.Context, studentNumber string) (*models.Student, error) {
	var student models.Student
	err := r.db.WithContext(ctx).
		Preload("User").
		Where("student_number = ?", studentNumber).
		First(&student).Error
	if err != nil {
		return nil, err
	}
	return &student, nil
}
