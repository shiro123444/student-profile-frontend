package postgres

import (
	"context"

	"github.com/google/uuid"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type ExperimentRepository struct {
	db     *gorm.DB
	logger *zap.Logger
}

func NewExperimentRepository(db *gorm.DB, logger *zap.Logger) *ExperimentRepository {
	return &ExperimentRepository{
		db:     db,
		logger: logger,
	}
}

// GetExperimentByID retrieves an experiment by ID
func (r *ExperimentRepository) GetExperimentByID(ctx context.Context, id uuid.UUID) (*models.Experiment, error) {
	var experiment models.Experiment
	err := r.db.WithContext(ctx).First(&experiment, "id = ?", id).Error

	if err != nil {
		r.logger.Error("Failed to get experiment by ID", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	return &experiment, nil
}

// GetAllExperiments retrieves all experiments
func (r *ExperimentRepository) GetAllExperiments(ctx context.Context) ([]models.Experiment, error) {
	var experiments []models.Experiment
	err := r.db.WithContext(ctx).Find(&experiments).Error

	if err != nil {
		r.logger.Error("Failed to get all experiments", zap.Error(err))
		return nil, err
	}

	return experiments, nil
}

// CreateExperiment creates a new experiment
func (r *ExperimentRepository) CreateExperiment(ctx context.Context, experiment *models.Experiment) error {
	err := r.db.WithContext(ctx).Create(experiment).Error
	if err != nil {
		r.logger.Error("Failed to create experiment", zap.Error(err))
		return err
	}

	return nil
}

// GetStudentExperiments retrieves all experiments for a student
func (r *ExperimentRepository) GetStudentExperiments(ctx context.Context, studentID uuid.UUID) ([]models.StudentExperiment, error) {
	var experiments []models.StudentExperiment
	err := r.db.WithContext(ctx).
		Preload("Experiment").
		Where("student_id = ?", studentID).
		Order("created_at DESC").
		Find(&experiments).Error

	if err != nil {
		r.logger.Error("Failed to get student experiments", zap.String("studentID", studentID.String()), zap.Error(err))
		return nil, err
	}

	return experiments, nil
}

// GetStudentExperimentByID retrieves a specific student experiment
func (r *ExperimentRepository) GetStudentExperimentByID(ctx context.Context, id uuid.UUID) (*models.StudentExperiment, error) {
	var experiment models.StudentExperiment
	err := r.db.WithContext(ctx).
		Preload("Experiment").
		Preload("Student.User").
		First(&experiment, "id = ?", id).Error

	if err != nil {
		r.logger.Error("Failed to get student experiment by ID", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	return &experiment, nil
}

// CreateStudentExperiment creates a new student experiment record
func (r *ExperimentRepository) CreateStudentExperiment(ctx context.Context, experiment *models.StudentExperiment) error {
	err := r.db.WithContext(ctx).Create(experiment).Error
	if err != nil {
		r.logger.Error("Failed to create student experiment", zap.Error(err))
		return err
	}

	return nil
}

// UpdateStudentExperiment updates a student experiment
func (r *ExperimentRepository) UpdateStudentExperiment(ctx context.Context, experiment *models.StudentExperiment) error {
	err := r.db.WithContext(ctx).Save(experiment).Error
	if err != nil {
		r.logger.Error("Failed to update student experiment", zap.String("id", experiment.ID.String()), zap.Error(err))
		return err
	}

	return nil
}

// GetExperimentStatsByClass retrieves experiment statistics for a class
func (r *ExperimentRepository) GetExperimentStatsByClass(ctx context.Context, classID uuid.UUID) (map[string]interface{}, error) {
	var stats struct {
		TotalExperiments     int     `json:"total_experiments"`
		CompletedExperiments int     `json:"completed_experiments"`
		AvgScore             float64 `json:"avg_score"`
		AvgCompletionRate    float64 `json:"avg_completion_rate"`
		AvgAccuracy          float64 `json:"avg_accuracy"`
	}

	query := `
		SELECT
			COUNT(DISTINCT e.id) as total_experiments,
			COUNT(DISTINCT CASE WHEN se.status = 'completed' THEN se.id END) as completed_experiments,
			AVG(se.score) as avg_score,
			COUNT(DISTINCT CASE WHEN se.status = 'completed' THEN se.id END)::float /
				NULLIF(COUNT(DISTINCT se.id), 0) as avg_completion_rate,
			COUNT(DISTINCT CASE WHEN se.is_correct = true THEN se.id END)::float /
				NULLIF(COUNT(DISTINCT CASE WHEN se.status = 'completed' THEN se.id END), 0) as avg_accuracy
		FROM experiments e
		LEFT JOIN student_experiments se ON se.experiment_id = e.id
		LEFT JOIN students s ON se.student_id = s.id
		WHERE s.class_id = ?
	`

	err := r.db.WithContext(ctx).Raw(query, classID).Scan(&stats).Error
	if err != nil {
		r.logger.Error("Failed to get experiment stats by class", zap.String("classID", classID.String()), zap.Error(err))
		return nil, err
	}

	result := map[string]interface{}{
		"total_experiments":     stats.TotalExperiments,
		"completed_experiments": stats.CompletedExperiments,
		"avg_score":             stats.AvgScore,
		"avg_completion_rate":   stats.AvgCompletionRate,
		"avg_accuracy":          stats.AvgAccuracy,
	}

	return result, nil
}

// CreateLearningRecord creates a new learning record
func (r *ExperimentRepository) CreateLearningRecord(ctx context.Context, record *models.LearningRecord) error {
	err := r.db.WithContext(ctx).Create(record).Error
	if err != nil {
		r.logger.Error("Failed to create learning record", zap.Error(err))
		return err
	}

	return nil
}

// GetLearningRecords retrieves learning records for a student
func (r *ExperimentRepository) GetLearningRecords(ctx context.Context, studentID uuid.UUID, days int) ([]models.LearningRecord, error) {
	var records []models.LearningRecord

	query := r.db.WithContext(ctx).
		Where("student_id = ?", studentID).
		Order("created_at DESC")

	if days > 0 {
		query = query.Where("created_at >= NOW() - INTERVAL '? days'", days)
	}

	err := query.Find(&records).Error
	if err != nil {
		r.logger.Error("Failed to get learning records", zap.String("studentID", studentID.String()), zap.Error(err))
		return nil, err
	}

	return records, nil
}
