package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"pathmind-server/internal/models"
)

// DocumentHandler handles document management endpoints
// pipeline: upload -> persist -> async rag ingest -> semantic query
type DocumentHandler struct {
	db              *gorm.DB
	logger          *zap.Logger
	uploadDir       string
	agentServiceURL string
	httpClient      *http.Client
}

// NewDocumentHandler creates a new DocumentHandler
func NewDocumentHandler(db *gorm.DB, logger *zap.Logger, uploadDir, agentServiceURL string) *DocumentHandler {
	return &DocumentHandler{
		db:              db,
		logger:          logger,
		uploadDir:       uploadDir,
		agentServiceURL: agentServiceURL,
		httpClient:      &http.Client{Timeout: 120 * time.Second},
	}
}

func isPrivilegedRole(role string) bool {
	return role == "teacher" || role == "admin"
}

func currentUserFromContext(c *gin.Context) (uuid.UUID, string, bool) {
	userIDRaw, ok := c.Get("user_id")
	if !ok {
		return uuid.Nil, "", false
	}
	userID, ok := userIDRaw.(uuid.UUID)
	if !ok {
		return uuid.Nil, "", false
	}
	roleRaw, _ := c.Get("role")
	role, _ := roleRaw.(string)
	return userID, role, true
}

func sanitizeFilenamePart(input string) string {
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	out := strings.TrimSpace(replacer.Replace(input))
	if out == "" {
		return "document"
	}
	return out
}

func buildDocumentDownloadName(doc models.Document) string {
	base := sanitizeFilenamePart(doc.Title)
	ext := strings.ToLower(filepath.Ext(doc.FilePath))
	if ext == "" && doc.FileType != "" {
		ext = "." + strings.ToLower(doc.FileType)
	}
	if ext != "" && !strings.HasSuffix(strings.ToLower(base), ext) {
		return base + ext
	}
	return base
}

func resolveDocumentContentType(doc models.Document) string {
	ext := strings.ToLower(filepath.Ext(doc.FilePath))
	if ext == "" && doc.FileType != "" {
		ext = "." + strings.ToLower(doc.FileType)
	}
	if ext != "" {
		if contentType := mime.TypeByExtension(ext); contentType != "" {
			return contentType
		}
	}
	if strings.EqualFold(doc.FileType, "pdf") {
		return "application/pdf"
	}
	return "application/octet-stream"
}

// Upload handles document file upload
func (h *DocumentHandler) Upload(c *gin.Context) {
	userID, _, ok := currentUserFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()

	title := c.PostForm("title")
	if title == "" {
		title = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	description := c.PostForm("description")
	courseID := c.PostForm("course_id")

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowedExts := map[string]bool{".pdf": true, ".docx": true, ".pptx": true, ".txt": true, ".md": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unsupported file type: %s", ext)})
		return
	}

	docDir := filepath.Join(h.uploadDir, "documents")
	if err := os.MkdirAll(docDir, 0o755); err != nil {
		h.logger.Error("failed to create upload dir", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create upload directory"})
		return
	}

	docID := uuid.New()
	filename := fmt.Sprintf("%s%s", docID.String(), ext)
	savePath := filepath.Join(docDir, filename)
	absoluteSavePath, err := filepath.Abs(savePath)
	if err != nil {
		h.logger.Error("failed to resolve absolute upload path", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve upload path"})
		return
	}
	savePath = absoluteSavePath

	out, err := os.Create(savePath)
	if err != nil {
		h.logger.Error("failed to create file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}
	defer out.Close()

	written, err := io.Copy(out, file)
	if err != nil {
		_ = os.Remove(savePath)
		h.logger.Error("failed to write file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	doc := models.Document{
		ID:          docID,
		Title:       title,
		Description: description,
		FilePath:    savePath,
		FileType:    strings.TrimPrefix(ext, "."),
		FileSize:    written,
		UploadedBy:  userID,
		IsActive:    true,
		IsIndexed:   false,
	}

	if courseID != "" {
		cid, err := uuid.Parse(courseID)
		if err == nil {
			doc.CourseID = &cid
		}
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&doc).Error; err != nil {
		_ = os.Remove(savePath)
		h.logger.Error("failed to save document record", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save document"})
		return
	}

	go h.triggerRAGIngest(doc.ID.String(), savePath)

	c.JSON(http.StatusCreated, gin.H{
		"id":          doc.ID,
		"title":       doc.Title,
		"file_type":   doc.FileType,
		"file_size":   doc.FileSize,
		"uploaded_by": doc.UploadedBy,
		"status":      "uploaded",
		"message":     "文档已上传，正在后台索引",
	})
}

// triggerRAGIngest calls the Python RAG service to ingest a document
func (h *DocumentHandler) triggerRAGIngest(documentID, filePath string) {
	markIngestFailed := func(reason string, fields ...zap.Field) {
		fieldList := []zap.Field{
			zap.String("doc_id", documentID),
			zap.String("reason", reason),
		}
		fieldList = append(fieldList, fields...)
		h.logger.Warn("RAG ingest not completed", fieldList...)

		if err := h.db.Model(&models.Document{}).
			Where("id = ?", documentID).
			Updates(map[string]interface{}{
				"is_indexed": false,
				"page_count": -1,
			}).Error; err != nil {
			h.logger.Error(
				"failed to persist ingest failure state",
				zap.String("doc_id", documentID),
				zap.String("reason", reason),
				zap.Error(err),
			)
		}
	}

	payload := map[string]string{
		"document_id": documentID,
		"file_path":   filePath,
	}
	body, _ := json.Marshal(payload)

	resp, err := h.httpClient.Post(
		h.agentServiceURL+"/rag/ingest",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		markIngestFailed("request_failed", zap.Error(err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		markIngestFailed(
			"non_200_response",
			zap.Int("status", resp.StatusCode),
			zap.String("body", string(respBody)),
		)
		return
	}

	var result struct {
		ChunksCreated int    `json:"chunks_created"`
		Status        string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		markIngestFailed("decode_failed", zap.Error(err))
		return
	}

	if result.Status == "completed" {
		if err := h.db.Model(&models.Document{}).Where("id = ?", documentID).Updates(map[string]interface{}{
			"is_indexed": true,
			"page_count": result.ChunksCreated,
		}).Error; err != nil {
			h.logger.Error(
				"failed to persist successful ingest state",
				zap.String("doc_id", documentID),
				zap.Int("chunks", result.ChunksCreated),
				zap.Error(err),
			)
			return
		}
		h.logger.Info("RAG ingest completed",
			zap.String("doc_id", documentID),
			zap.Int("chunks", result.ChunksCreated),
		)
		return
	}

	markIngestFailed(
		"ingest_status_not_completed",
		zap.String("status", result.Status),
		zap.Int("chunks", result.ChunksCreated),
	)
}

// ListDocuments returns active documents visible to current user
func (h *DocumentHandler) ListDocuments(c *gin.Context) {
	userID, role, ok := currentUserFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	query := h.db.WithContext(c.Request.Context()).Where("is_active = ?", true)
	if !isPrivilegedRole(role) {
		query = query.Where("uploaded_by = ?", userID)
	}

	var docs []models.Document
	if err := query.Order("created_at DESC").Find(&docs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list documents"})
		return
	}
	if docs == nil {
		docs = []models.Document{}
	}
	c.JSON(http.StatusOK, docs)
}

// GetDocument returns a specific document by ID
func (h *DocumentHandler) GetDocument(c *gin.Context) {
	userID, role, ok := currentUserFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id := c.Param("id")
	query := h.db.WithContext(c.Request.Context()).Where("id = ? AND is_active = ?", id, true)
	if !isPrivilegedRole(role) {
		query = query.Where("uploaded_by = ?", userID)
	}

	var doc models.Document
	if err := query.First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document not found"})
		return
	}
	c.JSON(http.StatusOK, doc)
}

// DeleteDocument soft-deletes a document and removes local file/chunks
func (h *DocumentHandler) DeleteDocument(c *gin.Context) {
	userID, role, ok := currentUserFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id := c.Param("id")
	var doc models.Document
	if err := h.db.WithContext(c.Request.Context()).Where("id = ? AND is_active = ?", id, true).First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document not found"})
		return
	}

	if !isPrivilegedRole(role) && doc.UploadedBy != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
		return
	}

	if err := h.db.WithContext(c.Request.Context()).Model(&models.Document{}).
		Where("id = ?", doc.ID).
		Updates(map[string]interface{}{"is_active": false}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete document"})
		return
	}

	_ = h.db.WithContext(c.Request.Context()).Exec("DELETE FROM document_chunks WHERE document_id = ?", doc.ID).Error
	if doc.FilePath != "" {
		_ = os.Remove(doc.FilePath)
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "id": doc.ID})
}

// QueryDocuments performs semantic search via the Python RAG service
func (h *DocumentHandler) QueryDocuments(c *gin.Context) {
	userID, role, ok := currentUserFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		Query    string `json:"query" binding:"required"`
		CourseID string `json:"course_id,omitempty"`
		Limit    int    `json:"limit,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query is required"})
		return
	}
	if req.Limit <= 0 {
		req.Limit = 5
	}

	payload := map[string]interface{}{
		"query": req.Query,
		"limit": req.Limit,
	}
	if req.CourseID != "" {
		payload["course_id"] = req.CourseID
	}
	if !isPrivilegedRole(role) {
		payload["uploaded_by"] = userID.String()
	}

	payloadBytes, _ := json.Marshal(payload)
	httpReq, err := http.NewRequestWithContext(
		c.Request.Context(),
		"POST",
		h.agentServiceURL+"/rag/query",
		bytes.NewReader(payloadBytes),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create request"})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(httpReq)
	if err != nil {
		h.logger.Error("RAG query failed", zap.Error(err))
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "RAG service unavailable"})
		return
	}
	defer resp.Body.Close()

	c.DataFromReader(resp.StatusCode, resp.ContentLength, "application/json", resp.Body, nil)
}

func (h *DocumentHandler) resolveVisibleDocument(c *gin.Context, id string) (*models.Document, bool) {
	userID, role, ok := currentUserFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return nil, false
	}

	query := h.db.WithContext(c.Request.Context()).Where("id = ? AND is_active = ?", id, true)
	if !isPrivilegedRole(role) {
		query = query.Where("uploaded_by = ?", userID)
	}

	var doc models.Document
	if err := query.First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document not found"})
		return nil, false
	}
	return &doc, true
}

func (h *DocumentHandler) streamDocumentFile(c *gin.Context, doc *models.Document, disposition string) {
	if doc.FilePath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "document file not found"})
		return
	}
	if _, err := os.Stat(doc.FilePath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document file not found"})
		return
	}

	filename := buildDocumentDownloadName(*doc)
	contentType := resolveDocumentContentType(*doc)

	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename=\"%s\"", disposition, filename))
	c.File(doc.FilePath)
}

// PreviewDocument streams document file with inline content-disposition
func (h *DocumentHandler) PreviewDocument(c *gin.Context) {
	id := c.Param("id")
	doc, ok := h.resolveVisibleDocument(c, id)
	if !ok {
		return
	}
	h.streamDocumentFile(c, doc, "inline")
}

// DownloadDocument streams document file as attachment
func (h *DocumentHandler) DownloadDocument(c *gin.Context) {
	id := c.Param("id")
	doc, ok := h.resolveVisibleDocument(c, id)
	if !ok {
		return
	}
	h.streamDocumentFile(c, doc, "attachment")
}
