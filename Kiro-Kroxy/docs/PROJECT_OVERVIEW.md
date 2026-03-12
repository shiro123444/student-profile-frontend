# Kiro Proxy 项目概览

## 项目简介

Kiro Proxy 是一个 Kiro IDE API 的反向代理服务器，提供多账号管理、自动 Token 刷新、配额管理等功能。

## 核心特性

### 1. 多协议支持
- OpenAI API (Chat Completions / Responses)
- Anthropic API (Messages)
- Gemini API (Generate Content)

### 2. 账号管理
- 多账号轮询
- 会话粘性（60秒）
- 自动 Token 刷新
- 健康检查
- 配额管理

### 3. 智能特性
- 历史消息管理（截断/摘要/缓存）
- 请求限速
- 错误重试
- 账号封禁检测
- 自动账号切换

### 4. 用户界面
- Web UI（中英文）
- CLI 工具
- 启动器 UI
- 文档中心

### 5. 部署方式
- 直接运行
- 后台服务（开机自启）
- 预编译可执行文件

## 技术栈

- **后端**: FastAPI + uvicorn
- **前端**: 单文件 HTML + Vanilla JS
- **认证**: AWS SSO / OAuth 2.0 Device Flow
- **存储**: JSON 文件持久化
- **打包**: PyInstaller

## 架构设计

### 请求流程

```
客户端 (Claude Code/Codex/etc)
    ↓
FastAPI 路由
    ↓
协议处理器 (handlers/)
    ↓
账号选择 (state.py)
    ↓
历史消息处理 (history_manager.py)
    ↓
限速检查 (rate_limiter.py)
    ↓
Kiro API
    ↓
响应转换
    ↓
客户端
```

### 模块职责

- **core/** - 核心业务逻辑
  - 账号生命周期
  - 全局状态管理
  - 统计和监控
  - 后台任务调度

- **credential/** - 凭证管理
  - Token 存储和刷新
  - Machine ID 生成
  - 配额跟踪

- **handlers/** - 协议处理
  - 请求解析
  - 协议转换
  - 错误处理
  - 响应格式化

- **web/** - 用户界面
  - Web UI
  - 国际化
  - 静态资源

## 配置管理

### 配置文件位置

- Windows: `%LOCALAPPDATA%\KiroProxy\config.json`
- Linux: `~/.config/kiro-proxy/config.json`

### 配置结构

```json
{
  "accounts": [
    {
      "id": "xxx",
      "name": "Account 1",
      "credentials": {
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": "...",
        "profileArn": "...",
        "clientId": "..."
      },
      "enabled": true,
      "status": "active"
    }
  ],
  "history_config": {
    "enabled": true,
    "strategy": "auto_truncate",
    "max_messages": 50,
    "max_chars": 600000,
    "summary_enabled": true,
    "summary_cache_enabled": true
  },
  "rate_limit_config": {
    "enabled": true,
    "min_request_interval": 1.0,
    "max_requests_per_minute": 30,
    "global_max_requests_per_minute": 60
  }
}
```

## 安全考虑

### Token 安全
- Token 存储在本地配置文件
- 不上传到任何服务器
- 支持 Token 加密（可选）

### 网络安全
- 仅监听本地地址（0.0.0.0）
- 不暴露到公网
- 支持 HTTPS（可选）

### 隐私保护
- 不记录请求内容
- 流量监控可选
- 支持禁用日志

## 性能优化

### 缓存策略
- 摘要缓存（减少 LLM 调用）
- 会话粘性（减少账号切换）
- 连接复用

### 并发处理
- 异步 I/O (asyncio)
- 连接池
- 请求队列

### 资源管理
- 自动清理过期数据
- 限制日志大小
- 内存优化

## 扩展性

### 添加新协议
1. 在 `handlers/` 创建新处理器
2. 在 `main.py` 注册路由
3. 在 `converters.py` 添加转换逻辑

### 添加新功能
1. 在 `core/` 添加核心逻辑
2. 在 `handlers/admin.py` 添加 API
3. 在 `web/webui.py` 添加 UI

### 自定义配置
1. 在 `config.py` 定义配置项
2. 在 `persistence.py` 添加持久化
3. 在 Web UI 添加设置界面

## 测试策略

### 手动测试
- 启动服务
- 测试各个 API 端点
- 测试 Web UI
- 测试客户端集成

### 集成测试
- Claude Code
- Codex CLI
- Obsidian Copilot
- Cherry Studio

### 压力测试
- 并发请求
- 长时间运行
- 大量账号

## 部署建议

### 开发环境
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python run.py
```

### 生产环境
```bash
# 使用后台服务
python scripts/install_service.py

# 或使用预编译版本
./KiroProxy
```

### 服务器部署
- 使用 systemd 服务
- 配置自动重启
- 设置日志轮转
- 监控服务状态

## 故障排查

### 常见问题
1. **端口被占用** - 更改端口或停止占用进程
2. **Token 过期** - 重新登录或刷新 Token
3. **账号封禁** - 减少请求频率，启用限速
4. **依赖缺失** - 重新安装依赖

### 调试方法
1. 查看日志
2. 检查配置文件
3. 测试 API 端点
4. 使用 Web UI 监控

## 未来计划

- [ ] 单元测试
- [ ] Docker 支持
- [ ] 更多协议支持
- [ ] 插件系统
- [ ] 云端同步
- [ ] 团队协作功能

## 参考资源

- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [AWS SSO 文档](https://docs.aws.amazon.com/singlesignon/)
- [Anthropic API 文档](https://docs.anthropic.com/)
- [OpenAI API 文档](https://platform.openai.com/docs/)

## 社区

- GitHub Issues - 报告问题
- Pull Requests - 贡献代码
- Discussions - 讨论交流

---

最后更新: 2026-02-10
