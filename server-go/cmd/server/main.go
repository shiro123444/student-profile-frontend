package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"pathmind-server/internal/config"
	"pathmind-server/internal/database"
	"pathmind-server/internal/handler"
	"pathmind-server/internal/middleware"
	"pathmind-server/internal/repository/neo4j"
	"pathmind-server/internal/repository/postgres"
	"pathmind-server/internal/repository/redis"
	"pathmind-server/internal/service"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize logger
	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	defer logger.Sync()

	// Initialize databases
	db, err := database.Init(cfg)
	if err != nil {
		logger.Fatal("Failed to initialize databases", zap.Error(err))
	}
	defer db.Close()

	// Initialize repositories
	userRepo := postgres.NewUserRepository(db.PG, logger)
	studentRepo := postgres.NewStudentRepository(db.PG, logger)
	experimentRepo := postgres.NewExperimentRepository(db.PG, logger)
	cacheRepo := redis.NewCacheRepository(db.Redis, logger)
	mbtiRepo := neo4j.NewMBTIRepository(db.Neo4j, logger)
	careerRepo := neo4j.NewCareerRepository(db.Neo4j, logger)
	learningPathRepo := neo4j.NewLearningPathRepository(db.Neo4j, logger)
	graphRepo := neo4j.NewGraphRepository(db.Neo4j, logger)

	// Initialize services
	authService := service.NewAuthService(userRepo, cfg.JWT.Secret, cfg.JWT.ExpireHours, logger)
	studentService := service.NewStudentService(studentRepo, experimentRepo, cacheRepo, logger)
	experimentService := service.NewExperimentService(experimentRepo, studentRepo, logger)
	mbtiService := service.NewMBTIService(mbtiRepo, careerRepo, learningPathRepo, cacheRepo, logger)
	graphService := service.NewGraphService(graphRepo, logger)
	agentProxyService := service.NewAgentProxyService(cfg.AgentService, logger)
	agentMetricsHistoryService := service.NewAgentMetricsHistoryService(db.PG, cfg.AgentService, logger)
	graphBatchTimelineService := service.NewGraphBatchTimelineService(db.PG, logger)
	pointsService := service.NewPointsService(db.PG, cacheRepo, logger)
	noteService := service.NewNoteService(db.PG, logger)
	toolService := service.NewToolService(db.PG, logger)
	statsService := service.NewStatsService(db.PG, cacheRepo, logger)
	inlineCompletionService := service.NewInlineCompletionService(cfg.InlineCompletion, logger)

	// Initialize handlers
	authHandler := handler.NewAuthHandler(authService, logger)
	studentHandler := handler.NewStudentHandler(studentService, logger)
	experimentHandler := handler.NewExperimentHandler(experimentService, logger)
	mbtiHandler := handler.NewMBTIHandler(mbtiService, logger)
	graphHandler := handler.NewGraphHandler(graphService, logger)
	agentHandler := handler.NewAgentHandler(agentProxyService, agentMetricsHistoryService, graphBatchTimelineService, logger)
	agentAuditHandler := handler.NewAgentAuditHandler(db.PG, logger)
	pointsHandler := handler.NewPointsHandler(pointsService, logger)
	wsHandler := handler.NewWSHandler(agentProxyService, logger)
	sandboxHandler := handler.NewSandboxHandler(logger)
	documentHandler := handler.NewDocumentHandler(db.PG, logger, cfg.UploadDir, cfg.AgentService.URL)
	challengeHandler := handler.NewChallengeHandler(db.PG, logger)
	noteHandler := handler.NewNoteHandler(noteService, logger, cfg.AgentService.URL)
	toolHandler := handler.NewToolHandler(toolService, logger)
	statsHandler := handler.NewStatsHandler(statsService, logger)
	inlineCompletionHandler := handler.NewInlineCompletionHandler(inlineCompletionService, logger)

	// Setup router
	router := setupRouter(cfg, logger,
		authHandler, studentHandler, experimentHandler, mbtiHandler, graphHandler,
		agentHandler, agentAuditHandler, pointsHandler, wsHandler, sandboxHandler, documentHandler, challengeHandler,
		noteHandler, toolHandler, statsHandler, inlineCompletionHandler, agentMetricsHistoryService,
	)

	// Start server
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%s", cfg.Server.Port),
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Failed to start server", zap.Error(err))
		}
	}()

	logger.Info("Server started", zap.String("port", cfg.Server.Port))

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	if err := agentMetricsHistoryService.Shutdown(ctx); err != nil {
		logger.Warn("Agent metrics history shutdown timed out", zap.Error(err))
	}

	logger.Info("Server exited")
}

func setupRouter(
	cfg *config.Config,
	logger *zap.Logger,
	authHandler *handler.AuthHandler,
	studentHandler *handler.StudentHandler,
	experimentHandler *handler.ExperimentHandler,
	mbtiHandler *handler.MBTIHandler,
	graphHandler *handler.GraphHandler,
	agentHandler *handler.AgentHandler,
	agentAuditHandler *handler.AgentAuditHandler,
	pointsHandler *handler.PointsHandler,
	wsHandler *handler.WSHandler,
	sandboxHandler *handler.SandboxHandler,
	documentHandler *handler.DocumentHandler,
	challengeHandler *handler.ChallengeHandler,
	noteHandler *handler.NoteHandler,
	toolHandler *handler.ToolHandler,
	statsHandler *handler.StatsHandler,
	inlineCompletionHandler *handler.InlineCompletionHandler,
	agentMetricsHistoryService *service.AgentMetricsHistoryService,
) *gin.Engine {
	if cfg.Server.Mode == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Middleware
	router.Use(gin.Recovery())
	router.Use(middleware.LoggerMiddleware(logger))
	router.Use(middleware.CORSMiddleware())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// API routes
	api := router.Group("/api")
	{
		// Auth routes (public)
		authGroup := api.Group("/auth")
		{
			authGroup.POST("/register", authHandler.Register)
			authGroup.POST("/login", authHandler.Login)
		}

		// Auth routes (protected)
		authProtected := api.Group("/auth")
		authProtected.Use(middleware.AuthMiddleware(cfg.JWT.Secret))
		{
			authProtected.POST("/refresh", authHandler.RefreshToken)
			authProtected.GET("/me", authHandler.GetMe)
		}

		// MBTI routes (public)
		mbti := api.Group("/mbti")
		{
			mbti.POST("/submit", mbtiHandler.SubmitMBTITest)
			mbti.GET("/types", mbtiHandler.GetAllMBTITypes)
			mbti.GET("/types/:code", mbtiHandler.GetMBTIType)
			mbti.GET("/types/:code/careers", mbtiHandler.GetRecommendedCareers)
		}

		// Career routes (public)
		careers := api.Group("/careers")
		{
			careers.GET("/:id", mbtiHandler.GetCareerByID)
			careers.GET("/:id/learning-paths", mbtiHandler.GetLearningPathByCareer)
		}

		// Learning path routes (public)
		learningPaths := api.Group("/learning-paths")
		{
			learningPaths.GET("/recommended", mbtiHandler.GetRecommendedLearningPath)
		}

		// Graph routes (public)
		graph := api.Group("/graph")
		{
			graph.GET("/full", graphHandler.GetFullGraph)
			graph.GET("/student/:id", graphHandler.GetStudentGraph)
			graph.GET("/career/:id", graphHandler.GetCareerGraph)
		}

		// Protected routes
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(cfg.JWT.Secret))
		{
			protected.POST("/complete", inlineCompletionHandler.Complete)

			// Student routes
			students := protected.Group("/students")
			{
				students.GET("/:id/profile", studentHandler.GetStudentProfile)
				students.POST("/:id/profile/refresh", studentHandler.RefreshStudentProfile)
				students.GET("/:id/experiments", experimentHandler.GetStudentExperiments)
				students.GET("/:id/learning-trend", experimentHandler.GetLearningTrend)
			}

			// Class routes (teacher/admin only)
			classes := protected.Group("/classes")
			classes.Use(middleware.RoleMiddleware("teacher", "admin"))
			{
				classes.GET("/:id/overview", studentHandler.GetClassOverview)
				classes.GET("/:id/alerts", studentHandler.GetStudentAlerts)
			}

			// Experiment routes
			experiments := protected.Group("/experiments")
			{
				experiments.GET("", experimentHandler.GetAllExperiments)
				experiments.GET("/:id", experimentHandler.GetExperimentByID)
				experiments.POST("", middleware.RoleMiddleware("teacher", "admin"), experimentHandler.CreateExperiment)
				experiments.POST("/start", experimentHandler.StartExperiment)
				experiments.POST("/:id/submit", experimentHandler.SubmitExperiment)
			}

			// Agent routes
			agentRateLimitWindow := time.Duration(cfg.AgentService.RateLimitWindowSec) * time.Second
			agent := protected.Group("/agent")
			agent.Use(middleware.AgentMetricsMiddleware("protected", agentMetricsHistoryService.RecordRequest))
			agent.Use(middleware.AgentRateLimitMiddleware(cfg.AgentService.RateLimitRequests, agentRateLimitWindow))
			{
				agent.POST("/query", agentHandler.Query)
				agent.POST("/stream", agentHandler.StreamQuery)
				agent.POST("/graph/feedback", agentHandler.ReportGraphCommandFeedback)
				agent.GET("/graph/feedback", agentHandler.GetGraphCommandFeedback)
				agent.POST("/graph/batch-feedback", agentHandler.ReportGraphBatchFeedback)
				agent.GET("/graph/batch-feedback", agentHandler.GetGraphBatchFeedback)
				agent.GET("/list", agentHandler.ListAgents)
				agent.GET("/agents", agentHandler.ListAgents)
				agent.GET("/:name/capabilities", agentHandler.GetAgentCapabilities)
				agent.GET("/sessions", agentHandler.ListSessions)
				agent.DELETE("/sessions", agentHandler.ClearSessions)
				agent.GET("/approvals/metrics", agentHandler.GetApprovalMetrics)
				agent.GET("/coding/policies", agentHandler.GetCodingPolicyProfiles)
				agent.GET("/task-templates", agentHandler.ListTaskTemplates)
				agent.POST("/task-templates/start", agentHandler.StartTaskTemplate)
				agent.POST("/approvals/:id/approve", agentHandler.ApprovePendingAction)
				agent.POST("/approvals/:id/reject", agentHandler.RejectPendingAction)
				agent.GET("/tools", agentHandler.ListTools)
				agent.GET("/skills", agentHandler.ListSkills)
				agent.POST("/skills/execute", agentHandler.ExecuteSkill)
				agent.GET("/metrics", agentHandler.GetMetrics)
				agent.GET("/metrics/history", agentHandler.GetMetricsHistory)
			}

			// Unified AI dispatch routes (task-based routing)
			aiDispatch := protected.Group("/ai/dispatch")
			aiDispatch.Use(middleware.AgentMetricsMiddleware("protected", agentMetricsHistoryService.RecordRequest))
			aiDispatch.Use(middleware.AgentRateLimitMiddleware(cfg.AgentService.RateLimitRequests, agentRateLimitWindow))
			{
				aiDispatch.POST("/stream", agentHandler.DispatchStream)
				aiDispatch.GET("/metrics", agentHandler.GetDispatchMetrics)
			}

			// WebSocket routes
			ws := protected.Group("/ws")
			{
				ws.GET("/agent", wsHandler.AgentWebSocket)
			}

			// Points routes
			points := protected.Group("/points")
			{
				points.GET("/balance", pointsHandler.GetBalance)
				points.POST("/checkin", pointsHandler.DailyCheckin)
				points.GET("/transactions", pointsHandler.GetTransactions)
				points.POST("/exchange", pointsHandler.ExchangeCredits)
				points.GET("/leaderboard", pointsHandler.GetLeaderboard)
			}

			// Sandbox routes (interface stubs - OJ integration)
			sandbox := protected.Group("/sandbox")
			{
				sandbox.POST("/execute", sandboxHandler.Execute)
				sandbox.GET("/result/:id", sandboxHandler.GetResult)
				sandbox.GET("/languages", sandboxHandler.ListLanguages)
			}

			// Document routes
			documents := protected.Group("/documents")
			{
				documents.POST("/upload", documentHandler.Upload)
				documents.GET("", documentHandler.ListDocuments)
				documents.GET("/:id", documentHandler.GetDocument)
				documents.GET("/:id/preview", documentHandler.PreviewDocument)
				documents.GET("/:id/download", documentHandler.DownloadDocument)
				documents.POST("/query", documentHandler.QueryDocuments)
				documents.DELETE("/:id", documentHandler.DeleteDocument)
			}

			// Challenge routes (interface stubs - OJ integration)
			challenges := protected.Group("/challenges")
			{
				challenges.GET("", challengeHandler.ListChallenges)
				challenges.GET("/:id", challengeHandler.GetChallenge)
				challenges.POST("/:id/submit", challengeHandler.SubmitSolution)
				challenges.POST("", middleware.RoleMiddleware("teacher", "admin"), challengeHandler.Create)
				challenges.GET("/:id/submissions", challengeHandler.GetSubmissions)
			}

			// Note routes (Obsidian-style)
			notes := protected.Group("/notes")
			{
				notes.POST("", noteHandler.Create)
				notes.GET("", noteHandler.List)
				notes.GET("/tree", noteHandler.GetTree)
				notes.POST("/folders", noteHandler.CreateFolder)
				notes.PATCH("/folders/:id", noteHandler.UpdateFolder)
				notes.DELETE("/folders/:id", noteHandler.DeleteFolder)
				notes.POST("/reorder", noteHandler.Reorder)
				notes.GET("/folders", noteHandler.ListFolders)
				notes.GET("/tags", noteHandler.ListTags)
				notes.GET("/graph", noteHandler.GetGraph)
				notes.GET("/:id", noteHandler.Get)
				notes.PUT("/:id", noteHandler.Update)
				notes.DELETE("/:id", noteHandler.Delete)
				notes.GET("/:id/backlinks", noteHandler.GetBacklinks)
			}

			// Custom tools routes
			tools := protected.Group("/tools")
			{
				tools.POST("", toolHandler.CreateTool)
				tools.GET("", toolHandler.ListTools)
				tools.GET("/:id", toolHandler.GetTool)
				tools.PUT("/:id", toolHandler.UpdateTool)
				tools.DELETE("/:id", toolHandler.DeleteTool)
				tools.POST("/:id/approve", middleware.RoleMiddleware("admin"), toolHandler.ApproveTool)
			}

			// Custom skills routes
			skills := protected.Group("/skills")
			{
				skills.POST("", toolHandler.CreateSkill)
				skills.GET("", toolHandler.ListSkills)
				skills.GET("/:id", toolHandler.GetSkill)
				skills.PUT("/:id", toolHandler.UpdateSkill)
				skills.DELETE("/:id", toolHandler.DeleteSkill)
				skills.POST("/:id/approve", middleware.RoleMiddleware("admin"), toolHandler.ApproveSkill)
			}
		}

		// Internal endpoints (called by Python service, no auth)
		internal := api.Group("/internal")
		{
			internal.GET("/tools/active", toolHandler.ListActiveTools)
			internal.GET("/skills/active", toolHandler.ListActiveSkills)
			internal.POST("/agent/audit", agentAuditHandler.Ingest)

			// Internal student routes (for Python agent tools)
			internal.GET("/students/:id/profile", studentHandler.GetStudentProfile)
			internal.GET("/students/:id/learning-trend", experimentHandler.GetLearningTrend)
			internal.POST("/students/:id/profile/refresh", studentHandler.RefreshStudentProfile)
			internal.GET("/classes/:id/overview", studentHandler.GetClassOverview)
			internal.GET("/classes/:id/alerts", studentHandler.GetStudentAlerts)

			// Internal note routes (for Python agent tools)
			internal.POST("/notes", noteHandler.Create)
			internal.GET("/notes", noteHandler.List)
			internal.GET("/notes/tree", noteHandler.GetTree)
			internal.POST("/notes/folders", noteHandler.CreateFolder)
			internal.PATCH("/notes/folders/:id", noteHandler.UpdateFolder)
			internal.DELETE("/notes/folders/:id", noteHandler.DeleteFolder)
			internal.POST("/notes/reorder", noteHandler.Reorder)
			internal.GET("/notes/folders", noteHandler.ListFolders)
			internal.GET("/notes/tags", noteHandler.ListTags)
			internal.GET("/notes/graph", noteHandler.GetGraph)
			internal.GET("/notes/:id", noteHandler.Get)
			internal.PUT("/notes/:id", noteHandler.Update)
			internal.DELETE("/notes/:id", noteHandler.Delete)
			internal.GET("/notes/:id/backlinks", noteHandler.GetBacklinks)
		}

		// Public stats endpoints (no auth, used by homepage agent)
		api.GET("/stats/platform", statsHandler.GetPlatformStats)
		api.GET("/careers/trending", statsHandler.GetTrendingCareers)
		api.GET("/experiments/featured", statsHandler.GetFeaturedExperiments)

		// Public agent endpoint (no auth, homepage chat only)
		publicAgentRateLimitWindow := time.Duration(cfg.AgentService.PublicRateLimitWindowSec) * time.Second
		publicAgent := api.Group("/agent/public")
		publicAgent.Use(middleware.AgentMetricsMiddleware("public", agentMetricsHistoryService.RecordRequest))
		publicAgent.Use(middleware.PublicAgentRateLimitMiddleware(cfg.AgentService.PublicRateLimitRequests, publicAgentRateLimitWindow))
		{
			publicAgent.POST("/stream", agentHandler.PublicStreamQuery)
			publicAgent.GET("/tools", agentHandler.ListTools)
			publicAgent.GET("/skills", agentHandler.ListSkills)
		}
	}

	return router
}
