#!/bin/bash

# PathMind AI Go Backend 启动脚本

echo "🚀 启动 PathMind AI Go 后端服务..."

# 检查 Docker 服务
echo "📦 检查 Docker 服务状态..."
if ! docker compose ps | grep -q "Up"; then
    echo "🔧 启动数据库服务..."
    docker compose up -d postgres neo4j redis
    echo "⏳ 等待数据库服务就绪..."
    sleep 10
else
    echo "✅ 数据库服务已运行"
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "📝 创建 .env 配置文件..."
    cp .env.example .env
fi

# 构建并运行 Go 服务
echo "🔨 构建 Go 应用..."
go build -o bin/server cmd/server/main.go

if [ $? -eq 0 ]; then
    echo "✅ 构建成功"
    echo "🌐 启动服务器 (http://localhost:3001)..."
    ./bin/server
else
    echo "❌ 构建失败"
    exit 1
fi
