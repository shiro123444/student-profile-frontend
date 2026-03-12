package service

import (
	"errors"

	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

type ToolService struct {
	db     *gorm.DB
	logger *zap.Logger
}

func NewToolService(db *gorm.DB, logger *zap.Logger) *ToolService {
	return &ToolService{db: db, logger: logger}
}

// CreateTool creates a new custom tool
func (s *ToolService) CreateTool(tool *models.CustomTool) error {
	return s.db.Create(tool).Error
}

// GetTool retrieves a tool by ID
func (s *ToolService) GetTool(id uuid.UUID) (*models.CustomTool, error) {
	var tool models.CustomTool
	if err := s.db.Preload("Creator").First(&tool, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &tool, nil
}

// ListTools returns tools visible to a user (own + public approved)
func (s *ToolService) ListTools(userID uuid.UUID, role string) ([]models.CustomTool, error) {
	var tools []models.CustomTool
	query := s.db.Where("is_active = ?", true)

	if role == "admin" {
		// Admin sees all
	} else {
		// User sees own tools + public approved tools
		query = query.Where("created_by = ? OR (is_public = ? AND is_approved = ?)", userID, true, true)
	}

	if err := query.Order("created_at DESC").Find(&tools).Error; err != nil {
		return nil, err
	}
	return tools, nil
}

// ListActiveApproved returns all active+approved tools (for Python service to load)
func (s *ToolService) ListActiveApproved() ([]models.CustomTool, error) {
	var tools []models.CustomTool
	err := s.db.Where("is_active = ? AND is_approved = ?", true, true).Find(&tools).Error
	return tools, err
}

// UpdateTool updates a tool (only owner or admin)
func (s *ToolService) UpdateTool(id uuid.UUID, userID uuid.UUID, role string, updates map[string]interface{}) error {
	query := s.db.Model(&models.CustomTool{}).Where("id = ?", id)
	if role != "admin" {
		query = query.Where("created_by = ?", userID)
	}
	result := query.Updates(updates)
	if result.RowsAffected == 0 {
		return errors.New("tool not found or permission denied")
	}
	return result.Error
}

// DeleteTool soft-deletes a tool
func (s *ToolService) DeleteTool(id uuid.UUID, userID uuid.UUID, role string) error {
	query := s.db.Model(&models.CustomTool{}).Where("id = ?", id)
	if role != "admin" {
		query = query.Where("created_by = ?", userID)
	}
	result := query.Update("is_active", false)
	if result.RowsAffected == 0 {
		return errors.New("tool not found or permission denied")
	}
	return result.Error
}

// ApproveTool approves a tool (admin only)
func (s *ToolService) ApproveTool(id uuid.UUID) error {
	return s.db.Model(&models.CustomTool{}).Where("id = ?", id).Update("is_approved", true).Error
}

// IncrementUsage bumps the usage counter
func (s *ToolService) IncrementUsage(id uuid.UUID) error {
	return s.db.Model(&models.CustomTool{}).Where("id = ?", id).
		UpdateColumn("usage_count", gorm.Expr("usage_count + 1")).Error
}

// ── Skills ──

// CreateSkill creates a new custom skill
func (s *ToolService) CreateSkill(skill *models.CustomSkill) error {
	return s.db.Create(skill).Error
}

// GetSkill retrieves a skill by ID
func (s *ToolService) GetSkill(id uuid.UUID) (*models.CustomSkill, error) {
	var skill models.CustomSkill
	if err := s.db.Preload("Creator").First(&skill, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

// ListSkills returns skills visible to a user
func (s *ToolService) ListSkills(userID uuid.UUID, role string) ([]models.CustomSkill, error) {
	var skills []models.CustomSkill
	query := s.db.Where("is_active = ?", true)

	if role == "admin" {
		// Admin sees all
	} else {
		query = query.Where("created_by = ? OR (is_public = ? AND is_approved = ?)", userID, true, true)
	}

	if err := query.Order("created_at DESC").Find(&skills).Error; err != nil {
		return nil, err
	}
	return skills, nil
}

// ListActiveApprovedSkills returns all active+approved skills
func (s *ToolService) ListActiveApprovedSkills() ([]models.CustomSkill, error) {
	var skills []models.CustomSkill
	err := s.db.Where("is_active = ? AND is_approved = ?", true, true).Find(&skills).Error
	return skills, err
}

// UpdateSkill updates a skill
func (s *ToolService) UpdateSkill(id uuid.UUID, userID uuid.UUID, role string, updates map[string]interface{}) error {
	query := s.db.Model(&models.CustomSkill{}).Where("id = ?", id)
	if role != "admin" {
		query = query.Where("created_by = ?", userID)
	}
	result := query.Updates(updates)
	if result.RowsAffected == 0 {
		return errors.New("skill not found or permission denied")
	}
	return result.Error
}

// DeleteSkill soft-deletes a skill
func (s *ToolService) DeleteSkill(id uuid.UUID, userID uuid.UUID, role string) error {
	query := s.db.Model(&models.CustomSkill{}).Where("id = ?", id)
	if role != "admin" {
		query = query.Where("created_by = ?", userID)
	}
	result := query.Update("is_active", false)
	if result.RowsAffected == 0 {
		return errors.New("skill not found or permission denied")
	}
	return result.Error
}

// ApproveSkill approves a skill (admin only)
func (s *ToolService) ApproveSkill(id uuid.UUID) error {
	return s.db.Model(&models.CustomSkill{}).Where("id = ?", id).Update("is_approved", true).Error
}
