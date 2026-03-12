<p align="center">
  <img src="assets/icon.svg" width="80" height="96" alt="Kiro Proxy">
</p>

<h1 align="center">Kiro API Proxy</h1>

<p align="center">
  Kiro IDE API 反向代理服务器，支持多账号轮询、Token 自动刷新、配额管理
</p>

<p align="center">
  <a href="#功能特性">功能</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#后台服务">后台服务</a> •
  <a href="#客户端配置">客户端配置</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#许可证">许可证</a>
</p>

<p align="center">
  <strong>中文</strong> | <a href="README_EN.md">English</a>
</p>

---

> **⚠️ 测试说明**
> 
> 本项目支持 **Claude Code**、**Codex CLI**、**Gemini CLI**、**VS Code Copilot Chat (BYOK)** 四种客户端，流式响应与工具调用功能已全面支持。

## 功能特性

### 核心功能
- **多协议支持** - OpenAI / Anthropic / Gemini 三种协议兼容
- **完整工具调用** - 三种协议的工具调用功能全面支持
- **图片理解** - 支持 Claude Code / Codex CLI 图片输入
- **网络搜索** - 支持 Claude Code / Codex CLI 网络搜索工具
- **多账号轮询** - 支持添加多个 Kiro 账号，自动负载均衡
- **会话粘性** - 同一会话 60 秒内使用同一账号，保持上下文
- **Web UI** - 简洁的管理界面，支持监控、日志、设置
- **多语言界面** - 支持中文和英文界面切换

### v1.8.1 Anthropic SSE 流式修复 + OpenAI 工具调用 + 模型映射

#### 🔧 Anthropic SSE 流式响应修复
- **问题**：Claude Code (VSCode) 报错 `Stream completed without receiving message_start event`，流式响应后回退到非流式模式也失败
- **根因**：SSE 事件缺少 `event:` 行。Anthropic 协议要求每个 SSE 事件包含两行：`event: <type>` 和 `data: <json>`，代理只发送了 `data:` 行
- **修复**：所有 SSE 事件（`message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`、`error`）均添加标准 `event:` 前缀
- **额外**：添加 `event: ping` 心跳事件、`Cache-Control: no-cache` 和 `X-Accel-Buffering: no` 响应头防止代理/网关缓冲

#### 🛠️ OpenAI 工具调用完整支持
- **修复 `parse_event_stream_full`**：正确保留 `tool_uses` 数据，VS Code Copilot Chat (BYOK) 工具调用不再丢失
- **真正的流式 tool_calls**：实现 OpenAI 标准的 `delta.tool_calls` 流式格式，包括 `index`、`function.name`、`function.arguments` 分块传输
- **finish_reason 修正**：有工具调用时正确返回 `"tool_calls"` 而非 `"stop"`
- **token 用量**：从 Kiro 响应中提取真实 `input_tokens` / `output_tokens`，不再返回固定值
- **tool_call ID**：自动生成 `call_` 前缀的唯一 ID

#### 🗺️ 智能模型名称映射
- **连字符版本自动转换**：`claude-sonnet-4-5` → `claude-sonnet-4.5`（客户端可能发送连字符格式）
- **带日期后缀**：`claude-sonnet-4-5-20250929` → `claude-sonnet-4.5`（自动去除日期后缀）
- **GPT/Gemini 别名**：`gpt-4o` → `claude-sonnet-4`，`gpt-4o-mini` → `claude-haiku-4.5`，`o1` → `claude-opus-4.5`
- **简短别名**：`sonnet` → `claude-sonnet-4`，`haiku` → `claude-haiku-4.5`，`opus` → `claude-opus-4.5`

### v1.8.0 性能大幅优化（借鉴 kiro.rs 架构）

> 本次更新深入研究了 Rust 实现的 [kiro.rs](https://github.com/hank9999/kiro.rs) 项目架构，
> 将其核心性能设计理念移植到 Python 实现中，实现了全方位的性能与稳定性提升。

#### 🔗 1. 全局连接池复用（Connection Pool）
- **原理**：kiro.rs 使用 `reqwest::Client` 全局复用 TCP 连接和 TLS 会话，而旧版本每次请求都创建新的 `httpx.AsyncClient`，造成 TCP 三次握手 + TLS 协商的重复开销
- **改进**：创建三类全局连接池 — `api_client`（长超时 300s/50 连接，用于 LLM 流式）、`short_client`（60s/20 连接，用于图片下载等）、`model_client`（30s/10 连接，用于模型列表查询）
- **效果**：每次请求节省 100-300ms 连接建立时间，高并发下性能提升显著

#### ⚡ 2. 异步图片下载（Async Image Download）
- **原理**：旧版本使用 `httpx.get()` 同步下载图片 URL，会阻塞整个事件循环，导致其他请求被卡住
- **改进**：改为 `await http_pool.short_client.get()` 全异步下载，下载期间事件循环可继续处理其他请求
- **效果**：多用户同时发送含图片的请求时，吞吐量大幅提升

#### 🔑 3. 稳定 Machine ID 指纹（Stable Fingerprint）
- **原理**：kiro.rs 使用固定 `machine_id` 生成设备指纹；旧版本在哈希中掺入 `hour_slot` 时间因子，导致每小时指纹变化，可能触发 AWS 风控
- **改进**：移除时间因子，改用固定盐值 `kiro-proxy-stable-v1`，同一机器始终生成相同指纹
- **效果**：避免因指纹频繁更换触发异常检测，提高账号存活率

#### 🛡️ 4. 防雪崩重试机制（Anti-Avalanche Retry）
- **原理**：kiro.rs 使用带随机抖动的指数退避；旧版本所有重试在精确相同的时间点发起，高并发时形成"重试风暴"
- **改进**：① 将 HTTP 429（Too Many Requests）加入可重试状态码 ② 在每次重试等待时间上叠加 0-30% 的随机抖动
- **效果**：多账号同时触发限流时，重试请求自然错开，避免服务器过载

#### ✅ 5. CRC32 数据完整性校验（Data Integrity）
- **原理**：AWS Event Stream 协议每条消息头部包含 CRC32 前导校验和完整消息校验，kiro.rs 在解析时严格验证
- **改进**：在 `parse_response()` 中对每条消息计算 CRC32，与头部 prelude checksum 比对，不一致则跳过损坏帧
- **效果**：网络抖动导致数据损坏时不会返回乱码，提高输出可靠性

#### 💾 6. 统计数据持久化（Stats Persistence）
- **原理**：旧版本统计数据（请求数、Token 用量、错误率等）全部存在内存中，服务重启即丢失
- **改进**：每 30 秒自动保存到 `~/.kiro-proxy/stats.json`，启动时自动加载历史数据，关闭时强制保存
- **效果**：重启、更新、崩溃后统计数据不丢失，支持长期运营监控

#### 🔄 7. 账号自动恢复（Auto-Recovery）
- **原理**：kiro.rs 实现了 COOLDOWN 账号到期自动恢复；旧版本在所有账号都进入冷却时会返回错误，需手动重启
- **改进**：当所有账号不可用时，自动将 COOLDOWN 状态的账号通过 `quota_manager.restore()` 恢复为可用
- **效果**：7×24 小时无人值守运行，不会因全部账号冷却而服务中断

---

### v1.7.3 新功能
- **Enterprise 账号支持** - 完整支持 Enterprise SSO (IdC) 账号导入与管理
- **多格式导入** - 支持标准格式、扁平单账号、扁平数组三种 JSON 导入格式
- **Enterprise/BuilderId 区分** - WebUI 中清晰区分 Enterprise（黄色）/ BuilderId（蓝色）/ Social（绿色）
- **Claude Opus 4.6** - 新增 `claude-opus-4.6` 模型支持
- **自定义模型管理** - WebUI 设置页新增自定义模型管理，可快速添加/删除新模型（如 opus-5.0、sonnet-5.0）
- **CLI 导入修复** - 修复 CLI 导入时丢失 clientId/clientSecret/startUrl 的问题

### v1.7.2 新功能
- **多语言支持** - WebUI 完整支持中英文切换
- **双语启动器** - 端口/语言设置，清晰的启动按钮
- **英文帮助文档** - 全部 5 篇文档已翻译为英文

### v1.7.1 新功能
- **Windows 支持补强** - 注册表浏览器检测 + PATH 回退，兼容便携版
- **打包资源修复** - PyInstaller 打包后可正常加载图标与内置文档
- **Token 扫描稳定性** - Windows 路径编码处理修复

### v1.6.3 新功能
- **命令行工具 (CLI)** - 无 GUI 服务器也能轻松管理
  - `python run.py accounts list` - 列出账号
  - `python run.py accounts export/import` - 导出/导入账号
  - `python run.py accounts add` - 交互式添加 Token
  - `python run.py accounts scan` - 扫描本地 Token
  - `python run.py login google/github` - 命令行登录
  - `python run.py login remote` - 生成远程登录链接
- **远程登录链接** - 在有浏览器的机器上完成授权，Token 自动同步
- **账号导入导出** - 跨机器迁移账号配置
- **手动添加 Token** - 直接粘贴 accessToken/refreshToken

### v1.6.2 新功能
- **Codex CLI 完整支持** - 使用 OpenAI Responses API (`/v1/responses`)
  - 完整工具调用支持（shell、file 等所有工具）
  - 图片输入支持（`input_image` 类型）
  - 网络搜索支持（`web_search` 工具）
  - 错误代码映射（rate_limit、context_length 等）
- **Claude Code 增强** - 图片理解和网络搜索完整支持
  - 支持 Anthropic 和 OpenAI 两种图片格式
  - 支持 `web_search` / `web_search_20250305` 工具

### v1.6.1 新功能
- **请求限速** - 通过限制请求频率降低账号封禁风险
  - 每账号最小请求间隔
  - 每账号每分钟最大请求数
  - 全局每分钟最大请求数
  - WebUI 设置页面可配置
- **账号封禁检测** - 自动检测 TEMPORARILY_SUSPENDED 错误
  - 友好的错误日志输出
  - 自动禁用被封禁账号
  - 自动切换到其他可用账号
- **统一错误处理** - 三种协议使用统一的错误分类和处理

### v1.6.0 功能
- **历史消息管理** - 4 种策略处理对话长度限制，可自由组合
  - 自动截断：发送前优先保留最新上下文并摘要前文，必要时按数量/字符数截断
  - 智能摘要：用 AI 生成早期对话摘要，保留关键信息
  - 摘要缓存：历史变化不大时复用最近摘要，减少重复 LLM 调用（默认启用）
  - 错误重试：遇到长度错误时自动截断重试（默认启用）
  - 预估检测：预估 token 数量，超限预先截断
- **Gemini 工具调用** - 完整支持 functionDeclarations/functionCall/functionResponse
- **设置页面** - WebUI 新增设置标签页，可配置历史消息管理策略

### v1.5.0 功能
- **用量查询** - 查询账号配额使用情况，显示已用/余额/使用率
- **多登录方式** - 支持 Google / GitHub / AWS Builder ID 三种登录方式
- **流量监控** - 完整的 LLM 请求监控，支持搜索、过滤、导出
- **浏览器选择** - 自动检测已安装浏览器，支持无痕模式
- **文档中心** - 内置帮助文档，左侧目录 + 右侧 Markdown 渲染

### v1.4.0 功能
- **Token 预刷新** - 后台每 5 分钟检查，提前 15 分钟自动刷新
- **健康检查** - 每 10 分钟检测账号可用性，自动标记状态
- **请求统计增强** - 按账号/模型统计，24 小时趋势
- **请求重试机制** - 网络错误/5xx 自动重试，指数退避

## 工具调用支持

| 功能 | Anthropic (Claude Code) | OpenAI (Codex CLI / Copilot) | Gemini |
|------|------------------------|-------------------|--------|
| 工具定义 | ✅ `tools` | ✅ `tools.function` | ✅ `functionDeclarations` |
| 工具调用响应 | ✅ `tool_use` | ✅ `tool_calls` | ✅ `functionCall` |
| 工具结果 | ✅ `tool_result` | ✅ `tool` 角色消息 | ✅ `functionResponse` |
| 强制工具调用 | ✅ `tool_choice` | ✅ `tool_choice` | ✅ `toolConfig.mode` |
| 流式响应 | ✅ SSE (`event:` + `data:`) | ✅ SSE (`data:`) | ❌ |
| 流式工具调用 | ✅ `content_block_delta` | ✅ `delta.tool_calls` | ❌ |
| 工具数量限制 | ✅ 50 个 | ✅ 50 个 | ✅ 50 个 |
| 历史消息修复 | ✅ | ✅ | ✅ |
| 图片理解 | ✅ | ✅ | ❌ |
| 网络搜索 | ✅ | ✅ | ❌ |

## 已知限制

### 对话长度限制

Kiro API 有输入长度限制。当对话历史过长时，会返回错误：

```
Input is too long. (CONTENT_LENGTH_EXCEEDS_THRESHOLD)
```

#### 自动处理（v1.6.0+）

代理内置了历史消息管理功能，可在「设置」页面配置：

- **错误重试**（默认）：遇到长度错误时自动截断并重试
- **智能摘要**：用 AI 生成早期对话摘要，保留关键信息
- **摘要缓存**（默认）：历史变化不大时复用最近摘要，减少重复 LLM 调用
- **自动截断**：每次请求前优先保留最新上下文并摘要前文，必要时按数量/字符数截断
- **预估检测**：预估 token 数量，超限预先截断

摘要缓存可通过以下配置项调整（默认值）：
- `summary_cache_enabled`: `true`
- `summary_cache_min_delta_messages`: `3`
- `summary_cache_min_delta_chars`: `4000`
- `summary_cache_max_age_seconds`: `180`

#### 手动处理

1. 在 Claude Code 中输入 `/clear` 清空对话历史
2. 告诉 AI 你之前在做什么，它会读取代码文件恢复上下文

## 快速开始

> 💡 **推荐使用后台服务**：安装为系统服务后可开机自启、后台运行，详见 [后台服务](#后台服务) 章节。

### 方式一：下载预编译版本（推荐）

从 [Releases](../../releases) 下载对应平台的安装包，解压后直接运行。

### 方式二：从源码运行

```bash
# 克隆项目
git clone https://github.com/petehsu/KiroProxy.git
cd KiroProxy

# 创建虚拟环境（推荐）
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 运行（会弹出端口配置界面）
python run.py

# 或直接指定端口
python run.py 8081

# 或跳过 UI 直接启动
python run.py --no-ui 8080
```

启动后访问 http://localhost:8080

### 添加账号

**方式一：在线登录（推荐）**
1. 打开 Web UI，点击「在线登录」
2. 选择登录方式：Google / GitHub / AWS Builder ID
3. 在浏览器中完成授权
4. 账号自动添加

**方式二：扫描本地 Token**
1. 如果已在 Kiro IDE 登录，Token 保存在 `~/.aws/sso/cache/`
2. 在 Web UI 点击「扫描 Token」或运行：
   ```bash
   python run.py accounts scan --auto
   ```

**方式三：手动添加**
```bash
python run.py accounts add
```

---

## 后台服务

将 Kiro Proxy 安装为系统服务，实现开机自启和后台运行。

### 快速安装

**Windows（需要管理员权限）**
```cmd
# 以管理员身份运行 CMD 或 PowerShell
cd E:\shiro\KiroProxy
python scripts\install_service.py
```

**Linux（需要 sudo）**
```bash
cd /path/to/KiroProxy
sudo python3 scripts/install_service.py
```

### 功能特性

- ✅ **开机自动启动** - 无需手动运行
- ✅ **后台运行** - 无窗口，不占用终端
- ✅ **虚拟环境支持** - 自动检测并使用 venv
- ✅ **依赖检查** - 安装前自动验证
- ✅ **持久运行** - 关闭终端不影响服务

### 管理命令

**Windows**
```cmd
# 检查状态
python scripts\check_service.py

# 立即启动
schtasks /Run /TN KiroProxyService

# 卸载服务
python scripts\uninstall_service.py
```

**Linux**
```bash
# 检查状态
python3 scripts/check_service.py

# 启动/停止/重启
sudo systemctl start kiro-proxy
sudo systemctl stop kiro-proxy
sudo systemctl restart kiro-proxy

# 查看日志
sudo journalctl -u kiro-proxy -f

# 卸载服务
sudo python3 scripts/uninstall_service.py
```

### 详细文档

- [docs/SERVICE_GUIDE.md](docs/SERVICE_GUIDE.md) - 完整服务管理指南
- [docs/QUICK_START_SERVICE.md](docs/QUICK_START_SERVICE.md) - 快速开始和故障排查

---

## 客户端配置

## 客户端配置

### 模型对照表

| Kiro 模型 | 能力 | Claude Code | Codex CLI / OpenAI | 别名 |
|-----------|------|-------------|-----------|------|
| `claude-sonnet-4` | ⭐⭐⭐ 推荐 | `claude-sonnet-4` | `gpt-4o` | `sonnet` |
| `claude-sonnet-4.5` | ⭐⭐⭐⭐ 更强 | `claude-sonnet-4.5` | `gpt-4o` | `claude-sonnet-4-5` |
| `claude-haiku-4.5` | ⚡ 快速 | `claude-haiku-4.5` | `gpt-4o-mini` | `haiku` |
| `claude-opus-4.5` | ⭐⭐⭐⭐⭐ 最强 | `claude-opus-4.5` | `o1` | `opus` |
| `claude-opus-4.6` | ⭐⭐⭐⭐⭐ 最新 | `claude-opus-4.6` | `o1` | `opus-4.6` |

> **智能模型映射**：客户端发送的模型名会自动映射，支持连字符格式 (`claude-sonnet-4-5`)、带日期后缀 (`claude-sonnet-4-5-20250929`)、GPT/Gemini 别名、简短别名等。

### Claude Code

```
名称: Kiro Proxy
API Key: any
Base URL: http://localhost:8080
模型: claude-sonnet-4
```

### Codex CLI

```bash
# 设置环境变量
export OPENAI_API_KEY=any
export OPENAI_BASE_URL=http://localhost:8080/v1

# 运行
codex
```

或在 `~/.codex/config.toml` 中配置：

```toml
[providers.openai]
api_key = "any"
base_url = "http://localhost:8080/v1"
```

### Obsidian Copilot

在 Copilot 设置中：

```
Provider: OpenAI
API Key: any
Base URL: http://localhost:8080
Model: gpt-4o
```

### Cherry Studio

```
Provider: OpenAI
API Key: any
Base URL: http://localhost:8080/v1
Model: gpt-4o
```

---

## 命令行工具 (CLI)

无 GUI 环境下使用 CLI 管理：

```bash
# 账号管理
python run.py accounts list                    # 列出所有账号
python run.py accounts export -o accounts.json # 导出账号配置
python run.py accounts import accounts.json    # 导入账号配置
python run.py accounts add                     # 交互式添加 Token
python run.py accounts scan --auto             # 扫描并自动添加本地 Token

# 登录
python run.py login google                     # Google 登录
python run.py login github                     # GitHub 登录
python run.py login remote --host server:8080  # 生成远程登录链接

# 服务管理
python run.py serve                            # 启动服务 (默认 8080)
python run.py serve -p 8081                    # 指定端口
python run.py status                           # 查看状态
```

---

## API 端点

### 客户端 API

| 协议 | 端点 | 用途 |
|------|------|------|
| OpenAI | `POST /v1/chat/completions` | Chat Completions API |
| OpenAI | `POST /chat/completions` | 兼容不带 /v1 前缀 |
| OpenAI | `POST /v1/responses` | Responses API (Codex CLI) |
| OpenAI | `GET /v1/models` | 模型列表 |
| Anthropic | `POST /v1/messages` | Claude Code |
| Anthropic | `POST /v1/messages/count_tokens` | Token 计数 |
| Gemini | `POST /v1/models/{model}:generateContent` | Gemini CLI |

### 管理 API

完整 API 文档请访问 Web UI 的「文档」标签页，或查看 [docs/04-api.md](kiro_proxy/docs/04-api.md)

---

## 项目结构

```
KiroProxy/
├── run.py                     # 主启动脚本
├── requirements.txt           # Python 依赖
├── build.py                   # PyInstaller 构建脚本
│
├── scripts/                   # 工具脚本
│   ├── install_service.py    # 服务安装脚本
│   ├── uninstall_service.py  # 服务卸载脚本
│   └── check_service.py      # 服务状态检查
│
├── docs/                      # 文档
│   ├── SERVICE_GUIDE.md      # 服务管理完整指南
│   ├── QUICK_START_SERVICE.md # 服务快速开始
│   ├── CAPTURE_GUIDE.md      # 抓包指南
│   └── PROJECT_OVERVIEW.md   # 项目概览
│
├── tests/                     # 测试文件
│   ├── test_kiro_proxy.py    # 主程序测试
│   └── test_proxy.py         # 代理测试
│
├── tools/                     # 开发工具
│   ├── capture_kiro.py       # 请求抓取工具
│   ├── get_models.py         # 模型列表获取
│   └── proxy_server.py       # 测试代理服务器
│
├── kiro_proxy/                # 主程序包
│   ├── main.py               # FastAPI 应用入口
│   ├── config.py             # 全局配置
│   ├── converters.py         # 协议转换
│   ├── cli.py                # 命令行工具
│   ├── launcher.py           # 启动器 UI
│   │
│   ├── core/                 # 核心模块
│   │   ├── account.py       # 账号管理
│   │   ├── state.py         # 全局状态
│   │   ├── persistence.py   # 配置持久化
│   │   ├── scheduler.py     # 后台任务调度
│   │   ├── stats.py         # 请求统计
│   │   ├── retry.py         # 重试机制
│   │   ├── browser.py       # 浏览器检测
│   │   ├── flow_monitor.py  # 流量监控
│   │   ├── history_manager.py # 历史消息管理
│   │   ├── rate_limiter.py  # 请求限速
│   │   └── usage.py         # 用量查询
│   │
│   ├── credential/           # 凭证管理
│   │   ├── types.py         # KiroCredentials
│   │   ├── fingerprint.py   # Machine ID 生成
│   │   ├── quota.py         # 配额管理器
│   │   └── refresher.py     # Token 刷新
│   │
│   ├── auth/                 # 认证模块
│   │   └── device_flow.py   # Device Code Flow / Social Auth
│   │
│   ├── handlers/             # API 处理器
│   │   ├── anthropic.py     # /v1/messages
│   │   ├── openai.py        # /v1/chat/completions
│   │   ├── responses.py     # /v1/responses (Codex CLI)
│   │   ├── gemini.py        # /v1/models/{model}:generateContent
│   │   └── admin.py         # 管理 API
│   │
│   ├── web/                  # Web UI
│   │   ├── webui.py         # 单文件组件化 UI
│   │   ├── i18n.py          # 国际化
│   │   └── i18n/            # 语言文件
│   │       ├── zh.json
│   │       └── en.json
│   │
│   └── docs/                 # 内置文档
│       ├── zh/              # 中文文档
│       └── en/              # 英文文档
│
└── assets/                   # 资源文件
    └── icon.*               # 应用图标
```

### 核心模块说明

- **core/** - 核心业务逻辑
  - `account.py` - 账号生命周期管理、Token 刷新、状态跟踪
  - `state.py` - 全局状态管理、账号轮询、会话粘性
  - `history_manager.py` - 历史消息截断、智能摘要、缓存
  - `rate_limiter.py` - 请求限速、配额保护
  - `flow_monitor.py` - 完整请求监控、搜索过滤

- **credential/** - 凭证和认证
  - `types.py` - KiroCredentials 数据结构
  - `fingerprint.py` - 动态 Machine ID 生成
  - `refresher.py` - Token 自动刷新逻辑

- **handlers/** - 协议处理
  - 每个文件处理一种协议的请求
  - 统一的错误处理和重试机制
  - 自动账号切换和降级

- **web/** - Web 界面
  - 单文件组件化设计
  - 完整的国际化支持
  - 响应式布局

- **tests/** - 测试文件
  - 单元测试
  - 集成测试

- **tools/** - 开发工具
  - 请求抓取和分析
  - 调试辅助工具

---

## 构建

```bash
# 安装构建依赖
pip install pyinstaller

# 构建可执行文件
python build.py

# 输出在 dist/ 目录
```

---

## 免责声明

本项目仅供学习研究，禁止商用。使用本项目产生的任何后果由使用者自行承担，与作者无关。

本项目与 Kiro / AWS / Anthropic 官方无关。

---

## 项目更新与维护

### 更新到最新版本

#### 从源码运行的用户

```bash
# 1. 进入项目目录
cd KiroProxy

# 2. 停止正在运行的服务
# 如果是前台运行，按 Ctrl+C
# 如果是后台服务，参考下方"后台服务更新"

# 3. 备份配置（可选但推荐）
cp -r ~/.kiro-proxy ~/.kiro-proxy.backup

# 4. 拉取最新代码
git pull origin main

# 5. 更新依赖
# 如果使用虚拟环境
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt --upgrade

# 6. 重启服务
python run.py
```

#### 后台服务更新

**Windows**
```cmd
# 1. 停止服务
schtasks /End /TN KiroProxyService

# 2. 更新代码和依赖（同上）
cd E:\shiro\KiroProxy
git pull origin main
venv\Scripts\activate
pip install -r requirements.txt --upgrade

# 3. 重新安装服务（会自动覆盖）
python scripts\install_service.py

# 4. 启动服务
schtasks /Run /TN KiroProxyService
```

**Linux**
```bash
# 1. 停止服务
sudo systemctl stop kiro-proxy

# 2. 更新代码和依赖
cd /path/to/KiroProxy
git pull origin main
source venv/bin/activate
pip install -r requirements.txt --upgrade

# 3. 重启服务
sudo systemctl restart kiro-proxy

# 4. 查看状态
sudo systemctl status kiro-proxy
```

### 重要更新说明

#### v1.7.x → 最新版本

**新增功能**：
- ✅ 手动添加 Token 支持 AWS BuilderId (IdC) 认证
  - 需要提供 `clientId` 和 `clientSecret` 才能刷新 Token
  - Web UI 新增认证方式选择
- ✅ 多语言支持和双语启动器
- ✅ Windows 兼容性增强

**配置兼容性**：
- ✅ 账号配置完全兼容，无需重新添加
- ✅ 旧版本手动添加的 BuilderId 账号可能无法刷新（缺少 clientId/clientSecret）
  - 解决方案：删除后重新添加，或使用「在线登录」/「扫描 Token」

**数据迁移**：
- 无需手动迁移，配置文件自动兼容

#### v1.6.x → v1.7.x

**新增功能**：
- ✅ 历史消息管理（4 种策略）
- ✅ 请求限速和账号封禁检测
- ✅ 用量查询和流量监控

**配置兼容性**：
- ✅ 完全向后兼容
- ✅ 新增配置项有默认值

### 服务器部署注意事项

#### 首次部署

```bash
# 1. 克隆项目
git clone https://github.com/petehsu/KiroProxy.git
cd KiroProxy

# 2. 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 添加账号（使用 CLI）
python run.py accounts add
# 或导入已有配置
python run.py accounts import accounts.json

# 5. 安装为系统服务
sudo python3 scripts/install_service.py

# 6. 启动服务
sudo systemctl start kiro-proxy
```

#### 更新已部署的服务

```bash
# 1. 停止服务
sudo systemctl stop kiro-proxy

# 2. 备份配置
cp -r ~/.kiro-proxy ~/.kiro-proxy.backup

# 3. 拉取最新代码
cd /path/to/KiroProxy
git pull origin main

# 4. 激活虚拟环境并更新依赖
source venv/bin/activate
pip install -r requirements.txt --upgrade

# 5. 检查配置文件
python run.py status

# 6. 重启服务
sudo systemctl restart kiro-proxy

# 7. 验证服务状态
sudo systemctl status kiro-proxy
sudo journalctl -u kiro-proxy -f
```

#### 回滚到旧版本

```bash
# 1. 停止服务
sudo systemctl stop kiro-proxy

# 2. 回滚代码
cd /path/to/KiroProxy
git log --oneline  # 查看提交历史
git checkout <commit-hash>  # 回滚到指定版本

# 3. 恢复依赖
source venv/bin/activate
pip install -r requirements.txt --force-reinstall

# 4. 恢复配置（如果需要）
cp -r ~/.kiro-proxy.backup ~/.kiro-proxy

# 5. 重启服务
sudo systemctl restart kiro-proxy
```

### 配置文件位置

| 配置项 | 路径 | 说明 |
|-------|------|------|
| 账号配置 | `~/.kiro-proxy/config.json` | 账号列表和设置 |
| Token 文件 | `~/.aws/sso/cache/*.json` | Kiro 凭证文件 |
| 服务配置 (Windows) | 任务计划程序 | `KiroProxyService` |
| 服务配置 (Linux) | `/etc/systemd/system/kiro-proxy.service` | systemd 服务文件 |

### 常见问题

#### Q: 更新后账号无法刷新 Token？

**A**: 如果是手动添加的 AWS BuilderId 账号，可能缺少 `clientId` 和 `clientSecret`。

解决方案：
1. 删除旧账号
2. 使用「在线登录」或「扫描 Token」重新添加
3. 或在「手动添加」时选择「AWS BuilderId (IdC)」并填写完整信息

#### Q: 更新后服务无法启动？

**A**: 检查以下几点：
1. 依赖是否正确安装：`pip list | grep -E "fastapi|httpx|uvicorn"`
2. 虚拟环境是否激活：`which python`
3. 配置文件是否损坏：`cat ~/.kiro-proxy/config.json`
4. 查看错误日志：`sudo journalctl -u kiro-proxy -n 50`

#### Q: 如何在不停服的情况下更新？

**A**: 使用蓝绿部署：
1. 在另一个端口启动新版本：`python run.py --no-ui 8081`
2. 测试新版本功能
3. 确认无误后停止旧版本，切换端口
4. 更新客户端配置指向新端口

#### Q: 更新后配置丢失？

**A**: 配置文件在 `~/.kiro-proxy/` 目录，不会被 `git pull` 覆盖。如果丢失：
1. 恢复备份：`cp -r ~/.kiro-proxy.backup ~/.kiro-proxy`
2. 或重新导入：`python run.py accounts import accounts.json`

### 开发者指南

#### 本地开发

```bash
# 1. Fork 并克隆项目
git clone https://github.com/your-username/KiroProxy.git
cd KiroProxy

# 2. 创建开发分支
git checkout -b feature/your-feature

# 3. 安装开发依赖
pip install -r requirements.txt
pip install pytest pytest-asyncio

# 4. 运行测试
pytest tests/

# 5. 提交更改
git add .
git commit -m "feat: your feature description"
git push origin feature/your-feature
```

#### 代码规范

- 使用 Python 3.8+ 特性
- 遵循 PEP 8 代码风格
- 添加类型注解
- 编写单元测试
- 更新相关文档

---

## 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本更新历史。

## 贡献

欢迎贡献代码！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

## 许可证

MIT License
