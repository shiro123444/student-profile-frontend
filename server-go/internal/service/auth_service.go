package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"pathmind-server/internal/repository/postgres"
	"pathmind-server/internal/utils"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type AuthService struct {
	userRepo    *postgres.UserRepository
	jwtSecret   string
	jwtExpHours int
	logger      *zap.Logger
}

func NewAuthService(userRepo *postgres.UserRepository, jwtSecret string, jwtExpHours int, logger *zap.Logger) *AuthService {
	return &AuthService{
		userRepo:    userRepo,
		jwtSecret:   jwtSecret,
		jwtExpHours: jwtExpHours,
		logger:      logger,
	}
}

type RegisterRequest struct {
	Username      string `json:"username" binding:"required,min=3,max=50"`
	Email         string `json:"email" binding:"required,email"`
	Password      string `json:"password" binding:"required,min=6"`
	StudentNumber string `json:"student_number"`
	Role          string `json:"role"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	Token string       `json:"token"`
	User  UserResponse `json:"user"`
}

type UserResponse struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
}

// Register creates a new user and returns a JWT token
func (s *AuthService) Register(ctx context.Context, req RegisterRequest) (*AuthResponse, error) {
	// Check if username already exists
	existing, _ := s.userRepo.FindByUsername(ctx, req.Username)
	if existing != nil {
		return nil, errors.New("username already exists")
	}

	// Check if email already exists
	existing, _ = s.userRepo.FindByEmail(ctx, req.Email)
	if existing != nil {
		return nil, errors.New("email already exists")
	}

	// Hash password
	passwordHash, err := utils.HashPassword(req.Password)
	if err != nil {
		s.logger.Error("Failed to hash password", zap.Error(err))
		return nil, errors.New("internal error")
	}

	// Default role to student
	role := req.Role
	if role == "" {
		role = "student"
	}

	// Create user
	user := &models.User{
		ID:           uuid.New(),
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: passwordHash,
		Role:         role,
		IsActive:     true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := s.userRepo.CreateUser(ctx, user); err != nil {
		s.logger.Error("Failed to create user", zap.Error(err))
		return nil, errors.New("failed to create user")
	}

	// If student role, create student record
	if role == "student" && req.StudentNumber != "" {
		student := &models.Student{
			ID:             uuid.New(),
			UserID:         user.ID,
			StudentNumber:  req.StudentNumber,
			EnrollmentYear: time.Now().Year(),
			CreatedAt:      time.Now(),
		}
		if err := s.userRepo.CreateStudent(ctx, student); err != nil {
			s.logger.Error("Failed to create student record", zap.Error(err))
			// User created but student record failed - not critical
		}
	}

	// Generate JWT
	token, err := utils.GenerateToken(user.ID, user.Role, s.jwtSecret, s.jwtExpHours)
	if err != nil {
		s.logger.Error("Failed to generate token", zap.Error(err))
		return nil, errors.New("failed to generate token")
	}

	return &AuthResponse{
		Token: token,
		User: UserResponse{
			ID:       user.ID,
			Username: user.Username,
			Email:    user.Email,
			Role:     user.Role,
		},
	}, nil
}

// Login authenticates a user and returns a JWT token
func (s *AuthService) Login(ctx context.Context, req LoginRequest) (*AuthResponse, error) {
	user, err := s.userRepo.FindByUsername(ctx, req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("invalid username or password")
		}
		s.logger.Error("Failed to find user", zap.Error(err))
		return nil, errors.New("internal error")
	}

	if !utils.CheckPassword(req.Password, user.PasswordHash) {
		return nil, errors.New("invalid username or password")
	}

	if !user.IsActive {
		return nil, errors.New("account is disabled")
	}

	// Generate JWT
	token, err := utils.GenerateToken(user.ID, user.Role, s.jwtSecret, s.jwtExpHours)
	if err != nil {
		s.logger.Error("Failed to generate token", zap.Error(err))
		return nil, errors.New("failed to generate token")
	}

	return &AuthResponse{
		Token: token,
		User: UserResponse{
			ID:       user.ID,
			Username: user.Username,
			Email:    user.Email,
			Role:     user.Role,
		},
	}, nil
}

// GetCurrentUser retrieves the current user's info
func (s *AuthService) GetCurrentUser(ctx context.Context, userID uuid.UUID) (*UserResponse, error) {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return nil, errors.New("user not found")
	}

	return &UserResponse{
		ID:       user.ID,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
	}, nil
}

// RefreshToken generates a new JWT token for an existing user
func (s *AuthService) RefreshToken(ctx context.Context, userID uuid.UUID, role string) (string, error) {
	token, err := utils.GenerateToken(userID, role, s.jwtSecret, s.jwtExpHours)
	if err != nil {
		s.logger.Error("Failed to refresh token", zap.Error(err))
		return "", errors.New("failed to refresh token")
	}
	return token, nil
}
