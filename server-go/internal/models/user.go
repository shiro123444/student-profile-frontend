package models

import (
	"time"

	"github.com/google/uuid"
)

// User represents a user in the system
type User struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Username       string     `gorm:"uniqueIndex;not null" json:"username" binding:"required"`
	Email          string     `gorm:"uniqueIndex;not null" json:"email" binding:"required,email"`
	PasswordHash   string     `gorm:"not null" json:"-"`
	Role           string     `gorm:"not null" json:"role"` // admin, operator, teacher, student
	OrganizationID *uuid.UUID `json:"organization_id,omitempty"`
	IsActive       bool       `gorm:"default:true" json:"is_active"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Student represents a student with extended information
type Student struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	UserID         uuid.UUID  `gorm:"uniqueIndex;not null" json:"user_id"`
	User           User       `gorm:"foreignKey:UserID" json:"user,omitempty"`
	StudentNumber  string     `gorm:"uniqueIndex" json:"student_number"`
	ClassID        *uuid.UUID `json:"class_id,omitempty"`
	Class          *Class     `gorm:"foreignKey:ClassID" json:"class,omitempty"`
	MBTIType       string     `json:"mbti_type,omitempty"`
	EnrollmentYear int        `json:"enrollment_year"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Class represents a class/group of students
type Class struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Name           string     `gorm:"not null" json:"name" binding:"required"`
	TeacherID      *uuid.UUID `json:"teacher_id,omitempty"`
	Teacher        *User      `gorm:"foreignKey:TeacherID" json:"teacher,omitempty"`
	OrganizationID *uuid.UUID `json:"organization_id,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// TableName overrides the table name
func (User) TableName() string {
	return "users"
}

func (Student) TableName() string {
	return "students"
}

func (Class) TableName() string {
	return "classes"
}
