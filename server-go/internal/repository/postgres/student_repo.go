package postgres

import (
	"context"

	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type StudentRepository struct {
	db     *gorm.DB
	logger *zap.Logger
}

func NewStudentRepository(db *gorm.DB, logger *zap.Logger) *StudentRepository {
	return &StudentRepository{
		db:     db,
		logger: logger,
	}
}

// GetStudentByID retrieves a student by ID
func (r *StudentRepository) GetStudentByID(ctx context.Context, id uuid.UUID) (*models.Student, error) {
	var student models.Student
	err := r.db.WithContext(ctx).
		Preload("User").
		Preload("Class").
		First(&student, "id = ?", id).Error

	if err != nil {
		r.logger.Error("Failed to get student by ID", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	return &student, nil
}

// GetStudentByUserID retrieves a student by user ID
func (r *StudentRepository) GetStudentByUserID(ctx context.Context, userID uuid.UUID) (*models.Student, error) {
	var student models.Student
	err := r.db.WithContext(ctx).
		Preload("User").
		Preload("Class").
		First(&student, "user_id = ?", userID).Error

	if err != nil {
		r.logger.Error("Failed to get student by user ID", zap.String("userID", userID.String()), zap.Error(err))
		return nil, err
	}

	return &student, nil
}

// GetStudentsByClassID retrieves all students in a class
func (r *StudentRepository) GetStudentsByClassID(ctx context.Context, classID uuid.UUID) ([]models.Student, error) {
	var students []models.Student
	err := r.db.WithContext(ctx).
		Preload("User").
		Where("class_id = ?", classID).
		Find(&students).Error

	if err != nil {
		r.logger.Error("Failed to get students by class ID", zap.String("classID", classID.String()), zap.Error(err))
		return nil, err
	}

	return students, nil
}

// CreateStudent creates a new student
func (r *StudentRepository) CreateStudent(ctx context.Context, student *models.Student) error {
	err := r.db.WithContext(ctx).Create(student).Error
	if err != nil {
		r.logger.Error("Failed to create student", zap.Error(err))
		return err
	}

	return nil
}

// UpdateStudent updates a student
func (r *StudentRepository) UpdateStudent(ctx context.Context, student *models.Student) error {
	err := r.db.WithContext(ctx).Save(student).Error
	if err != nil {
		r.logger.Error("Failed to update student", zap.String("id", student.ID.String()), zap.Error(err))
		return err
	}

	return nil
}

// GetStudentProfile retrieves a student's profile
func (r *StudentRepository) GetStudentProfile(ctx context.Context, studentID uuid.UUID) (*models.StudentProfile, error) {
	var profile models.StudentProfile
	err := r.db.WithContext(ctx).
		Preload("Student.User").
		First(&profile, "student_id = ?", studentID).Error

	if err != nil {
		r.logger.Error("Failed to get student profile", zap.String("studentID", studentID.String()), zap.Error(err))
		return nil, err
	}

	return &profile, nil
}

// UpdateStudentProfile updates or creates a student profile
func (r *StudentRepository) UpdateStudentProfile(ctx context.Context, profile *models.StudentProfile) error {
	err := r.db.WithContext(ctx).
		Where("student_id = ?", profile.StudentID).
		Assign(profile).
		FirstOrCreate(profile).Error

	if err != nil {
		r.logger.Error("Failed to update student profile", zap.String("studentID", profile.StudentID.String()), zap.Error(err))
		return err
	}

	return nil
}

// GetClassOverview retrieves overview statistics for a class
func (r *StudentRepository) GetClassOverview(ctx context.Context, classID uuid.UUID) (*models.ClassOverview, error) {
	var overview models.ClassOverview

	query := `
		SELECT
			c.id as class_id,
			c.name as class_name,
			COUNT(DISTINCT s.id) as student_count,
			AVG(sp.experiment_completion) as avg_experiment_completion,
			AVG(sp.knowledge_mastery) as avg_knowledge_mastery,
			AVG(sp.learning_activity) as avg_learning_activity,
			AVG(sp.experiment_accuracy) as avg_experiment_accuracy,
			AVG(sp.overall_score) as overall_score
		FROM classes c
		LEFT JOIN students s ON s.class_id = c.id
		LEFT JOIN student_profiles sp ON sp.student_id = s.id
		WHERE c.id = ?
		GROUP BY c.id, c.name
	`

	err := r.db.WithContext(ctx).Raw(query, classID).Scan(&overview).Error
	if err != nil {
		r.logger.Error("Failed to get class overview", zap.String("classID", classID.String()), zap.Error(err))
		return nil, err
	}

	// Calculate level based on overall score
	if overview.OverallScore >= 0.9 {
		overview.Level = "S"
	} else if overview.OverallScore >= 0.8 {
		overview.Level = "A"
	} else if overview.OverallScore >= 0.7 {
		overview.Level = "B"
	} else if overview.OverallScore >= 0.6 {
		overview.Level = "C"
	} else {
		overview.Level = "D"
	}

	return &overview, nil
}

// GetStudentAlerts retrieves students who need attention
func (r *StudentRepository) GetStudentAlerts(ctx context.Context, classID uuid.UUID) ([]models.StudentAlert, error) {
	var alerts []models.StudentAlert

	query := `
		SELECT
			s.id as student_id,
			s.student_number,
			u.username,
			CASE
				WHEN sp.learning_activity < 0.3 THEN 'inactive'
				WHEN sp.experiment_completion < 0.5 THEN 'low_completion'
				WHEN sp.experiment_accuracy < 0.6 THEN 'struggling'
				ELSE 'normal'
			END as alert_type,
			CASE
				WHEN sp.learning_activity < 0.3 THEN '学习活跃度过低'
				WHEN sp.experiment_completion < 0.5 THEN '实验完成度不足'
				WHEN sp.experiment_accuracy < 0.6 THEN '实验正确率偏低'
				ELSE '正常'
			END as alert_message,
			CASE
				WHEN sp.learning_activity < 0.2 OR sp.experiment_completion < 0.3 THEN 'high'
				WHEN sp.learning_activity < 0.3 OR sp.experiment_completion < 0.5 THEN 'medium'
				ELSE 'low'
			END as severity,
			(SELECT MAX(created_at) FROM learning_records WHERE student_id = s.id) as last_activity_at
		FROM students s
		JOIN users u ON s.user_id = u.id
		LEFT JOIN student_profiles sp ON sp.student_id = s.id
		WHERE s.class_id = ?
		  AND (sp.learning_activity < 0.5 OR sp.experiment_completion < 0.6 OR sp.experiment_accuracy < 0.6)
		ORDER BY severity DESC, sp.overall_score ASC
	`

	err := r.db.WithContext(ctx).Raw(query, classID).Scan(&alerts).Error
	if err != nil {
		r.logger.Error("Failed to get student alerts", zap.String("classID", classID.String()), zap.Error(err))
		return nil, err
	}

	return alerts, nil
}
