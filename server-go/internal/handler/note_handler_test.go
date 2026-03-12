package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.uber.org/zap"

	"pathmind-server/internal/models"
	"pathmind-server/internal/service"
)

type fakeNoteHandlerService struct {
	reorderPayload service.NoteReorderPayload
	tree           *service.NoteTreeSnapshot
}

func (f *fakeNoteHandlerService) Create(studentID uuid.UUID, title, content, folder string, folderID *uuid.UUID, sortOrder *int, tags []string) (*models.Note, error) {
	_ = studentID
	_ = title
	_ = content
	_ = folder
	_ = folderID
	_ = sortOrder
	_ = tags
	return nil, nil
}

func (f *fakeNoteHandlerService) Get(noteID, studentID uuid.UUID) (*models.Note, error) {
	_ = noteID
	_ = studentID
	return nil, nil
}

func (f *fakeNoteHandlerService) Update(noteID, studentID uuid.UUID, updates map[string]interface{}) (*models.Note, error) {
	_ = noteID
	_ = studentID
	_ = updates
	return nil, nil
}

func (f *fakeNoteHandlerService) Delete(noteID, studentID uuid.UUID) error {
	_ = noteID
	_ = studentID
	return nil
}

func (f *fakeNoteHandlerService) List(studentID uuid.UUID, folder string, tags []string, search string, page, pageSize int) ([]models.Note, int64, error) {
	_ = studentID
	_ = folder
	_ = tags
	_ = search
	_ = page
	_ = pageSize
	return []models.Note{}, 0, nil
}

func (f *fakeNoteHandlerService) GetTree(studentID uuid.UUID) (*service.NoteTreeSnapshot, error) {
	_ = studentID
	if f.tree != nil {
		return f.tree, nil
	}
	return &service.NoteTreeSnapshot{Folders: []models.NoteFolder{}, Notes: []models.Note{}}, nil
}

func (f *fakeNoteHandlerService) CreateFolder(studentID uuid.UUID, name string, parentID *uuid.UUID, index *int) (*models.NoteFolder, error) {
	_ = studentID
	_ = name
	_ = parentID
	_ = index
	return &models.NoteFolder{ID: uuid.New(), StudentID: studentID, Name: name, ParentID: parentID, Path: "/" + name}, nil
}

func (f *fakeNoteHandlerService) UpdateFolder(studentID uuid.UUID, folderID uuid.UUID, name *string, parentID *uuid.UUID, parentProvided bool, index *int) (*models.NoteFolder, error) {
	_ = studentID
	_ = folderID
	_ = parentID
	_ = parentProvided
	_ = index
	nextName := "Folder"
	if name != nil {
		nextName = *name
	}
	return &models.NoteFolder{ID: folderID, StudentID: studentID, Name: nextName, ParentID: parentID, Path: "/" + nextName}, nil
}

func (f *fakeNoteHandlerService) DeleteFolder(studentID, folderID uuid.UUID, strategy string) error {
	_ = studentID
	_ = folderID
	_ = strategy
	return nil
}

func (f *fakeNoteHandlerService) Reorder(studentID uuid.UUID, payload service.NoteReorderPayload) error {
	_ = studentID
	f.reorderPayload = payload
	return nil
}

func (f *fakeNoteHandlerService) GetBacklinks(noteID, studentID uuid.UUID) ([]models.Note, error) {
	_ = noteID
	_ = studentID
	return []models.Note{}, nil
}

func (f *fakeNoteHandlerService) GetGraph(studentID uuid.UUID) (*service.NoteGraph, error) {
	_ = studentID
	return &service.NoteGraph{}, nil
}

func (f *fakeNoteHandlerService) ListFolders(studentID uuid.UUID) ([]string, error) {
	_ = studentID
	return []string{"/"}, nil
}

func (f *fakeNoteHandlerService) ListTags(studentID uuid.UUID) ([]string, error) {
	_ = studentID
	return []string{}, nil
}

func setupNoteHandlerTestRouter(h *NoteHandler, routeFn func(group *gin.RouterGroup)) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	api := r.Group("/api")
	api.Use(func(c *gin.Context) {
		c.Set("user_id", uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	routeFn(api)
	return r
}

func TestNoteHandler_CreateFolder_InvalidParentID(t *testing.T) {
	svc := &fakeNoteHandlerService{}
	h := NewNoteHandler(svc, zap.NewNop(), "")
	r := setupNoteHandlerTestRouter(h, func(group *gin.RouterGroup) {
		notes := group.Group("/notes")
		notes.POST("/folders", h.CreateFolder)
	})

	reqBody := []byte(`{"name":"Demo","parent_id":"invalid-id"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/notes/folders", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	r.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", resp.Code)
	}
}

func TestNoteHandler_Reorder_ForwardsPayload(t *testing.T) {
	svc := &fakeNoteHandlerService{}
	h := NewNoteHandler(svc, zap.NewNop(), "")
	r := setupNoteHandlerTestRouter(h, func(group *gin.RouterGroup) {
		notes := group.Group("/notes")
		notes.POST("/reorder", h.Reorder)
	})

	itemID := uuid.New()
	parentID := uuid.New()
	payload := map[string]interface{}{
		"kind":      "note",
		"item_id":   itemID.String(),
		"parent_id": parentID.String(),
		"index":     2,
	}
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest(http.MethodPost, "/api/notes/reorder", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	r.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.Code)
	}
	if svc.reorderPayload.Kind != "note" {
		t.Fatalf("expected kind note, got %q", svc.reorderPayload.Kind)
	}
	if svc.reorderPayload.ItemID != itemID {
		t.Fatalf("unexpected item id: %s", svc.reorderPayload.ItemID)
	}
	if svc.reorderPayload.ParentID == nil || *svc.reorderPayload.ParentID != parentID {
		t.Fatalf("unexpected parent id: %#v", svc.reorderPayload.ParentID)
	}
	if svc.reorderPayload.Index != 2 {
		t.Fatalf("unexpected index: %d", svc.reorderPayload.Index)
	}
}

func TestNoteHandler_GetTree_Response(t *testing.T) {
	noteID := uuid.New()
	studentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	svc := &fakeNoteHandlerService{
		tree: &service.NoteTreeSnapshot{
			Folders: []models.NoteFolder{{
				ID:        uuid.New(),
				StudentID: studentID,
				Name:      "RootFolder",
				Path:      "/RootFolder",
			}},
			Notes: []models.Note{{
				ID:        noteID,
				StudentID: studentID,
				Title:     "Note A",
				Folder:    "/",
				Tags:      pq.StringArray{"tag-a"},
			}},
		},
	}
	h := NewNoteHandler(svc, zap.NewNop(), "")
	r := setupNoteHandlerTestRouter(h, func(group *gin.RouterGroup) {
		notes := group.Group("/notes")
		notes.GET("/tree", h.GetTree)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/notes/tree", nil)
	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.Code)
	}

	var out struct {
		Folders []models.NoteFolder `json:"folders"`
		Notes   []models.Note       `json:"notes"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(out.Folders) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(out.Folders))
	}
	if len(out.Notes) != 1 {
		t.Fatalf("expected 1 note, got %d", len(out.Notes))
	}
	if len(out.Notes[0].Tags) != 1 || out.Notes[0].Tags[0] != "tag-a" {
		t.Fatalf("unexpected note tags: %#v", out.Notes[0].Tags)
	}
}
