# 贡献指南

感谢你对 Kiro Proxy 的关注！

## 项目结构

请先阅读 [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) 了解项目组织。

## 开发环境

```bash
# 克隆项目
git clone https://github.com/petehsu/KiroProxy.git
cd KiroProxy

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 运行
python run.py
```

## 代码规范

### Python 风格

- 遵循 PEP 8
- 使用类型提示（Type Hints）
- 函数和类添加文档字符串

### 模块组织

- 核心逻辑 → `kiro_proxy/core/`
- API 处理 → `kiro_proxy/handlers/`
- 工具脚本 → `scripts/`
- 文档 → `docs/`

### 提交信息

使用清晰的提交信息：

```
feat: 添加新功能
fix: 修复 bug
docs: 更新文档
refactor: 重构代码
test: 添加测试
chore: 构建/工具相关
```

## 添加新功能

1. **创建分支**
   ```bash
   git checkout -b feature/your-feature
   ```

2. **开发功能**
   - 在合适的模块中添加代码
   - 更新相关文档
   - 添加必要的注释

3. **测试**
   ```bash
   # 手动测试
   python run.py
   
   # 检查服务
   python scripts/check_service.py
   ```

4. **提交**
   ```bash
   git add .
   git commit -m "feat: 添加 XXX 功能"
   git push origin feature/your-feature
   ```

5. **创建 Pull Request**

## 技术架构细节

### 核心设计理念

本项目基于 FastAPI 构建，旨在提供高性能、高可用的 AI API 反向代理。核心设计借鉴了 [kiro.rs](https://github.com/hank9999/kiro.rs) 的 Rust 实现，并在 Python 中进行了优化移植。

### 关键技术实现

#### 1. 高性能网络层 (`core/http_pool.py`)
- **全局连接池**：复用 `httpx.AsyncClient`，减少 TCP/TLS 握手开销。
- **分级连接池**：
  - `api_client` (timeout=300s): 用于长连接的 LLM 流式响应。
  - `short_client` (timeout=60s): 用于图片下载等短任务。
  - `model_client` (timeout=30s): 用于模型列表查询。

#### 2. 流式响应处理 (`handlers/`)
- **SSE 规范修正**：修复 Anthropic 协议中缺失 `event:` 行的问题，确保 VS Code 客户端能正确解析流。
- **增量 JSON 解析**：实现 `ThinkingStreamParser` 和 `KiroStreamProcessor`，支持从碎片化的网络包中重组完整的 JSON 事件和 Thinking 标签。
- **防截断保护**：在处理流式 chunk 时，使用缓冲区处理跨包的 JSON 结构，防止多字节字符或 JSON 关键字被切断。

#### 3. 智能历史管理 (`core/history_manager.py`)
为了解决上下文长度限制，实现了多种策略：
- **Token 预估**：基于字符数 (3 chars/token) 快速预估。
- **工具内容截断**：优先截断历史中冗长的 `tool_result`，保留关键对话结构。
- **自动回退**：当 `summary` 失败时，自动降级为截断策略，并插入占位符保证历史格式合法。

#### 4. 协议转换 (`converters.py`)
- **Tool ID 生成**：Kiro 有时返回不带 ID 的工具调用，代理自动生成 `call_<uuid>` 并保持一致性。
- **JSON 完整性**：流式转发时确保工具参数 JSON 结构完整，防止客户端 `Expected ',' or '}'` 解析错误。
- **空参数处理**：将空的工具参数 `{}` 显式转换为字符串 `"{}"`，避免某些客户端崩溃。
- **模型名称映射**：自动处理连字符变体 (`claude-sonnet-4-5`)、日期后缀 (`-20241022`)、GPT/Gemini 别名 (`gpt-4o` → `claude-sonnet-4`)。

#### 5. 可靠性设计
- **稳定指纹**：移除 Machine ID 生成中的时间因子，使用固定盐值，防止账号因指纹变动被风控。
- **429 退避**：实现带 jitter 的指数退避重试，避免重试风暴。
- **Token 自动刷新**：后台调度器每 5 分钟检查，提前 15 分钟刷新即将过期的 Token。
- **CRC32 校验**：验证 AWS Event Stream 数据完整性，跳过损坏帧。

## 开发指南

### 添加新模型支持

1. 在 `kiro_proxy/config.py` 的 `MODEL_MAPPING` 中添加映射。
2. 如果是 Thinking 模型，在 `kiro_proxy/core/thinking.py` 中配置解析规则。

### 添加新 API 端点

1. 在 `handlers/` 下创建新的处理文件（如 `handlers/new_protocol.py`）。
2. 在 `main.py` 中注册路由。
3. 如果需要转换格式，在 `converters.py` 中添加转换函数。

### 调试

- 使用 `verify_opus.py` 测试上游 API 响应格式。
- 使用 `tools/capture_kiro.py` 抓取真实 Kiro API 流量分析协议差异。

### 文档维护

- 用户文档 → `docs/`
- 内置帮助 → `kiro_proxy/docs/zh/` 和 `kiro_proxy/docs/en/`
- API 文档 → README.md

更新功能时请同步更新文档。

## 测试

目前项目主要依赖手动测试：

1. 启动服务
2. 测试各个 API 端点
3. 测试 Web UI
4. 测试客户端集成（Claude Code, Codex CLI 等）

## 发布流程

1. 更新版本号（`kiro_proxy/main.py`）
2. 更新 README 和 CHANGELOG
3. 构建可执行文件：`python build.py`
4. 创建 GitHub Release
5. 上传构建产物

## 许可证

本项目采用 MIT 许可证。贡献代码即表示同意以相同许可证发布。

## 联系方式

- GitHub Issues: 报告问题和建议
- Pull Requests: 提交代码贡献

感谢你的贡献！🎉
