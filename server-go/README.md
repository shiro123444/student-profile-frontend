# PathMind AI - Go Backend Server

高性能 Go 微服务后端，用于 PathMind AI 学生画像与学习路径推荐系统。

## 技术栈

- **框架**: Gin Web Framework
- **数据库**:
  - PostgreSQL (关系型数据存储)
  - Neo4j (知识图谱)
  - Redis (缓存层)
- **认证**: JWT + Casbin (RBAC)
- **日志**: Zap
- **配置**: Viper + godotenv

## 项目结构

```
server-go/
├── cmd/
│   └── server/          # 应用入口
├── internal/
│   ├── config/          # 配置管理
│   ├── database/        # 数据库连接
│   ├── handler/         # HTTP 处理器
│   ├── middleware/      # 中间件 (认证、CORS、日志)
│   ├── models/          # 数据模型
│   ├── repository/      # 数据访问层
│   │   ├── postgres/    # PostgreSQL 仓储
│   │   ├── neo4j/       # Neo4j 图数据库仓储
│   │   └── redis/       # Redis 缓存仓储
│   ├── service/         # 业务逻辑层
│   └── utils/           # 工具函数
├── migrations/          # 数据库迁移脚本
├── docker-compose.yml   # Docker 编排
├── Makefile            # 构建脚本
└── .env.example        # 环境变量示例

```

## 快速开始

### 1. 环境准备

确保已安装：
- Go 1.21+
- Docker & Docker Compose
- PostgreSQL 15+
- Neo4j 5.x
- Redis 7+

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库连接信息
```

### 3. 启动依赖服务

```bash
# 使用 Docker Compose 启动所有依赖
make docker-up

# 或手动启动
docker-compose up -d
```

### 4. 运行数据库迁移

```bash
# PostgreSQL 迁移
make migrate-up

# Neo4j 初始化
make migrate-neo4j
```

### 5. 启动服务

```bash
# 开发模式
make run

# 或构建后运行
make build
./bin/server
```

服务将在 `http://localhost:3001` 启动

## 可用命令

```bash
make help           # 显示所有可用命令
make build          # 构建应用
make run            # 运行应用
make test           # 运行测试
make test-coverage  # 运行测试并生成覆盖率报告
make clean          # 清理构建产物
make docker-up      # 启动 Docker 服务
make docker-down    # 停止 Docker 服务
make docker-logs    # 查看 Docker 日志
make fmt            # 格式化代码
make lint           # 运行代码检查
make deps           # 下载依赖
make tidy           # 整理依赖
```

## API 端点

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/refresh` - 刷新 Token

### 学生管理
- `GET /api/students` - 获取学生列表
- `GET /api/students/:id` - 获取学生详情
- `POST /api/students` - 创建学生
- `PUT /api/students/:id` - 更新学生信息
- `DELETE /api/students/:id` - 删除学生

### 学生画像
- `GET /api/students/:id/profile` - 获取学生画像
- `PUT /api/students/:id/profile` - 更新学生画像
- `GET /api/students/:id/learning-style` - 获取学习风格
- `GET /api/students/:id/knowledge-map` - 获取知识图谱

### 实验管理
- `GET /api/experiments` - 获取实验列表
- `GET /api/experiments/:id` - 获取实验详情
- `POST /api/experiments` - 创建实验
- `PUT /api/experiments/:id` - 更新实验
- `POST /api/experiments/:id/assign` - 分配实验

### MBTI & 职业推荐
- `POST /api/mbti/analyze` - MBTI 分析
- `GET /api/mbti/careers` - 获取职业推荐
- `GET /api/mbti/learning-paths` - 获取学习路径

### 知识图谱
- `GET /api/graph` - 获取完整知识图谱
- `GET /api/graph/node/:id` - 获取节点详情
- `GET /api/graph/path` - 查找学习路径

## 核心功能

### 1. 学生画像系统
- 多维度数据采集（学习行为、成绩、互动）
- 实时画像更新
- 学习风格分析
- 知识掌握度追踪

### 2. 权限管理
- 基于 Casbin 的 RBAC
- 多角色支持（学生、教师、管理员）
- 细粒度权限控制

### 3. 实验管理
- 实验创建与分配
- 进度追踪
- 成绩管理
- 数据分析

### 4. 知识图谱
- Neo4j 图数据库
- 知识点关联
- 学习路径推荐
- 前置知识检测

### 5. 缓存优化
- Redis 多级缓存
- 热点数据预加载
- 缓存失效策略

## 性能指标

- QPS: 10,000+
- 平均响应时间: < 50ms
- 内存占用: ~100MB
- 并发连接: 10,000+

## 开发指南

### 添加新的 API 端点

1. 在 `internal/models` 定义数据模型
2. 在 `internal/repository` 实现数据访问
3. 在 `internal/service` 实现业务逻辑
4. 在 `internal/handler` 实现 HTTP 处理器
5. 在 `cmd/server/main.go` 注册路由

### 数据库迁移

PostgreSQL 迁移文件放在 `migrations/` 目录：
```sql
-- migrations/003_add_new_table.sql
CREATE TABLE new_table (
    id SERIAL PRIMARY KEY,
    ...
);
```

Neo4j 迁移使用 Cypher 脚本：
```cypher
// migrations/004_add_constraints.cypher
CREATE CONSTRAINT unique_node_id IF NOT EXISTS
FOR (n:Node) REQUIRE n.id IS UNIQUE;
```

## 部署

### Docker 部署

```bash
# 构建镜像
docker build -t pathmind-server:latest .

# 运行容器
docker run -d \
  --name pathmind-server \
  -p 3001:3001 \
  --env-file .env \
  pathmind-server:latest
```

### 生产环境配置

1. 设置 `GIN_MODE=release`
2. 配置生产数据库连接
3. 启用 HTTPS
4. 配置日志级别为 `info` 或 `warn`
5. 设置强密码和 JWT Secret

## 监控与日志

- 日志文件: `./logs/app.log`
- 日志级别: debug, info, warn, error
- 结构化日志 (JSON 格式)

## 故障排查

### 数据库连接失败
```bash
# 检查数据库服务状态
docker-compose ps

# 查看日志
docker-compose logs postgres
docker-compose logs neo4j
docker-compose logs redis
```

### 端口冲突
修改 `.env` 中的 `PORT` 配置

### 依赖问题
```bash
make clean
make deps
make tidy
make build
```

## 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

MIT License

## 联系方式

项目链接: [PathMind AI](https://github.com/yourusername/PathMind-AI)
