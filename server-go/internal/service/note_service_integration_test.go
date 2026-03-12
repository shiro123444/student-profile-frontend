package service

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

func newSQLiteNoteService(t *testing.T) *NoteService {
	t.Helper()

	dsn := fmt.Sprintf("file:notes-service-int-%d?mode=memory&cache=shared&_busy_timeout=5000", time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db.DB: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	if err := createSQLiteSchema(db); err != nil {
		t.Fatalf("create sqlite schema: %v", err)
	}

	svc := &NoteService{
		db:     db,
		logger: zap.NewNop(),
	}
	// Skip startup backfill in sqlite integration tests; the backfill query uses PG-only SQL.
	svc.initOnce.Do(func() {})
	return svc
}

func createSQLiteSchema(db *gorm.DB) error {
	statements := []string{
		`CREATE TABLE notes (
			id TEXT PRIMARY KEY,
			student_id TEXT NOT NULL,
			title TEXT NOT NULL,
			content TEXT DEFAULT '',
			folder_id TEXT,
			folder TEXT DEFAULT '/',
			sort_order INTEGER DEFAULT 0,
			tags TEXT DEFAULT '{}',
			is_public NUMERIC DEFAULT 0,
			word_count INTEGER DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME
		);`,
		`CREATE INDEX idx_notes_student_id ON notes(student_id);`,
		`CREATE INDEX idx_notes_folder_id ON notes(folder_id);`,
		`CREATE INDEX idx_notes_sort_order ON notes(sort_order);`,
		`CREATE TABLE note_folders (
			id TEXT PRIMARY KEY,
			student_id TEXT NOT NULL,
			name TEXT NOT NULL,
			parent_id TEXT,
			path TEXT NOT NULL,
			sort_order INTEGER DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME
		);`,
		`CREATE INDEX idx_note_folders_student_parent_sort ON note_folders(student_id, parent_id, sort_order);`,
		`CREATE UNIQUE INDEX ux_note_folder_path ON note_folders(student_id, path);`,
		`CREATE UNIQUE INDEX ux_note_folder_name ON note_folders(student_id, parent_id, name);`,
		`CREATE TABLE note_links (
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			PRIMARY KEY (source_id, target_id)
		);`,
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			return err
		}
	}
	return nil
}

func seedNoteRecord(
	t *testing.T,
	db *gorm.DB,
	studentID uuid.UUID,
	noteID uuid.UUID,
	title string,
	sortOrder int,
) {
	t.Helper()

	now := time.Now().UTC()
	note := models.Note{
		ID:        noteID,
		StudentID: studentID,
		Title:     title,
		Content:   "",
		Folder:    "/",
		FolderID:  nil,
		SortOrder: sortOrder,
		Tags:      pq.StringArray{},
		IsPublic:  false,
		WordCount: 0,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := db.Create(&note).Error; err != nil {
		t.Fatalf("seed note %s: %v", title, err)
	}
}

func TestNoteServiceReorderRollsBackOnResequenceFailure(t *testing.T) {
	svc := newSQLiteNoteService(t)
	studentID := uuid.New()
	noteA := uuid.New()
	noteB := uuid.New()

	seedNoteRecord(t, svc.db, studentID, noteA, "Alpha", 0)
	seedNoteRecord(t, svc.db, studentID, noteB, "Beta", 1)

	triggerSQL := fmt.Sprintf(`
CREATE TRIGGER fail_note_sort_update
BEFORE UPDATE OF sort_order ON notes
WHEN NEW.id = '%s'
BEGIN
  SELECT RAISE(ABORT, 'forced_sort_failure');
END;
`, noteA.String())
	if err := svc.db.Exec(triggerSQL).Error; err != nil {
		t.Fatalf("create trigger: %v", err)
	}

	err := svc.Reorder(studentID, NoteReorderPayload{
		Kind:   "note",
		ItemID: noteA,
		Index:  1,
	})
	if err == nil {
		t.Fatalf("expected reorder error, got nil")
	}
	if !strings.Contains(err.Error(), "forced_sort_failure") {
		t.Fatalf("unexpected reorder error: %v", err)
	}

	var notes []models.Note
	if err := svc.db.Where("student_id = ?", studentID).Order("sort_order ASC").Find(&notes).Error; err != nil {
		t.Fatalf("load notes: %v", err)
	}
	if len(notes) != 2 {
		t.Fatalf("expected 2 notes, got %d", len(notes))
	}

	orderByID := map[uuid.UUID]int{}
	for _, note := range notes {
		orderByID[note.ID] = note.SortOrder
	}
	if got := orderByID[noteA]; got != 0 {
		t.Fatalf("note A sort_order changed after rollback: got %d want 0", got)
	}
	if got := orderByID[noteB]; got != 1 {
		t.Fatalf("note B sort_order changed after rollback: got %d want 1", got)
	}
}

func TestNoteServiceReorderConcurrentMaintainsContiguousOrder(t *testing.T) {
	svc := newSQLiteNoteService(t)
	studentID := uuid.New()

	const noteCount = 6
	noteIDs := make([]uuid.UUID, 0, noteCount)
	for idx := 0; idx < noteCount; idx++ {
		noteID := uuid.New()
		noteIDs = append(noteIDs, noteID)
		seedNoteRecord(t, svc.db, studentID, noteID, fmt.Sprintf("Note-%d", idx), idx)
	}

	const ops = 40
	errCh := make(chan error, ops)
	var wg sync.WaitGroup
	for i := 0; i < ops; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			payload := NoteReorderPayload{
				Kind:   "note",
				ItemID: noteIDs[i%len(noteIDs)],
				Index:  (i * 3) % len(noteIDs),
			}
			if err := svc.Reorder(studentID, payload); err != nil {
				errCh <- err
			}
		}()
	}

	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent reorder failed: %v", err)
	}

	var notes []models.Note
	if err := svc.db.Where("student_id = ?", studentID).
		Order("sort_order ASC").
		Find(&notes).Error; err != nil {
		t.Fatalf("load reordered notes: %v", err)
	}
	if len(notes) != noteCount {
		t.Fatalf("expected %d notes, got %d", noteCount, len(notes))
	}

	seenSortOrder := make(map[int]struct{}, noteCount)
	for idx, note := range notes {
		if note.SortOrder != idx {
			t.Fatalf("sort_order not contiguous at idx=%d: note=%s sort_order=%d", idx, note.ID, note.SortOrder)
		}
		if _, exists := seenSortOrder[note.SortOrder]; exists {
			t.Fatalf("duplicate sort_order found: %d", note.SortOrder)
		}
		seenSortOrder[note.SortOrder] = struct{}{}
	}
}
