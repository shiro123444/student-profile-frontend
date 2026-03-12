package service

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

var wikiLinkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)

var (
	ErrNoteNotFound    = errors.New("note not found")
	ErrFolderNotFound  = errors.New("folder not found")
	ErrFolderConflict  = errors.New("folder conflict")
	ErrInvalidMove     = errors.New("invalid folder move")
	ErrInvalidFolder   = errors.New("invalid folder")
	ErrInvalidReorder  = errors.New("invalid reorder payload")
	ErrUnsupportedMode = errors.New("unsupported delete strategy")
)

const (
	FolderDeleteMoveToParent = "move_to_parent"
	FolderDeleteRecursive    = "delete_recursive"
)

// NoteTreeSnapshot represents a full notes tree snapshot for one student.
type NoteTreeSnapshot struct {
	Folders []models.NoteFolder `json:"folders"`
	Notes   []models.Note       `json:"notes"`
}

// NoteReorderPayload is a unified reorder payload for note/folder drag operations.
type NoteReorderPayload struct {
	Kind     string     `json:"kind"`
	ItemID   uuid.UUID  `json:"item_id"`
	ParentID *uuid.UUID `json:"parent_id,omitempty"`
	Index    int        `json:"index"`
}

// NoteService handles note CRUD, search, tree, and graph operations.
type NoteService struct {
	db       *gorm.DB
	logger   *zap.Logger
	initOnce sync.Once
}

// NewNoteService creates a new NoteService.
func NewNoteService(db *gorm.DB, logger *zap.Logger) *NoteService {
	svc := &NoteService{db: db, logger: logger}
	svc.ensureInitialized()
	return svc
}

func (s *NoteService) ensureInitialized() {
	s.initOnce.Do(func() {
		if err := s.backfillLegacyTreeData(); err != nil {
			s.logger.Warn("notes tree backfill failed", zap.Error(err))
		}
	})
}

// Create creates a new note and extracts [[wiki-links]].
func (s *NoteService) Create(
	studentID uuid.UUID,
	title,
	content,
	folder string,
	folderID *uuid.UUID,
	sortOrder *int,
	tags []string,
) (*models.Note, error) {
	s.ensureInitialized()

	if tags == nil {
		tags = []string{}
	}

	note := models.Note{
		StudentID: studentID,
		Title:     strings.TrimSpace(title),
		Content:   content,
		Tags:      pq.StringArray(tags),
		WordCount: countWords(content),
	}
	if note.Title == "" {
		note.Title = "无标题笔记"
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		resolvedPath, resolvedFolderID, err := s.resolveFolderInputTx(tx, studentID, folder, folderID, true)
		if err != nil {
			return err
		}

		note.Folder = resolvedPath
		note.FolderID = cloneUUIDPtr(resolvedFolderID)

		siblings, err := s.listNoteSiblingIDsTx(tx, studentID, resolvedFolderID, uuid.Nil)
		if err != nil {
			return err
		}

		insertIndex := len(siblings)
		if sortOrder != nil {
			insertIndex = clampIndex(*sortOrder, len(siblings))
		}
		note.SortOrder = len(siblings)

		if err := tx.Create(&note).Error; err != nil {
			return fmt.Errorf("create note: %w", err)
		}

		ordered := insertUUIDAt(siblings, note.ID, insertIndex)
		if err := s.resequenceNotesTx(tx, ordered); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Extract and save wiki-links.
	s.syncLinks(note.ID, studentID, content)

	if note.Tags == nil {
		note.Tags = pq.StringArray{}
	}
	return &note, nil
}

// Update updates an existing note.
func (s *NoteService) Update(noteID, studentID uuid.UUID, updates map[string]interface{}) (*models.Note, error) {
	s.ensureInitialized()

	var note models.Note
	if err := s.db.Where("id = ? AND student_id = ?", noteID, studentID).First(&note).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNoteNotFound
		}
		return nil, fmt.Errorf("load note: %w", err)
	}

	var contentChanged bool
	if content, ok := updates["content"].(string); ok {
		updates["word_count"] = countWords(content)
		contentChanged = true
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		resolvedUpdates := make(map[string]interface{}, len(updates)+2)
		for key, value := range updates {
			resolvedUpdates[key] = value
		}

		if rawTags, ok := resolvedUpdates["tags"]; ok {
			switch typed := rawTags.(type) {
			case []string:
				resolvedUpdates["tags"] = pq.StringArray(typed)
			case pq.StringArray:
				resolvedUpdates["tags"] = typed
			}
		}

		var resolvedPath string
		var resolvedFolderID *uuid.UUID
		var hasFolderChange bool

		if rawFolderID, ok := resolvedUpdates["folder_id"]; ok {
			folderIDValue, parseErr := parseFlexibleUUID(rawFolderID)
			if parseErr != nil {
				return ErrInvalidFolder
			}
			path, id, resolveErr := s.resolveFolderInputTx(tx, studentID, "", folderIDValue, true)
			if resolveErr != nil {
				return resolveErr
			}
			resolvedPath = path
			resolvedFolderID = id
			hasFolderChange = true
		}

		if rawFolder, ok := resolvedUpdates["folder"].(string); ok {
			path, id, resolveErr := s.resolveFolderInputTx(tx, studentID, rawFolder, nil, true)
			if resolveErr != nil {
				return resolveErr
			}
			resolvedPath = path
			resolvedFolderID = id
			hasFolderChange = true
		}

		if hasFolderChange {
			resolvedUpdates["folder"] = resolvedPath
			if resolvedFolderID == nil {
				resolvedUpdates["folder_id"] = nil
			} else {
				resolvedUpdates["folder_id"] = *resolvedFolderID
			}
		}

		if err := tx.Model(&note).Updates(resolvedUpdates).Error; err != nil {
			return fmt.Errorf("update note: %w", err)
		}

		if hasFolderChange {
			var refreshed models.Note
			if err := tx.Where("id = ?", note.ID).First(&refreshed).Error; err != nil {
				return fmt.Errorf("reload updated note: %w", err)
			}
			note = refreshed
		}

		return nil
	})
	if err != nil {
		if errors.Is(err, ErrFolderNotFound) || errors.Is(err, ErrInvalidFolder) {
			return nil, err
		}
		return nil, err
	}

	if contentChanged {
		content, _ := updates["content"].(string)
		s.syncLinks(noteID, studentID, content)
	}

	if err := s.db.Where("id = ?", noteID).First(&note).Error; err != nil {
		return nil, fmt.Errorf("reload note: %w", err)
	}
	if note.Tags == nil {
		note.Tags = pq.StringArray{}
	}
	return &note, nil
}

// Delete deletes a note and its links.
func (s *NoteService) Delete(noteID, studentID uuid.UUID) error {
	s.ensureInitialized()
	result := s.db.Where("id = ? AND student_id = ?", noteID, studentID).Delete(&models.Note{})
	if result.Error != nil {
		return fmt.Errorf("delete note: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrNoteNotFound
	}
	return nil
}

// Get returns a single note.
func (s *NoteService) Get(noteID, studentID uuid.UUID) (*models.Note, error) {
	s.ensureInitialized()
	var note models.Note
	if err := s.db.Where("id = ? AND student_id = ?", noteID, studentID).First(&note).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNoteNotFound
		}
		return nil, fmt.Errorf("get note: %w", err)
	}
	if note.Tags == nil {
		note.Tags = pq.StringArray{}
	}
	return &note, nil
}

// List returns notes with optional folder/tag/search filtering.
func (s *NoteService) List(studentID uuid.UUID, folder string, tags []string, search string, page, pageSize int) ([]models.Note, int64, error) {
	s.ensureInitialized()
	query := s.db.Where("student_id = ?", studentID)

	if folder != "" {
		folder = normalizeFolderPath(folder)
		query = query.Where("folder = ?", folder)
	}
	if len(tags) > 0 {
		query = query.Where("tags && ?", pq.StringArray(tags))
	}
	if search != "" {
		query = query.Where("to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', ?)", search)
	}

	var total int64
	query.Model(&models.Note{}).Count(&total)

	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	var notes []models.Note
	err := query.Order("sort_order ASC").
		Order("updated_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&notes).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list notes: %w", err)
	}
	for i := range notes {
		if notes[i].Tags == nil {
			notes[i].Tags = pq.StringArray{}
		}
	}
	return notes, total, nil
}

// Search performs full-text search on notes.
func (s *NoteService) Search(studentID uuid.UUID, query string) ([]models.Note, error) {
	s.ensureInitialized()
	var notes []models.Note
	err := s.db.Where("student_id = ? AND to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', ?)", studentID, query).
		Order("sort_order ASC").
		Order("updated_at DESC").
		Limit(20).
		Find(&notes).Error
	if err != nil {
		return nil, fmt.Errorf("search notes: %w", err)
	}
	for i := range notes {
		if notes[i].Tags == nil {
			notes[i].Tags = pq.StringArray{}
		}
	}
	return notes, nil
}

// GetBacklinks returns notes that link TO the given note.
func (s *NoteService) GetBacklinks(noteID, studentID uuid.UUID) ([]models.Note, error) {
	s.ensureInitialized()
	var notes []models.Note
	err := s.db.Where("id IN (SELECT source_id FROM note_links WHERE target_id = ?) AND student_id = ?", noteID, studentID).
		Order("sort_order ASC").
		Find(&notes).Error
	if err != nil {
		return nil, fmt.Errorf("get backlinks: %w", err)
	}
	for i := range notes {
		if notes[i].Tags == nil {
			notes[i].Tags = pq.StringArray{}
		}
	}
	return notes, nil
}

// NoteGraphNode represents a node in the note graph.
type NoteGraphNode struct {
	ID     uuid.UUID `json:"id"`
	Title  string    `json:"title"`
	Folder string    `json:"folder"`
	Tags   []string  `json:"tags"`
}

// NoteGraphEdge represents an edge in the note graph.
type NoteGraphEdge struct {
	Source uuid.UUID `json:"source"`
	Target uuid.UUID `json:"target"`
}

// NoteGraph is the full graph response.
type NoteGraph struct {
	Nodes []NoteGraphNode `json:"nodes"`
	Edges []NoteGraphEdge `json:"edges"`
}

// GetGraph returns the note relationship graph for a student.
func (s *NoteService) GetGraph(studentID uuid.UUID) (*NoteGraph, error) {
	s.ensureInitialized()
	var notes []models.Note
	if err := s.db.Select("id, title, folder, tags").Where("student_id = ?", studentID).Find(&notes).Error; err != nil {
		return nil, fmt.Errorf("get graph nodes: %w", err)
	}

	noteIDs := make([]uuid.UUID, len(notes))
	nodes := make([]NoteGraphNode, len(notes))
	for i, n := range notes {
		noteIDs[i] = n.ID
		nodes[i] = NoteGraphNode{ID: n.ID, Title: n.Title, Folder: n.Folder, Tags: n.Tags}
	}

	var links []models.NoteLink
	if len(noteIDs) > 0 {
		s.db.Where("source_id IN ?", noteIDs).Find(&links)
	}

	edges := make([]NoteGraphEdge, len(links))
	for i, l := range links {
		edges[i] = NoteGraphEdge{Source: l.SourceID, Target: l.TargetID}
	}

	return &NoteGraph{Nodes: nodes, Edges: edges}, nil
}

// ListFolders returns folders from note_folders plus root fallback.
func (s *NoteService) ListFolders(studentID uuid.UUID) ([]string, error) {
	s.ensureInitialized()
	var folders []models.NoteFolder
	err := s.db.Where("student_id = ?", studentID).
		Order("path ASC").
		Find(&folders).Error
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}

	res := make([]string, 0, len(folders)+1)
	res = append(res, "/")
	for _, folder := range folders {
		if folder.Path == "/" {
			continue
		}
		res = append(res, folder.Path)
	}
	return res, nil
}

// ListTags returns distinct tags for a student.
func (s *NoteService) ListTags(studentID uuid.UUID) ([]string, error) {
	s.ensureInitialized()
	var tags []string
	err := s.db.Raw("SELECT DISTINCT unnest(tags) AS tag FROM notes WHERE student_id = ? ORDER BY tag", studentID).
		Scan(&tags).Error
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	return tags, nil
}

// GetTree returns folders and notes in stable sort order.
func (s *NoteService) GetTree(studentID uuid.UUID) (*NoteTreeSnapshot, error) {
	s.ensureInitialized()

	var folders []models.NoteFolder
	if err := s.db.Where("student_id = ?", studentID).
		Order("COALESCE(parent_id::text, '') ASC").
		Order("sort_order ASC").
		Order("name ASC").
		Find(&folders).Error; err != nil {
		return nil, fmt.Errorf("list note folders: %w", err)
	}

	var notes []models.Note
	if err := s.db.Where("student_id = ?", studentID).
		Order("COALESCE(folder_id::text, '') ASC").
		Order("sort_order ASC").
		Order("updated_at DESC").
		Find(&notes).Error; err != nil {
		return nil, fmt.Errorf("list tree notes: %w", err)
	}
	for i := range notes {
		if notes[i].Tags == nil {
			notes[i].Tags = pq.StringArray{}
		}
	}

	return &NoteTreeSnapshot{Folders: folders, Notes: notes}, nil
}

// CreateFolder creates a folder under parent (or root).
func (s *NoteService) CreateFolder(studentID uuid.UUID, name string, parentID *uuid.UUID, index *int) (*models.NoteFolder, error) {
	s.ensureInitialized()

	cleanName, err := sanitizeFolderName(name)
	if err != nil {
		return nil, err
	}

	var created models.NoteFolder
	err = s.db.Transaction(func(tx *gorm.DB) error {
		parentPath := "/"
		resolvedParentID := cloneUUIDPtr(parentID)
		if parentID != nil {
			var parent models.NoteFolder
			if err := tx.Where("id = ? AND student_id = ?", *parentID, studentID).First(&parent).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrFolderNotFound
				}
				return err
			}
			parentPath = parent.Path
		}

		path := buildFolderPath(parentPath, cleanName)
		if path == "/" {
			return ErrInvalidFolder
		}

		var existing models.NoteFolder
		if err := tx.Where("student_id = ? AND path = ?", studentID, path).First(&existing).Error; err == nil {
			return ErrFolderConflict
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		siblingIDs, err := s.listFolderSiblingIDsTx(tx, studentID, resolvedParentID, uuid.Nil)
		if err != nil {
			return err
		}
		insertAt := len(siblingIDs)
		if index != nil {
			insertAt = clampIndex(*index, len(siblingIDs))
		}

		created = models.NoteFolder{
			StudentID: studentID,
			Name:      cleanName,
			ParentID:  resolvedParentID,
			Path:      path,
			SortOrder: len(siblingIDs),
		}
		if err := tx.Create(&created).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return ErrFolderConflict
			}
			return fmt.Errorf("create folder: %w", err)
		}

		ordered := insertUUIDAt(siblingIDs, created.ID, insertAt)
		return s.resequenceFoldersTx(tx, ordered)
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// UpdateFolder updates folder name and/or parent and order.
func (s *NoteService) UpdateFolder(
	studentID uuid.UUID,
	folderID uuid.UUID,
	name *string,
	parentID *uuid.UUID,
	parentProvided bool,
	index *int,
) (*models.NoteFolder, error) {
	s.ensureInitialized()

	var updated models.NoteFolder
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var folder models.NoteFolder
		if err := tx.Where("id = ? AND student_id = ?", folderID, studentID).First(&folder).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrFolderNotFound
			}
			return err
		}

		nextName := folder.Name
		if name != nil {
			cleanName, err := sanitizeFolderName(*name)
			if err != nil {
				return err
			}
			nextName = cleanName
		}

		nextParentID := cloneUUIDPtr(folder.ParentID)
		if parentProvided {
			nextParentID = cloneUUIDPtr(parentID)
		}

		if nextParentID != nil && *nextParentID == folder.ID {
			return ErrInvalidMove
		}

		nextParentPath := "/"
		if nextParentID != nil {
			var parent models.NoteFolder
			if err := tx.Where("id = ? AND student_id = ?", *nextParentID, studentID).First(&parent).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrFolderNotFound
				}
				return err
			}
			if parent.ID == folder.ID || strings.HasPrefix(parent.Path+"/", folder.Path+"/") {
				return ErrInvalidMove
			}
			nextParentPath = parent.Path
		}

		oldParentID := cloneUUIDPtr(folder.ParentID)
		oldPath := folder.Path
		newPath := buildFolderPath(nextParentPath, nextName)
		if newPath == "/" {
			return ErrInvalidFolder
		}

		if newPath != oldPath {
			var conflict models.NoteFolder
			if err := tx.Where("student_id = ? AND path = ? AND id <> ?", studentID, newPath, folder.ID).First(&conflict).Error; err == nil {
				return ErrFolderConflict
			} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}

		parentChanged := !uuidPtrEqual(oldParentID, nextParentID)
		nameChanged := nextName != folder.Name
		pathChanged := newPath != oldPath

		if parentChanged || nameChanged || pathChanged {
			if err := tx.Model(&models.NoteFolder{}).Where("id = ?", folder.ID).Updates(map[string]interface{}{
				"name":      nextName,
				"parent_id": nextParentID,
				"path":      newPath,
			}).Error; err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") {
					return ErrFolderConflict
				}
				return err
			}
			folder.Name = nextName
			folder.ParentID = nextParentID
			folder.Path = newPath
		}

		if pathChanged {
			if err := s.rewriteFolderSubtreePathsTx(tx, studentID, folderID, oldPath, newPath); err != nil {
				return err
			}
		}

		if parentChanged {
			oldSiblings, err := s.listFolderSiblingIDsTx(tx, studentID, oldParentID, folder.ID)
			if err != nil {
				return err
			}
			if err := s.resequenceFoldersTx(tx, oldSiblings); err != nil {
				return err
			}
		}

		siblings, err := s.listFolderSiblingIDsTx(tx, studentID, nextParentID, folder.ID)
		if err != nil {
			return err
		}
		insertAt := len(siblings)
		if index != nil {
			insertAt = clampIndex(*index, len(siblings))
		}
		ordered := insertUUIDAt(siblings, folder.ID, insertAt)
		if err := s.resequenceFoldersTx(tx, ordered); err != nil {
			return err
		}

		if err := tx.Where("id = ?", folder.ID).First(&updated).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

// DeleteFolder deletes folder recursively or moves contents to parent.
func (s *NoteService) DeleteFolder(studentID, folderID uuid.UUID, strategy string) error {
	s.ensureInitialized()
	if strategy == "" {
		strategy = FolderDeleteMoveToParent
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		var folder models.NoteFolder
		if err := tx.Where("id = ? AND student_id = ?", folderID, studentID).First(&folder).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrFolderNotFound
			}
			return err
		}

		oldParentID := cloneUUIDPtr(folder.ParentID)

		switch strategy {
		case FolderDeleteRecursive:
			var subtree []models.NoteFolder
			if err := tx.Where("student_id = ? AND (path = ? OR path LIKE ?)", studentID, folder.Path, folder.Path+"/%").
				Order("length(path) DESC").
				Find(&subtree).Error; err != nil {
				return err
			}
			ids := make([]uuid.UUID, 0, len(subtree))
			for _, item := range subtree {
				ids = append(ids, item.ID)
			}

			if len(ids) > 0 {
				if err := tx.Where("student_id = ? AND folder_id IN ?", studentID, ids).Delete(&models.Note{}).Error; err != nil {
					return err
				}
			}
			if err := tx.Where("student_id = ? AND (folder = ? OR folder LIKE ?)", studentID, folder.Path, folder.Path+"/%").
				Delete(&models.Note{}).Error; err != nil {
				return err
			}
			if len(ids) > 0 {
				if err := tx.Where("student_id = ? AND id IN ?", studentID, ids).Delete(&models.NoteFolder{}).Error; err != nil {
					return err
				}
			}

		case FolderDeleteMoveToParent:
			parentPath := "/"
			if folder.ParentID != nil {
				var parent models.NoteFolder
				if err := tx.Where("id = ? AND student_id = ?", *folder.ParentID, studentID).First(&parent).Error; err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return ErrFolderNotFound
					}
					return err
				}
				parentPath = parent.Path
			}

			var descendants []models.NoteFolder
			if err := tx.Where("student_id = ? AND path LIKE ?", studentID, folder.Path+"/%").
				Order("length(path) ASC").
				Find(&descendants).Error; err != nil {
				return err
			}

			for _, child := range descendants {
				rel := strings.TrimPrefix(child.Path, folder.Path+"/")
				newPath := buildFolderPath(parentPath, rel)
				var conflict models.NoteFolder
				if err := tx.Where("student_id = ? AND path = ? AND id <> ?", studentID, newPath, child.ID).First(&conflict).Error; err == nil {
					return ErrFolderConflict
				} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}

			if err := tx.Model(&models.NoteFolder{}).
				Where("student_id = ? AND parent_id = ?", studentID, folder.ID).
				Update("parent_id", folder.ParentID).Error; err != nil {
				return err
			}

			for _, child := range descendants {
				rel := strings.TrimPrefix(child.Path, folder.Path+"/")
				newPath := buildFolderPath(parentPath, rel)
				if err := tx.Model(&models.NoteFolder{}).Where("id = ?", child.ID).Update("path", newPath).Error; err != nil {
					return err
				}
			}

			if folder.ParentID == nil {
				if err := tx.Model(&models.Note{}).
					Where("student_id = ? AND folder_id = ?", studentID, folder.ID).
					Updates(map[string]interface{}{"folder_id": nil, "folder": "/"}).Error; err != nil {
					return err
				}
			} else {
				if err := tx.Model(&models.Note{}).
					Where("student_id = ? AND folder_id = ?", studentID, folder.ID).
					Updates(map[string]interface{}{"folder_id": *folder.ParentID, "folder": parentPath}).Error; err != nil {
					return err
				}
			}

			if len(descendants) > 0 {
				descIDs := make([]uuid.UUID, 0, len(descendants))
				for _, child := range descendants {
					descIDs = append(descIDs, child.ID)
				}
				if err := s.refreshNotesFolderStringFromFolderIDsTx(tx, studentID, descIDs); err != nil {
					return err
				}
			}

			var legacy []models.Note
			if err := tx.Select("id", "folder", "folder_id").
				Where("student_id = ? AND folder_id IS NULL AND (folder = ? OR folder LIKE ?)", studentID, folder.Path, folder.Path+"/%").
				Find(&legacy).Error; err != nil {
				return err
			}
			for _, item := range legacy {
				next := parentPath
				if strings.HasPrefix(item.Folder, folder.Path+"/") {
					next = buildFolderPath(parentPath, strings.TrimPrefix(item.Folder, folder.Path+"/"))
				}
				if err := tx.Model(&models.Note{}).Where("id = ?", item.ID).Update("folder", next).Error; err != nil {
					return err
				}
			}

			if err := tx.Delete(&models.NoteFolder{}, "id = ?", folder.ID).Error; err != nil {
				return err
			}

		default:
			return ErrUnsupportedMode
		}

		siblings, err := s.listFolderSiblingIDsTx(tx, studentID, oldParentID, uuid.Nil)
		if err != nil {
			return err
		}
		return s.resequenceFoldersTx(tx, siblings)
	})
}

// Reorder reorders or moves note/folder inside the tree.
func (s *NoteService) Reorder(studentID uuid.UUID, payload NoteReorderPayload) error {
	s.ensureInitialized()
	payload.Kind = strings.TrimSpace(strings.ToLower(payload.Kind))
	if payload.ItemID == uuid.Nil || (payload.Kind != "note" && payload.Kind != "folder") {
		return ErrInvalidReorder
	}
	if payload.Index < 0 {
		payload.Index = 0
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		switch payload.Kind {
		case "note":
			var note models.Note
			if err := tx.Where("id = ? AND student_id = ?", payload.ItemID, studentID).First(&note).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrNoteNotFound
				}
				return err
			}

			nextParentPath := "/"
			if payload.ParentID != nil {
				var parent models.NoteFolder
				if err := tx.Where("id = ? AND student_id = ?", *payload.ParentID, studentID).First(&parent).Error; err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return ErrFolderNotFound
					}
					return err
				}
				nextParentPath = parent.Path
			}

			oldParentID := cloneUUIDPtr(note.FolderID)
			if !uuidPtrEqual(oldParentID, payload.ParentID) {
				updates := map[string]interface{}{"folder": nextParentPath}
				if payload.ParentID == nil {
					updates["folder_id"] = nil
				} else {
					updates["folder_id"] = *payload.ParentID
				}
				if err := tx.Model(&models.Note{}).Where("id = ?", note.ID).Updates(updates).Error; err != nil {
					return err
				}
			}

			if !uuidPtrEqual(oldParentID, payload.ParentID) {
				oldSiblings, err := s.listNoteSiblingIDsTx(tx, studentID, oldParentID, note.ID)
				if err != nil {
					return err
				}
				if err := s.resequenceNotesTx(tx, oldSiblings); err != nil {
					return err
				}
			}

			siblings, err := s.listNoteSiblingIDsTx(tx, studentID, payload.ParentID, note.ID)
			if err != nil {
				return err
			}
			ordered := insertUUIDAt(siblings, note.ID, clampIndex(payload.Index, len(siblings)))
			return s.resequenceNotesTx(tx, ordered)

		case "folder":
			var folder models.NoteFolder
			if err := tx.Where("id = ? AND student_id = ?", payload.ItemID, studentID).First(&folder).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrFolderNotFound
				}
				return err
			}

			if payload.ParentID != nil {
				if *payload.ParentID == folder.ID {
					return ErrInvalidMove
				}
				var parent models.NoteFolder
				if err := tx.Where("id = ? AND student_id = ?", *payload.ParentID, studentID).First(&parent).Error; err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return ErrFolderNotFound
					}
					return err
				}
				if strings.HasPrefix(parent.Path+"/", folder.Path+"/") {
					return ErrInvalidMove
				}
			}

			oldParentID := cloneUUIDPtr(folder.ParentID)
			if !uuidPtrEqual(oldParentID, payload.ParentID) {
				nextParentPath := "/"
				if payload.ParentID != nil {
					var parent models.NoteFolder
					if err := tx.Where("id = ? AND student_id = ?", *payload.ParentID, studentID).First(&parent).Error; err != nil {
						if errors.Is(err, gorm.ErrRecordNotFound) {
							return ErrFolderNotFound
						}
						return err
					}
					nextParentPath = parent.Path
				}
				oldPath := folder.Path
				newPath := buildFolderPath(nextParentPath, folder.Name)
				if oldPath != newPath {
					var conflict models.NoteFolder
					if err := tx.Where("student_id = ? AND path = ? AND id <> ?", studentID, newPath, folder.ID).First(&conflict).Error; err == nil {
						return ErrFolderConflict
					} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
						return err
					}
				}

				if err := tx.Model(&models.NoteFolder{}).Where("id = ?", folder.ID).Updates(map[string]interface{}{
					"parent_id": payload.ParentID,
					"path":      newPath,
				}).Error; err != nil {
					if strings.Contains(strings.ToLower(err.Error()), "unique") {
						return ErrFolderConflict
					}
					return err
				}
				if err := s.rewriteFolderSubtreePathsTx(tx, studentID, folder.ID, oldPath, newPath); err != nil {
					return err
				}
				folder.ParentID = cloneUUIDPtr(payload.ParentID)
				folder.Path = newPath
			}

			if !uuidPtrEqual(oldParentID, folder.ParentID) {
				oldSiblings, err := s.listFolderSiblingIDsTx(tx, studentID, oldParentID, folder.ID)
				if err != nil {
					return err
				}
				if err := s.resequenceFoldersTx(tx, oldSiblings); err != nil {
					return err
				}
			}

			siblings, err := s.listFolderSiblingIDsTx(tx, studentID, folder.ParentID, folder.ID)
			if err != nil {
				return err
			}
			ordered := insertUUIDAt(siblings, folder.ID, clampIndex(payload.Index, len(siblings)))
			return s.resequenceFoldersTx(tx, ordered)
		}

		return ErrInvalidReorder
	})
}

func (s *NoteService) backfillLegacyTreeData() error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.backfillFolderReferencesTx(tx); err != nil {
			return err
		}
		if err := s.backfillFolderSortOrderTx(tx); err != nil {
			return err
		}
		if err := s.backfillNoteSortOrderTx(tx); err != nil {
			return err
		}
		return nil
	})
}

func (s *NoteService) backfillFolderReferencesTx(tx *gorm.DB) error {
	var notes []models.Note
	if err := tx.Select("id", "student_id", "folder", "folder_id", "updated_at", "created_at").
		Order("updated_at DESC").
		Find(&notes).Error; err != nil {
		return err
	}

	for _, item := range notes {
		normalized := normalizeFolderPath(item.Folder)
		updates := map[string]interface{}{}

		var targetFolderID *uuid.UUID
		if normalized != "/" {
			folder, err := s.ensureFolderPathTx(tx, item.StudentID, normalized)
			if err != nil {
				return err
			}
			targetFolderID = &folder.ID
		}

		if item.Folder != normalized {
			updates["folder"] = normalized
		}
		if targetFolderID == nil {
			if item.FolderID != nil {
				updates["folder_id"] = nil
			}
		} else if item.FolderID == nil || *item.FolderID != *targetFolderID {
			updates["folder_id"] = *targetFolderID
		}

		if len(updates) > 0 {
			if err := tx.Model(&models.Note{}).Where("id = ?", item.ID).Updates(updates).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *NoteService) backfillFolderSortOrderTx(tx *gorm.DB) error {
	var folders []models.NoteFolder
	if err := tx.Where("1 = 1").
		Order("student_id ASC").
		Order("COALESCE(parent_id::text, '') ASC").
		Order("name ASC").
		Find(&folders).Error; err != nil {
		return err
	}

	type folderGroupKey struct {
		StudentID uuid.UUID
		ParentKey string
	}
	groups := map[folderGroupKey][]models.NoteFolder{}

	for _, item := range folders {
		groups[folderGroupKey{StudentID: item.StudentID, ParentKey: uuidPtrKey(item.ParentID)}] = append(groups[folderGroupKey{StudentID: item.StudentID, ParentKey: uuidPtrKey(item.ParentID)}], item)
	}

	for _, group := range groups {
		sort.SliceStable(group, func(i, j int) bool {
			left := strings.ToLower(group[i].Name)
			right := strings.ToLower(group[j].Name)
			if left == right {
				return group[i].CreatedAt.Before(group[j].CreatedAt)
			}
			return left < right
		})
		for idx, item := range group {
			if item.SortOrder == idx {
				continue
			}
			if err := tx.Model(&models.NoteFolder{}).Where("id = ?", item.ID).Update("sort_order", idx).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *NoteService) backfillNoteSortOrderTx(tx *gorm.DB) error {
	var notes []models.Note
	if err := tx.Select("id", "student_id", "folder_id", "updated_at", "created_at", "sort_order").
		Order("student_id ASC").
		Order("updated_at DESC").
		Order("created_at DESC").
		Find(&notes).Error; err != nil {
		return err
	}

	type noteGroupKey struct {
		StudentID uuid.UUID
		FolderKey string
	}
	groups := map[noteGroupKey][]models.Note{}
	for _, item := range notes {
		key := noteGroupKey{StudentID: item.StudentID, FolderKey: uuidPtrKey(item.FolderID)}
		groups[key] = append(groups[key], item)
	}

	for _, group := range groups {
		for idx, item := range group {
			if item.SortOrder == idx {
				continue
			}
			if err := tx.Model(&models.Note{}).Where("id = ?", item.ID).Update("sort_order", idx).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *NoteService) resolveFolderInputTx(
	tx *gorm.DB,
	studentID uuid.UUID,
	folderPath string,
	folderID *uuid.UUID,
	createMissing bool,
) (string, *uuid.UUID, error) {
	if folderID != nil {
		var folder models.NoteFolder
		if err := tx.Where("id = ? AND student_id = ?", *folderID, studentID).First(&folder).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", nil, ErrFolderNotFound
			}
			return "", nil, err
		}
		id := folder.ID
		return folder.Path, &id, nil
	}

	normalized := normalizeFolderPath(folderPath)
	if normalized == "/" {
		return "/", nil, nil
	}

	if !createMissing {
		var folder models.NoteFolder
		if err := tx.Where("student_id = ? AND path = ?", studentID, normalized).First(&folder).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", nil, ErrFolderNotFound
			}
			return "", nil, err
		}
		id := folder.ID
		return folder.Path, &id, nil
	}

	folder, err := s.ensureFolderPathTx(tx, studentID, normalized)
	if err != nil {
		return "", nil, err
	}
	id := folder.ID
	return folder.Path, &id, nil
}

func (s *NoteService) ensureFolderPathTx(tx *gorm.DB, studentID uuid.UUID, fullPath string) (*models.NoteFolder, error) {
	normalized := normalizeFolderPath(fullPath)
	if normalized == "/" {
		return nil, nil
	}

	parts := splitFolderParts(normalized)
	if len(parts) == 0 {
		return nil, ErrInvalidFolder
	}

	var parentID *uuid.UUID
	currentPath := "/"
	var last *models.NoteFolder

	for _, part := range parts {
		currentPath = buildFolderPath(currentPath, part)
		var folder models.NoteFolder
		err := tx.Where("student_id = ? AND path = ?", studentID, currentPath).First(&folder).Error
		if err == nil {
			id := folder.ID
			parentID = &id
			localCopy := folder
			last = &localCopy
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		siblingIDs, err := s.listFolderSiblingIDsTx(tx, studentID, parentID, uuid.Nil)
		if err != nil {
			return nil, err
		}

		created := models.NoteFolder{
			StudentID: studentID,
			Name:      part,
			ParentID:  cloneUUIDPtr(parentID),
			Path:      currentPath,
			SortOrder: len(siblingIDs),
		}
		if err := tx.Create(&created).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				if err := tx.Where("student_id = ? AND path = ?", studentID, currentPath).First(&created).Error; err != nil {
					return nil, err
				}
			} else {
				return nil, err
			}
		}

		id := created.ID
		parentID = &id
		localCopy := created
		last = &localCopy
	}

	if last == nil {
		return nil, ErrInvalidFolder
	}
	return last, nil
}

func (s *NoteService) rewriteFolderSubtreePathsTx(
	tx *gorm.DB,
	studentID uuid.UUID,
	folderID uuid.UUID,
	oldPrefix,
	newPrefix string,
) error {
	if oldPrefix == newPrefix {
		return nil
	}

	var descendants []models.NoteFolder
	if err := tx.Where("student_id = ? AND path LIKE ?", studentID, oldPrefix+"/%").
		Order("length(path) ASC").
		Find(&descendants).Error; err != nil {
		return err
	}

	for _, desc := range descendants {
		nextPath := strings.Replace(desc.Path, oldPrefix, newPrefix, 1)
		var conflict models.NoteFolder
		if err := tx.Where("student_id = ? AND path = ? AND id <> ?", studentID, nextPath, desc.ID).First(&conflict).Error; err == nil {
			return ErrFolderConflict
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Model(&models.NoteFolder{}).Where("id = ?", desc.ID).Update("path", nextPath).Error; err != nil {
			return err
		}
	}

	var affected []models.NoteFolder
	if err := tx.Where("student_id = ? AND (id = ? OR path LIKE ?)", studentID, folderID, newPrefix+"/%").Find(&affected).Error; err != nil {
		return err
	}
	ids := make([]uuid.UUID, 0, len(affected))
	for _, item := range affected {
		ids = append(ids, item.ID)
	}
	if err := s.refreshNotesFolderStringFromFolderIDsTx(tx, studentID, ids); err != nil {
		return err
	}

	var legacy []models.Note
	if err := tx.Select("id", "folder").
		Where("student_id = ? AND folder_id IS NULL AND (folder = ? OR folder LIKE ?)", studentID, oldPrefix, oldPrefix+"/%").
		Find(&legacy).Error; err != nil {
		return err
	}
	for _, item := range legacy {
		next := strings.Replace(item.Folder, oldPrefix, newPrefix, 1)
		if err := tx.Model(&models.Note{}).Where("id = ?", item.ID).Update("folder", next).Error; err != nil {
			return err
		}
	}

	return nil
}

func (s *NoteService) refreshNotesFolderStringFromFolderIDsTx(tx *gorm.DB, studentID uuid.UUID, folderIDs []uuid.UUID) error {
	if len(folderIDs) == 0 {
		return nil
	}

	var folders []models.NoteFolder
	if err := tx.Where("student_id = ? AND id IN ?", studentID, folderIDs).Find(&folders).Error; err != nil {
		return err
	}
	pathByID := make(map[uuid.UUID]string, len(folders))
	for _, item := range folders {
		pathByID[item.ID] = item.Path
	}

	var notes []models.Note
	if err := tx.Select("id", "folder_id", "folder").Where("student_id = ? AND folder_id IN ?", studentID, folderIDs).Find(&notes).Error; err != nil {
		return err
	}
	for _, note := range notes {
		if note.FolderID == nil {
			continue
		}
		nextPath := pathByID[*note.FolderID]
		if nextPath == "" {
			continue
		}
		if note.Folder == nextPath {
			continue
		}
		if err := tx.Model(&models.Note{}).Where("id = ?", note.ID).Update("folder", nextPath).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *NoteService) listFolderSiblingIDsTx(tx *gorm.DB, studentID uuid.UUID, parentID *uuid.UUID, excludeID uuid.UUID) ([]uuid.UUID, error) {
	query := tx.Model(&models.NoteFolder{}).Where("student_id = ?", studentID)
	if parentID == nil {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	if excludeID != uuid.Nil {
		query = query.Where("id <> ?", excludeID)
	}

	var folders []models.NoteFolder
	if err := query.Order("sort_order ASC").Order("name ASC").Find(&folders).Error; err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(folders))
	for _, item := range folders {
		ids = append(ids, item.ID)
	}
	return ids, nil
}

func (s *NoteService) listNoteSiblingIDsTx(tx *gorm.DB, studentID uuid.UUID, folderID *uuid.UUID, excludeID uuid.UUID) ([]uuid.UUID, error) {
	query := tx.Model(&models.Note{}).Where("student_id = ?", studentID)
	if folderID == nil {
		query = query.Where("folder_id IS NULL")
	} else {
		query = query.Where("folder_id = ?", *folderID)
	}
	if excludeID != uuid.Nil {
		query = query.Where("id <> ?", excludeID)
	}

	var notes []models.Note
	if err := query.Order("sort_order ASC").Order("updated_at DESC").Find(&notes).Error; err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(notes))
	for _, item := range notes {
		ids = append(ids, item.ID)
	}
	return ids, nil
}

func (s *NoteService) resequenceFoldersTx(tx *gorm.DB, ids []uuid.UUID) error {
	for idx, id := range ids {
		if err := tx.Model(&models.NoteFolder{}).Where("id = ?", id).Update("sort_order", idx).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *NoteService) resequenceNotesTx(tx *gorm.DB, ids []uuid.UUID) error {
	for idx, id := range ids {
		if err := tx.Model(&models.Note{}).Where("id = ?", id).Update("sort_order", idx).Error; err != nil {
			return err
		}
	}
	return nil
}

// syncLinks extracts [[wiki-links]] from content and updates note_links table.
func (s *NoteService) syncLinks(noteID, studentID uuid.UUID, content string) {
	// Delete existing outgoing links.
	s.db.Where("source_id = ?", noteID).Delete(&models.NoteLink{})

	// Extract [[title]] references.
	matches := wikiLinkRe.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return
	}

	titles := make([]string, 0, len(matches))
	for _, m := range matches {
		titles = append(titles, m[1])
	}

	// Find target notes by title.
	var targets []models.Note
	s.db.Select("id").Where("student_id = ? AND title IN ?", studentID, titles).Find(&targets)

	for _, t := range targets {
		if t.ID != noteID {
			s.db.Create(&models.NoteLink{SourceID: noteID, TargetID: t.ID})
		}
	}
}

func parseFlexibleUUID(raw interface{}) (*uuid.UUID, error) {
	if raw == nil {
		return nil, nil
	}
	switch typed := raw.(type) {
	case uuid.UUID:
		if typed == uuid.Nil {
			return nil, nil
		}
		value := typed
		return &value, nil
	case *uuid.UUID:
		if typed == nil || *typed == uuid.Nil {
			return nil, nil
		}
		value := *typed
		return &value, nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil, nil
		}
		parsed, err := uuid.Parse(trimmed)
		if err != nil {
			return nil, err
		}
		return &parsed, nil
	default:
		return nil, fmt.Errorf("unsupported uuid type")
	}
}

func sanitizeFolderName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	name = strings.ReplaceAll(name, "\\", "")
	name = strings.Trim(name, "/")
	if name == "" || name == "." || name == ".." {
		return "", ErrInvalidFolder
	}
	if strings.Contains(name, "/") {
		return "", ErrInvalidFolder
	}
	return name, nil
}

func normalizeFolderPath(raw string) string {
	normalized := strings.TrimSpace(raw)
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	parts := splitFolderParts(normalized)
	if len(parts) == 0 {
		return "/"
	}
	return "/" + strings.Join(parts, "/")
}

func splitFolderParts(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.ReplaceAll(trimmed, "\\", "/")
	trimmed = strings.Trim(trimmed, "/")
	if trimmed == "" {
		return nil
	}
	chunks := strings.Split(trimmed, "/")
	parts := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		value := strings.TrimSpace(chunk)
		if value == "" {
			continue
		}
		parts = append(parts, value)
	}
	return parts
}

func buildFolderPath(parentPath, name string) string {
	cleanParent := normalizeFolderPath(parentPath)
	trimmedName := strings.TrimSpace(name)
	trimmedName = strings.Trim(trimmedName, "/")
	if trimmedName == "" {
		return cleanParent
	}
	if cleanParent == "/" {
		return "/" + trimmedName
	}
	return cleanParent + "/" + trimmedName
}

func clampIndex(index int, size int) int {
	if index < 0 {
		return 0
	}
	if index > size {
		return size
	}
	return index
}

func insertUUIDAt(ids []uuid.UUID, value uuid.UUID, index int) []uuid.UUID {
	index = clampIndex(index, len(ids))
	out := make([]uuid.UUID, 0, len(ids)+1)
	out = append(out, ids[:index]...)
	out = append(out, value)
	out = append(out, ids[index:]...)
	return out
}

func cloneUUIDPtr(value *uuid.UUID) *uuid.UUID {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func uuidPtrKey(value *uuid.UUID) string {
	if value == nil {
		return "root"
	}
	return value.String()
}

func uuidPtrEqual(left, right *uuid.UUID) bool {
	if left == nil && right == nil {
		return true
	}
	if left == nil || right == nil {
		return false
	}
	return *left == *right
}

func countWords(s string) int {
	return utf8.RuneCountInString(strings.TrimSpace(s))
}
