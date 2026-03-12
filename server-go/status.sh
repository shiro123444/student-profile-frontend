#!/bin/bash

# PathMind AI 服务状态检查

echo "📊 PathMind AI 服务状态"
echo "========================"

# 检查 Docker 服务
echo ""
echo "🐳 Docker 服务:"
docker compose ps

# 检查 Go 服务
echo ""
echo "🚀 Go 后端服务:"
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ 运行中 (http://localhost:3001)"
    echo ""
    echo "健康检查响应:"
    curl -s http://localhost:3001/health | jq .
else
    echo "❌ 未运行"
fi

echo ""
echo "📡 可用端点:"
echo "  - Health: http://localhost:3001/health"
echo "  - MBTI API: http://localhost:3001/api/mbti/types"
echo "  - Neo4j Browser: http://localhost:7474"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
