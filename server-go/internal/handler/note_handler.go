package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.uber.org/zap"

	"pathmind-server/internal/models"
	"pathmind-server/internal/service"
)

// NoteHandler handles note endpoints.
type NoteHandler struct {
	svc             noteHandlerService
	logger          *zap.Logger
	agentServiceURL string
}

type noteHandlerService interface {
	Create(studentID uuid.UUID, title, content, folder string, folderID *uuid.UUID, sortOrder *int, tags []string) (*models.Note, error)
	Get(noteID, studentID uuid.UUID) (*models.Note, error)
	Update(noteID, studentID uuid.UUID, updates map[string]interface{}) (*models.Note, error)
	Delete(noteID, studentID uuid.UUID) error
	List(studentID uuid.UUID, folder string, tags []string, search string, page, pageSize int) ([]models.Note, int64, error)
	GetTree(studentID uuid.UUID) (*service.NoteTreeSnapshot, error)
	CreateFolder(studentID uuid.UUID, name string, parentID *uuid.UUID, index *int) (*models.NoteFolder, error)
	UpdateFolder(studentID uuid.UUID, folderID uuid.UUID, name *string, parentID *uuid.UUID, parentProvided bool, index *int) (*models.NoteFolder, error)
	DeleteFolder(studentID, folderID uuid.UUID, strategy string) error
	Reorder(studentID uuid.UUID, payload service.NoteReorderPayload) error
	GetBacklinks(noteID, studentID uuid.UUID) ([]models.Note, error)
	GetGraph(studentID uuid.UUID) (*service.NoteGraph, error)
	ListFolders(studentID uuid.UUID) ([]string, error)
	ListTags(studentID uuid.UUID) ([]string, error)
}

// NewNoteHandler creates a new NoteHandler.
func NewNoteHandler(svc noteHandlerService, logger *zap.Logger, agentServiceURL string) *NoteHandler {
	return &NoteHandler{svc: svc, logger: logger, agentServiceURL: agentServiceURL}
}

type createNoteReq struct {
	Title     string   `json:"title" binding:"required"`
	Content   string   `json:"content"`
	Folder    string   `json:"folder"`
	FolderID  *string  `json:"folder_id"`
	SortOrder *int     `json:"sort_order"`
	Tags      []string `json:"tags"`
}

type updateNoteReq struct {
	Title     *string  `json:"title"`
	Content   *string  `json:"content"`
	Folder    *string  `json:"folder"`
	FolderID  *string  `json:"folder_id"`
	SortOrder *int     `json:"sort_order"`
	Tags      []string `json:"tags"`
}

type createFolderReq struct {
	Name     string  `json:"name" binding:"required"`
	ParentID *string `json:"parent_id"`
	Index    *int    `json:"index"`
}

type updateFolderReq struct {
	Name     *string `json:"name"`
	ParentID *string `json:"parent_id"`
	Index    *int    `json:"index"`
}

type reorderReq struct {
	Kind     string  `json:"kind" binding:"required"`
	ItemID   string  `json:"item_id" binding:"required"`
	ParentID *string `json:"parent_id"`
	Index    int     `json:"index"`
}

func normalizeNoteTags(note *models.Note) {
	if note == nil {
		return
	}
	if note.Tags == nil {
		note.Tags = pq.StringArray{}
	}
}

func parseOptionalUUID(raw *string) (*uuid.UUID, error) {
	if raw == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, nil
	}
	value, err := uuid.Parse(trimmed)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func noteStatusCodeForError(err error) int {
	switch {
	case errors.Is(err, service.ErrNoteNotFound), errors.Is(err, service.ErrFolderNotFound):
		return http.StatusNotFound
	case errors.Is(err, service.ErrFolderConflict):
		return http.StatusConflict
	case errors.Is(err, service.ErrInvalidMove),
		errors.Is(err, service.ErrInvalidFolder),
		errors.Is(err, service.ErrInvalidReorder),
		errors.Is(err, service.ErrUnsupportedMode):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *NoteHandler) getStudentID(c *gin.Context) (uuid.UUID, bool) {
	uid, exists := c.Get("user_id")
	if exists {
		if userUUID, ok := uid.(uuid.UUID); ok {
			return userUUID, true
		}
		if raw, ok := uid.(string); ok {
			parsed, err := uuid.Parse(strings.TrimSpace(raw))
			if err == nil {
				return parsed, true
			}
		}
	}

	internalStudentID := strings.TrimSpace(c.GetHeader("X-Student-ID"))
	if internalStudentID != "" {
		parsed, err := uuid.Parse(internalStudentID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid X-Student-ID"})
			return uuid.Nil, false
		}
		return parsed, true
	}

	c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	return uuid.Nil, false
}

// Create creates a new note.
func (h *NoteHandler) Create(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	var req createNoteReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}

	folderID, err := parseOptionalUUID(req.FolderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder_id"})
		return
	}

	note, err := h.svc.Create(studentID, req.Title, req.Content, req.Folder, folderID, req.SortOrder, req.Tags)
	if err != nil {
		h.logger.Error("create note failed", zap.Error(err))
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	normalizeNoteTags(note)
	c.JSON(http.StatusCreated, note)
	h.notifyEmbed(note)
}

// Get returns a single note.
func (h *NoteHandler) Get(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	noteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note id"})
		return
	}

	note, err := h.svc.Get(noteID, studentID)
	if err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	normalizeNoteTags(note)
	c.JSON(http.StatusOK, note)
}

// Update updates a note.
func (h *NoteHandler) Update(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	noteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note id"})
		return
	}

	var req updateNoteReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	updates := make(map[string]interface{})
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Content != nil {
		updates["content"] = *req.Content
	}
	if req.Folder != nil {
		updates["folder"] = *req.Folder
	}
	if req.FolderID != nil {
		folderID, parseErr := parseOptionalUUID(req.FolderID)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder_id"})
			return
		}
		updates["folder_id"] = folderID
	}
	if req.SortOrder != nil {
		updates["sort_order"] = *req.SortOrder
	}
	if req.Tags != nil {
		updates["tags"] = req.Tags
	}

	note, err := h.svc.Update(noteID, studentID, updates)
	if err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	normalizeNoteTags(note)
	c.JSON(http.StatusOK, note)
	h.notifyEmbed(note)
}

// Delete deletes a note.
func (h *NoteHandler) Delete(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	noteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note id"})
		return
	}

	if err := h.svc.Delete(noteID, studentID); err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
	h.notifyDelete(noteID)
}

// List returns notes with filtering.
func (h *NoteHandler) List(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	folder := c.Query("folder")
	search := c.Query("search")
	var tags []string
	if t := c.Query("tags"); t != "" {
		tags = strings.Split(t, ",")
	}

	page := 1
	pageSize := 20
	if p := c.Query("page"); p != "" {
		fmt.Sscanf(p, "%d", &page)
	}
	if ps := c.Query("page_size"); ps != "" {
		fmt.Sscanf(ps, "%d", &pageSize)
	}

	notes, total, err := h.svc.List(studentID, folder, tags, search, page, pageSize)
	if err != nil {
		h.logger.Error("list notes failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list notes"})
		return
	}
	if notes == nil {
		notes = []models.Note{}
	}
	for i := range notes {
		normalizeNoteTags(&notes[i])
	}

	c.JSON(http.StatusOK, gin.H{
		"notes": notes,
		"total": total,
		"page":  page,
	})
}

// GetTree returns folders + notes tree snapshot.
func (h *NoteHandler) GetTree(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	tree, err := h.svc.GetTree(studentID)
	if err != nil {
		h.logger.Error("get note tree failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get note tree"})
		return
	}
	if tree == nil {
		c.JSON(http.StatusOK, gin.H{"folders": []models.NoteFolder{}, "notes": []models.Note{}})
		return
	}
	for i := range tree.Notes {
		normalizeNoteTags(&tree.Notes[i])
	}
	c.JSON(http.StatusOK, tree)
}

// CreateFolder creates a note folder.
func (h *NoteHandler) CreateFolder(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	var req createFolderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	parentID, err := parseOptionalUUID(req.ParentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parent_id"})
		return
	}

	folder, err := h.svc.CreateFolder(studentID, req.Name, parentID, req.Index)
	if err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, folder)
}

// UpdateFolder renames/moves a folder.
func (h *NoteHandler) UpdateFolder(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	folderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder id"})
		return
	}

	var req updateFolderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	parentID, err := parseOptionalUUID(req.ParentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parent_id"})
		return
	}

	folder, err := h.svc.UpdateFolder(studentID, folderID, req.Name, parentID, req.ParentID != nil, req.Index)
	if err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, folder)
}

// DeleteFolder deletes a folder with strategy.
func (h *NoteHandler) DeleteFolder(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	folderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder id"})
		return
	}

	strategy := strings.TrimSpace(c.DefaultQuery("strategy", service.FolderDeleteMoveToParent))
	if err := h.svc.DeleteFolder(studentID, folderID, strategy); err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// Reorder handles folder/note drag reorder.
func (h *NoteHandler) Reorder(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	var req reorderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	itemID, err := uuid.Parse(strings.TrimSpace(req.ItemID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item_id"})
		return
	}
	parentID, err := parseOptionalUUID(req.ParentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parent_id"})
		return
	}

	err = h.svc.Reorder(studentID, service.NoteReorderPayload{
		Kind:     req.Kind,
		ItemID:   itemID,
		ParentID: parentID,
		Index:    req.Index,
	})
	if err != nil {
		c.JSON(noteStatusCodeForError(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetBacklinks returns notes linking to the given note.
func (h *NoteHandler) GetBacklinks(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	noteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note id"})
		return
	}

	notes, err := h.svc.GetBacklinks(noteID, studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get backlinks"})
		return
	}
	if notes == nil {
		notes = []models.Note{}
	}
	for i := range notes {
		normalizeNoteTags(&notes[i])
	}
	c.JSON(http.StatusOK, notes)
}

// GetGraph returns the note relationship graph.
func (h *NoteHandler) GetGraph(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	graph, err := h.svc.GetGraph(studentID)
	if err != nil {
		h.logger.Error("get note graph failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get graph"})
		return
	}
	c.JSON(http.StatusOK, graph)
}

// ListFolders returns distinct folders.
func (h *NoteHandler) ListFolders(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	folders, err := h.svc.ListFolders(studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list folders"})
		return
	}
	if folders == nil {
		folders = []string{}
	}
	c.JSON(http.StatusOK, folders)
}

// ListTags returns distinct tags.
func (h *NoteHandler) ListTags(c *gin.Context) {
	studentID, ok := h.getStudentID(c)
	if !ok {
		return
	}

	tags, err := h.svc.ListTags(studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tags"})
		return
	}
	if tags == nil {
		tags = []string{}
	}
	c.JSON(http.StatusOK, tags)
}

// ──────────────────────────────────────────
// Python Agent Service webhook (fire-and-forget)
// ──────────────────────────────────────────

func (h *NoteHandler) notifyEmbed(note *models.Note) {
	if h.agentServiceURL == "" {
		return
	}
	go func() {
		payload, _ := json.Marshal(map[string]interface{}{
			"note_id":    note.ID.String(),
			"student_id": note.StudentID.String(),
			"title":      note.Title,
			"content":    note.Content,
			"tags":       note.Tags,
		})
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Post(
			h.agentServiceURL+"/notes/embed",
			"application/json",
			bytes.NewReader(payload),
		)
		if err != nil {
			h.logger.Warn("note embed webhook failed", zap.Error(err))
			return
		}
		resp.Body.Close()
	}()
}

func (h *NoteHandler) notifyDelete(noteID uuid.UUID) {
	if h.agentServiceURL == "" {
		return
	}
	go func() {
		req, _ := http.NewRequest(http.MethodDelete,
			fmt.Sprintf("%s/notes/embed/%s", h.agentServiceURL, noteID.String()), nil)
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			h.logger.Warn("note delete webhook failed", zap.Error(err))
			return
		}
		resp.Body.Close()
	}()
}
