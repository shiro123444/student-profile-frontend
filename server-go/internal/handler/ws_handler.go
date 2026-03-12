package handler

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"pathmind-server/internal/service"
)

// WSHandler handles WebSocket connections for real-time agent interaction
type WSHandler struct {
	agentProxy *service.AgentProxyService
	logger     *zap.Logger
	upgrader   websocket.Upgrader
}

// NewWSHandler creates a new WSHandler
func NewWSHandler(agentProxy *service.AgentProxyService, logger *zap.Logger) *WSHandler {
	return &WSHandler{
		agentProxy: agentProxy,
		logger:     logger,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // TODO: restrict in production
			},
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
		},
	}
}

// wsMessage represents a WebSocket message
type wsMessage struct {
	Type      string `json:"type"`       // query, interrupt
	Agent     string `json:"agent,omitempty"`
	Message   string `json:"message,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// AgentWebSocket handles WebSocket connections for agent chat
func (h *WSHandler) AgentWebSocket(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", zap.Error(err))
		return
	}
	defer conn.Close()

	userID, _ := c.Get("user_id")

	var writeMu sync.Mutex
	writeJSON := func(v interface{}) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				h.logger.Error("WebSocket read error", zap.Error(err))
			}
			break
		}

		var msg wsMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			writeJSON(map[string]string{"type": "error", "message": "invalid message format"})
			continue
		}

		switch msg.Type {
		case "query":
			go func() {
				req := service.AgentQueryRequest{
					AgentName: msg.Agent,
					Prompt:    msg.Message,
				}
				if uid, ok := userID.(string); ok {
					req.StudentID = uid
				}

				result, err := h.agentProxy.Query(c.Request.Context(), req)
				if err != nil {
					writeJSON(map[string]string{"type": "error", "message": err.Error()})
					return
				}

				writeJSON(map[string]interface{}{
					"type":       "text",
					"content":    result.Response,
					"session_id": msg.SessionID,
				})
				writeJSON(map[string]interface{}{
					"type":            "done",
					"session_id":      msg.SessionID,
					"cost":            result.CostUSD,
					"credits_charged": result.CostUSD,
				})
			}()

		case "interrupt":
			// TODO: Cancel ongoing agent query
			writeJSON(map[string]string{"type": "error", "message": "interrupt not yet implemented"})

		default:
			writeJSON(map[string]string{"type": "error", "message": "unknown message type"})
		}
	}
}
