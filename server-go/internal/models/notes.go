package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// Note represents an Obsidian-style markdown note
type Note struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID uuid.UUID      `gorm:"not null;index" json:"student_id"`
	Title     string         `gorm:"not null" json:"title"`
	Content   string         `gorm:"type:text;default:''" json:"content"`
	FolderID  *uuid.UUID     `gorm:"type:uuid;index" json:"folder_id,omitempty"`
	Folder    string         `gorm:"default:'/'" json:"folder"`
	SortOrder int            `gorm:"default:0;index" json:"sort_order"`
	Tags      pq.StringArray `gorm:"type:text[]" json:"tags"`
	IsPublic  bool           `gorm:"default:false" json:"is_public"`
	WordCount int            `gorm:"default:0" json:"word_count"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// NoteFolder represents a folder node in note tree.
type NoteFolder struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	StudentID uuid.UUID  `gorm:"not null;index:idx_note_folders_student_parent_sort,priority:1;uniqueIndex:ux_note_folder_path,priority:1;uniqueIndex:ux_note_folder_name,priority:1" json:"student_id"`
	Name      string     `gorm:"not null;size:255;uniqueIndex:ux_note_folder_name,priority:3" json:"name"`
	ParentID  *uuid.UUID `gorm:"type:uuid;index:idx_note_folders_student_parent_sort,priority:2;uniqueIndex:ux_note_folder_name,priority:2" json:"parent_id,omitempty"`
	Path      string     `gorm:"not null;size:2048;uniqueIndex:ux_note_folder_path,priority:2" json:"path"`
	SortOrder int        `gorm:"default:0;index:idx_note_folders_student_parent_sort,priority:3" json:"sort_order"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// NoteLink represents a bidirectional link between two notes ([[wiki-link]])
type NoteLink struct {
	SourceID uuid.UUID `gorm:"type:uuid;not null;primaryKey" json:"source_id"`
	TargetID uuid.UUID `gorm:"type:uuid;not null;primaryKey" json:"target_id"`
}

func (Note) TableName() string       { return "notes" }
func (NoteFolder) TableName() string { return "note_folders" }
func (NoteLink) TableName() string   { return "note_links" }
