.PHONY: help build run test clean docker-up docker-down migrate-up migrate-neo4j

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the application
	@echo "Building..."
	@go build -o bin/server cmd/server/main.go

run: ## Run the application
	@echo "Running..."
	@go run cmd/server/main.go

test: ## Run tests
	@echo "Running tests..."
	@go test -v ./...

test-coverage: ## Run tests with coverage
	@echo "Running tests with coverage..."
	@go test -v -coverprofile=coverage.out ./...
	@go tool cover -html=coverage.out -o coverage.html

clean: ## Clean build artifacts
	@echo "Cleaning..."
	@rm -rf bin/
	@rm -f coverage.out coverage.html

docker-up: ## Start all services with Docker Compose
	@echo "Starting Docker services..."
	@docker compose up -d

docker-down: ## Stop all services
	@echo "Stopping Docker services..."
	@docker compose down

docker-logs: ## Show Docker logs
	@docker compose logs -f

docker-build: ## Build Docker image
	@echo "Building Docker image..."
	@docker compose build

migrate-up: ## Run PostgreSQL migrations
	@echo "Running PostgreSQL migrations..."
	@psql -U postgres -d pathmind -f migrations/001_init_schema.sql

migrate-neo4j: ## Run Neo4j migrations
	@echo "Running Neo4j migrations..."
	@cypher-shell -u neo4j -p password123 -f migrations/002_neo4j_seed.cypher

deps: ## Download dependencies
	@echo "Downloading dependencies..."
	@go mod download

tidy: ## Tidy dependencies
	@echo "Tidying dependencies..."
	@go mod tidy

fmt: ## Format code
	@echo "Formatting code..."
	@go fmt ./...

lint: ## Run linter
	@echo "Running linter..."
	@golangci-lint run

dev: ## Run in development mode
	@echo "Running in development mode..."
	@air

install-tools: ## Install development tools
	@echo "Installing development tools..."
	@go install github.com/cosmtrek/air@latest
	@go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
