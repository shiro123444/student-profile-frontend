# PathMind AI → Claude Code Web 版完善计划

## 执行摘要

**当前状态**: 已实现 WebAgent 控制台（75-80% Claude Agent SDK 特性利用率）
**目标**: 完整 Claude Code Web 版 — 支持通用代码工作流 + 完善协议支持
**核心差距**: 缺少文件操作/Git/Shell 工具链 + 外部 MCP 生态未打通
**预计工作量**: 3-4 周（分 4 个 Phase）

---

## 一、现状评估

### 1.1 已用到的 Claude Agent SDK 核心特性 ✅

| 特性 | 使用情况 | 代码位置 |
|------|---------|---------|
| MCP Server 集成 | ✅ 24 个内部工具 | `server-py/app/mcp_tools/server.py` |
| 工具白名单过滤 | ✅ 按 agent 角色过滤 | `server-py/app/agents/registry.py:filter_tools_for_agent()` |
| Hooks 事件流 | ✅ Permission/Subagent/Notification | `server-py/app/engines/claude_engine.py:_handle_hooks()` |
| 会话恢复 (resume) | ✅ 支持断点续传 | `server-py/app/engines/claude_engine.py:run()` |
| 结构化输出 | ✅ output_format 参数 | `server-py/app/engines/claude_engine.py:run()` |
| 复杂编排 | ✅ DAG + Critique + Replan | `server-py/app/agents/__init__.py` |
| 双引擎路由 | ✅ Claude + OpenAI-compatible | `server-py/app/engines/` |
| SSE 流式输出 | ✅ 前端实时事件流 | `server-go/internal/handler/agent_handler.go` |

### 1.2 "本地 coding 工具 web 化" 程度分析

#### 已实现（WebAgent 控制台级别）
- ✅ 策略切换（Fast/Balanced/Deep）
- ✅ 事件流可视化（工具调用、思考过程、错误）
- ✅ 统计反馈（token 消耗、工具使用次数、耗时）
- ✅ 会话管理（历史记录、恢复）

#### 未实现（Claude Code 核心工作流）
- ❌ 文件系统操作（读/写/编辑/搜索）
- ❌ Git 工作流（commit/push/branch/diff）
- ❌ Shell 命令执行（带安全沙箱）
- ❌ 代码补丁生成与应用
- ❌ 多文件协同编辑
- ❌ 代码审查流程（approval hooks）

**结论**: 当前是"教学/实验型 WebAgent"，工具偏向业务逻辑（学生画像、MBTI、笔记），缺少通用开发工具链。

### 1.3 协议/接口支持评估

#### 已支持 ✅
- MCP stdio/sse/http 三种传输（内部工具）
- OpenAI function calling 适配
- SSE 前端流式传输
- Go ↔ Python HTTP 代理

#### 部分支持 ⚠️
- 外部 MCP servers 默认关闭（需手动开启）
- 只覆盖 MCP 三种传输，未测试 WebSocket
- 缺少 MCP server 动态发现机制

#### 未支持 ❌
- Anthropic Computer Use API（屏幕控制）
- 代码执行沙箱（Docker/Firecracker）
- 文件系统权限隔离
- Git 操作审批流

**结论**: 协议支持面很强（80%），但不算"完美支持所有协议"，且安全隔离机制缺失。

---

## 二、差距分析与优先级

### 2.1 核心差距矩阵

| 差距项 | 影响范围 | 优先级 | 工作量 |
|--------|---------|--------|--------|
| 文件操作工具链 | 阻塞代码编辑场景 | P0 | 3 天 |
| Git 工作流 | 阻塞版本管理场景 | P0 | 2 天 |
| Shell 命令执行 | 阻塞构建/测试场景 | P1 | 2 天 |
| 外部 MCP 生态打通 | 限制工具扩展性 | P1 | 3 天 |
| 代码审查流程 | 影响协作体验 | P2 | 2 天 |
| 安全沙箱 | 生产环境必需 | P2 | 5 天 |
| Computer Use API | 高级自动化场景 | P3 | 7 天 |

### 2.2 技术债务清单

1. **工具定义分散**: 24 个工具硬编码在 `mcp_tools/server.py`，缺少插件化机制
2. **权限模型简陋**: 只有工具白名单，无细粒度权限控制（如文件路径限制）
3. **外部 MCP 配置复杂**: 需手动编辑 `config.py`，无 UI 管理界面
4. **统计数据未持久化**: 每次会话结束后统计丢失
5. **策略模板前端硬编码**: 无法动态调整或共享策略配置

---

## 三、设计方案

### 3.1 架构演进路线

```
Phase 1: 通用工具链补齐（P0 差距）
  ├─ 文件操作工具（read/write/edit/search）
  ├─ Git 工具（commit/push/diff/branch）
  └─ Shell 工具（exec with timeout）

Phase 2: 外部 MCP 生态打通（P1 差距）
  ├─ MCP server 动态发现与加载
  ├─ UI 管理界面（启用/禁用/配置）
  └─ 常用 MCP servers 预集成（filesystem/git/github）

Phase 3: 安全与治理强化（P2 差距）
  ├─ 文件路径白名单/黑名单
  ├─ Git 操作审批流（前端确认）
  ├─ Shell 命令沙箱（Docker 隔离）
  └─ 操作审计日志

Phase 4: 高级自动化能力（P3 差距）
  ├─ Computer Use API 集成
  ├─ 多文件协同编辑
  └─ 代码补丁智能合并
```

### 3.2 Phase 1 详细设计：通用工具链补齐

#### 3.2.1 文件操作工具

**新增 MCP 工具（6 个）**:

```python
# server-py/app/mcp_tools/filesystem.py

@mcp_server.tool()
async def read_file(path: str, start_line: int = 1, end_line: int = -1) -> str:
    """读取文件内容（支持行范围）"""
    # 实现：路径验证 → 读取 → 返回内容

@mcp_server.tool()
async def write_file(path: str, content: str, mode: str = "overwrite") -> dict:
    """写入文件（支持 overwrite/append）"""
    # 实现：路径验证 → 备份原文件 → 写入 → 返回结果

@mcp_server.tool()
async def edit_file(path: str, old_content: str, new_content: str) -> dict:
    """精确替换文件内容（类似 Claude Code 的 Edit 工具）"""
    # 实现：读取 → 查找 old_content → 替换 → 写入

@mcp_server.tool()
async def search_files(pattern: str, path: str = ".", file_type: str = None) -> list:
    """搜索文件（支持 glob 和正则）"""
    # 实现：使用 pathlib.Path.rglob() 或 ripgrep

@mcp_server.tool()
async def grep_content(pattern: str, path: str = ".", context_lines: int = 2) -> list:
    """搜索文件内容（类似 grep -r）"""
    # 实现：使用 ripgrep 或 Python re

@mcp_server.tool()
async def list_directory(path: str, recursive: bool = False) -> list:
    """列出目录内容"""
    # 实现：os.listdir() 或 os.walk()
```

**权限控制**:
```python
# server-py/app/config.py

FILESYSTEM_CONFIG = {
    "allowed_paths": [
        "/home/shiro/Projects/PathMind-AI",  # 项目根目录
        "/tmp/pathmind-workspace"             # 临时工作区
    ],
    "blocked_paths": [
        "/home/shiro/.ssh",
        "/home/shiro/.config",
        "/etc",
        "/var"
    ],
    "max_file_size": 10 * 1024 * 1024,  # 10MB
    "backup_enabled": True
}
```

#### 3.2.2 Git 工具

**新增 MCP 工具（8 个）**:

```python
# server-py/app/mcp_tools/git.py

@mcp_server.tool()
async def git_status() -> dict:
    """获取 Git 状态"""
    # 实现：subprocess.run(["git", "status", "--porcelain"])

@mcp_server.tool()
async def git_diff(file_path: str = None, staged: bool = False) -> str:
    """查看文件差异"""
    # 实现：git diff [--staged] [file_path]

@mcp_server.tool()
async def git_commit(message: str, files: list = None) -> dict:
    """提交更改（需前端审批）"""
    # 实现：git add → git commit -m

@mcp_server.tool()
async def git_push(remote: str = "origin", branch: str = None) -> dict:
    """推送到远程（需前端审批）"""
    # 实现：git push remote branch

@mcp_server.tool()
async def git_branch(action: str, name: str = None) -> dict:
    """分支操作（list/create/delete/switch）"""
    # 实现：git branch / git checkout

@mcp_server.tool()
async def git_log(max_count: int = 10, file_path: str = None) -> list:
    """查看提交历史"""
    # 实现：git log --oneline

@mcp_server.tool()
async def git_show(commit: str) -> str:
    """查看提交详情"""
    # 实现：git show commit

@mcp_server.tool()
async def git_reset(mode: str = "soft", target: str = "HEAD~1") -> dict:
    """重置提交（需前端审批）"""
    # 实现：git reset --mode target
```

**审批流设计**:
```python
# server-py/app/engines/claude_engine.py

async def _handle_git_approval(self, tool_name: str, args: dict) -> bool:
    """Git 危险操作需前端确认"""
    if tool_name in ["git_commit", "git_push", "git_reset"]:
        # 发送 SSE 事件到前端
        await self._send_approval_request({
            "type": "git_approval",
            "tool": tool_name,
            "args": args,
            "preview": await self._generate_git_preview(tool_name, args)
        })
        # 等待前端响应（通过 WebSocket 或轮询）
        return await self._wait_for_approval(timeout=60)
    return True
```

#### 3.2.3 Shell 工具

**新增 MCP 工具（2 个）**:

```python
# server-py/app/mcp_tools/shell.py

@mcp_server.tool()
async def execute_command(
    command: str,
    cwd: str = None,
    timeout: int = 30,
    env: dict = None
) -> dict:
    """执行 Shell 命令（需前端审批）"""
    # 实现：
    # 1. 命令白名单检查（npm/pip/go/cargo/make/pytest 等）
    # 2. 危险命令拦截（rm -rf / dd / mkfs 等）
    # 3. subprocess.run() with timeout
    # 4. 返回 stdout/stderr/exit_code

@mcp_server.tool()
async def execute_script(
    script_path: str,
    args: list = None,
    timeout: int = 60
) -> dict:
    """执行脚本文件"""
    # 实现：验证脚本路径 → 执行 → 返回结果
```

**安全配置**:
```python
# server-py/app/config.py

SHELL_CONFIG = {
    "allowed_commands": [
        "npm", "yarn", "pnpm", "bun",
        "pip", "poetry", "uv",
        "go", "cargo", "make",
        "pytest", "jest", "vitest",
        "git", "docker", "kubectl"
    ],
    "blocked_patterns": [
        r"rm\s+-rf\s+/",
        r"dd\s+if=",
        r"mkfs\.",
        r":(){ :|:& };:",  # fork bomb
        r"curl.*\|\s*bash"
    ],
    "default_timeout": 30,
    "max_timeout": 300
}
```

### 3.3 Phase 2 详细设计：外部 MCP 生态打通

#### 3.3.1 MCP Server 动态发现与加载

**目标**: 支持用户自定义 MCP servers，无需修改代码。

**配置文件格式**:
```yaml
# server-py/mcp_servers.yaml

servers:
  # 官方 filesystem server
  - name: filesystem
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/shiro/Projects"]
    enabled: true
    tools_whitelist: ["read_file", "write_file", "list_directory"]

  # 官方 git server
  - name: git
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-git"]
    enabled: true
    env:
      GIT_DIR: /home/shiro/Projects/PathMind-AI/.git

  # GitHub MCP server
  - name: github
    type: sse
    url: https://github-mcp.example.com
    headers:
      Authorization: "Bearer ${GITHUB_TOKEN}"
    enabled: false

  # 自定义 HTTP server
  - name: custom-tools
    type: http
    url: http://localhost:3000/mcp
    enabled: false
```

**动态加载器**:
```python
# server-py/app/mcp_tools/loader.py

import yaml
from pathlib import Path
from typing import Dict, List
from mcp import ClientSession, StdioServerParameters

class MCPServerLoader:
    def __init__(self, config_path: str = "mcp_servers.yaml"):
        self.config_path = Path(config_path)
        self.servers: Dict[str, ClientSession] = {}

    async def load_all(self) -> List[str]:
        """加载所有启用的 MCP servers"""
        if not self.config_path.exists():
            return []

        with open(self.config_path) as f:
            config = yaml.safe_load(f)

        loaded = []
        for server_config in config.get("servers", []):
            if not server_config.get("enabled", False):
                continue

            name = server_config["name"]
            try:
                session = await self._create_session(server_config)
                self.servers[name] = session
                loaded.append(name)
            except Exception as e:
                print(f"Failed to load MCP server {name}: {e}")

        return loaded

    async def _create_session(self, config: dict) -> ClientSession:
        """根据配置创建 MCP session"""
        server_type = config["type"]

        if server_type == "stdio":
            params = StdioServerParameters(
                command=config["command"],
                args=config.get("args", []),
                env=config.get("env")
            )
            return await ClientSession.create_stdio(params)

        elif server_type == "sse":
            return await ClientSession.create_sse(
                url=config["url"],
                headers=config.get("headers")
            )

        elif server_type == "http":
            return await ClientSession.create_http(
                url=config["url"],
                headers=config.get("headers")
            )

        else:
            raise ValueError(f"Unknown server type: {server_type}")

    async def get_all_tools(self) -> List[dict]:
        """获取所有 MCP servers 的工具列表"""
        all_tools = []
        for name, session in self.servers.items():
            tools = await session.list_tools()
            for tool in tools:
                tool["_server"] = name  # 标记来源
                all_tools.append(tool)
        return all_tools
```

#### 3.3.2 UI 管理界面

**新增前端页面**: `src/pages/MCPServersPage.tsx`

```typescript
interface MCPServer {
  name: string;
  type: 'stdio' | 'sse' | 'http';
  enabled: boolean;
  status: 'running' | 'stopped' | 'error';
  tools_count: number;
}

export function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([]);

  // 功能：
  // 1. 列出所有配置的 MCP servers
  // 2. 启用/禁用 server（修改 YAML 配置）
  // 3. 查看每个 server 提供的工具列表
  // 4. 测试 server 连接
  // 5. 添加新的 server（表单输入）

  return (
    <div className="mcp-servers-page">
      <h1>MCP Servers 管理</h1>
      <ServerList servers={servers} />
      <AddServerForm />
    </div>
  );
}
```

**后端 API**:
```python
# server-py/app/routes/mcp_routes.py

from fastapi import APIRouter, HTTPException
from app.mcp_tools.loader import MCPServerLoader

router = APIRouter(prefix="/mcp", tags=["mcp"])
loader = MCPServerLoader()

@router.get("/servers")
async def list_servers():
    """列出所有 MCP servers"""
    return {"servers": await loader.get_server_list()}

@router.post("/servers/{name}/enable")
async def enable_server(name: str):
    """启用 MCP server"""
    await loader.enable_server(name)
    return {"status": "enabled"}

@router.post("/servers/{name}/disable")
async def disable_server(name: str):
    """禁用 MCP server"""
    await loader.disable_server(name)
    return {"status": "disabled"}

@router.get("/servers/{name}/tools")
async def list_server_tools(name: str):
    """列出 server 提供的工具"""
    return {"tools": await loader.get_server_tools(name)}

@router.post("/servers/test")
async def test_server(config: dict):
    """测试 server 连接"""
    try:
        session = await loader._create_session(config)
        tools = await session.list_tools()
        return {"status": "success", "tools_count": len(tools)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
```

#### 3.3.3 常用 MCP Servers 预集成

**推荐列表**:
1. `@modelcontextprotocol/server-filesystem` - 文件系统操作
2. `@modelcontextprotocol/server-git` - Git 操作
3. `@modelcontextprotocol/server-github` - GitHub API
4. `@modelcontextprotocol/server-postgres` - PostgreSQL 查询
5. `@modelcontextprotocol/server-puppeteer` - 浏览器自动化

**一键安装脚本**:
```bash
#!/bin/bash
# scripts/install-mcp-servers.sh

echo "Installing recommended MCP servers..."

npm install -g \
  @modelcontextprotocol/server-filesystem \
  @modelcontextprotocol/server-git \
  @modelcontextprotocol/server-github \
  @modelcontextprotocol/server-postgres \
  @modelcontextprotocol/server-puppeteer

echo "Done! Configure them in server-py/mcp_servers.yaml"
```

### 3.4 Phase 3 详细设计：安全与治理强化

#### 3.4.1 细粒度权限控制

**权限模型**:
```python
# server-py/app/security/permissions.py

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel

class PermissionLevel(str, Enum):
    READ = "read"
    WRITE = "write"
    EXECUTE = "execute"
    ADMIN = "admin"

class PathPermission(BaseModel):
    path: str
    level: PermissionLevel
    recursive: bool = True

class ToolPermission(BaseModel):
    tool_name: str
    allowed: bool
    require_approval: bool = False
    max_calls_per_session: Optional[int] = None

class AgentPermissions(BaseModel):
    agent_name: str
    filesystem: List[PathPermission]
    tools: List[ToolPermission]
    shell_commands: List[str]  # 白名单
    git_operations: List[str]  # 允许的 git 操作

# 示例配置
CODE_REVIEWER_PERMISSIONS = AgentPermissions(
    agent_name="code-reviewer",
    filesystem=[
        PathPermission(path="/home/shiro/Projects/PathMind-AI/src", level=PermissionLevel.READ),
        PathPermission(path="/home/shiro/Projects/PathMind-AI/tests", level=PermissionLevel.READ),
    ],
    tools=[
        ToolPermission(tool_name="read_file", allowed=True),
        ToolPermission(tool_name="search_files", allowed=True),
        ToolPermission(tool_name="write_file", allowed=False),
    ],
    shell_commands=["npm test", "npm run lint"],
    git_operations=["status", "diff", "log"]
)
```

**权限检查中间件**:
```python
# server-py/app/engines/claude_engine.py

async def _check_tool_permission(self, tool_name: str, args: dict) -> bool:
    """检查工具调用权限"""
    permissions = self.agent_permissions

    # 1. 检查工具是否在白名单
    tool_perm = next((t for t in permissions.tools if t.tool_name == tool_name), None)
    if not tool_perm or not tool_perm.allowed:
        raise PermissionError(f"Tool {tool_name} not allowed for agent {self.agent_name}")

    # 2. 检查文件路径权限（如果是文件操作）
    if tool_name in ["read_file", "write_file", "edit_file"]:
        file_path = args.get("path")
        if not self._check_path_permission(file_path, tool_perm.level):
            raise PermissionError(f"No permission to access {file_path}")

    # 3. 检查是否需要审批
    if tool_perm.require_approval:
        approved = await self._request_approval(tool_name, args)
        if not approved:
            raise PermissionError(f"User denied approval for {tool_name}")

    # 4. 检查调用次数限制
    if tool_perm.max_calls_per_session:
        call_count = self.tool_call_counts.get(tool_name, 0)
        if call_count >= tool_perm.max_calls_per_session:
            raise PermissionError(f"Max calls exceeded for {tool_name}")

    return True
```

#### 3.4.2 前端审批流

**审批请求 SSE 事件**:
```typescript
// src/hooks/useAgentStream.ts

interface ApprovalRequest {
  id: string;
  type: 'git_commit' | 'git_push' | 'shell_command' | 'file_write';
  tool: string;
  args: Record<string, any>;
  preview: string;  // 操作预览（如 git diff）
  timestamp: number;
}

export function useAgentStream() {
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);

  const handleApprovalRequest = (data: ApprovalRequest) => {
    setPendingApprovals(prev => [...prev, data]);
  };

  const approveRequest = async (id: string) => {
    await fetch(`/api/agent/approve/${id}`, { method: 'POST' });
    setPendingApprovals(prev => prev.filter(r => r.id !== id));
  };

  const rejectRequest = async (id: string) => {
    await fetch(`/api/agent/reject/${id}`, { method: 'POST' });
    setPendingApprovals(prev => prev.filter(r => r.id !== id));
  };

  return { pendingApprovals, approveRequest, rejectRequest };
}
```

**审批 UI 组件**:
```typescript
// src/components/ApprovalModal.tsx

export function ApprovalModal({ request, onApprove, onReject }: Props) {
  return (
    <Modal>
      <h2>Agent 请求执行操作</h2>
      <div className="approval-details">
        <p><strong>工具:</strong> {request.tool}</p>
        <p><strong>参数:</strong></p>
        <pre>{JSON.stringify(request.args, null, 2)}</pre>

        {request.preview && (
          <div className="preview">
            <h3>预览</h3>
            <pre>{request.preview}</pre>
          </div>
        )}
      </div>

      <div className="actions">
        <button onClick={() => onApprove(request.id)}>批准</button>
        <button onClick={() => onReject(request.id)}>拒绝</button>
      </div>
    </Modal>
  );
}
```

#### 3.4.3 操作审计日志

**日志模型**:
```python
# server-py/app/models/audit_log.py

from sqlalchemy import Column, Integer, String, DateTime, JSON
from datetime import datetime

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    agent_name = Column(String(100))
    user_id = Column(Integer)
    session_id = Column(String(100))

    action_type = Column(String(50))  # tool_call, file_write, git_commit, etc.
    tool_name = Column(String(100))
    args = Column(JSON)
    result = Column(JSON)

    approved = Column(Boolean, default=True)
    approver_id = Column(Integer, nullable=True)

    error = Column(String(500), nullable=True)
```

**日志记录**:
```python
# server-py/app/engines/claude_engine.py

async def _log_tool_call(self, tool_name: str, args: dict, result: any, error: str = None):
    """记录工具调用到审计日志"""
    log = AuditLog(
        agent_name=self.agent_name,
        user_id=self.user_id,
        session_id=self.session_id,
        action_type="tool_call",
        tool_name=tool_name,
        args=args,
        result=result,
        error=error
    )
    db.add(log)
    await db.commit()
```

### 3.5 Phase 4 详细设计：高级自动化能力

#### 3.5.1 Computer Use API 集成

**目标**: 支持 Anthropic Computer Use API，实现屏幕控制和浏览器自动化。

**工具定义**:
```python
# server-py/app/mcp_tools/computer_use.py

@mcp_server.tool()
async def computer_screenshot(display: int = 0) -> str:
    """截取屏幕（返回 base64 图片）"""
    # 实现：使用 pyautogui 或 mss

@mcp_server.tool()
async def computer_mouse_move(x: int, y: int) -> dict:
    """移动鼠标"""
    # 实现：pyautogui.moveTo(x, y)

@mcp_server.tool()
async def computer_mouse_click(button: str = "left") -> dict:
    """点击鼠标"""
    # 实现：pyautogui.click(button=button)

@mcp_server.tool()
async def computer_keyboard_type(text: str) -> dict:
    """输入文本"""
    # 实现：pyautogui.typewrite(text)

@mcp_server.tool()
async def computer_keyboard_press(key: str) -> dict:
    """按键"""
    # 实现：pyautogui.press(key)
```

**安全限制**:
- 默认禁用，需显式启用
- 只允许在特定 agent（如 `browser-automation`）中使用
- 每次操作需前端审批
- 限制操作频率（防止失控）

#### 3.5.2 多文件协同编辑

**批量编辑工具**:
```python
# server-py/app/mcp_tools/filesystem.py

@mcp_server.tool()
async def batch_edit_files(edits: List[dict]) -> dict:
    """批量编辑多个文件

    Args:
        edits: [
            {"path": "file1.py", "old": "...", "new": "..."},
            {"path": "file2.py", "old": "...", "new": "..."}
        ]
    """
    results = []
    for edit in edits:
        try:
            result = await edit_file(**edit)
            results.append({"path": edit["path"], "status": "success"})
        except Exception as e:
            results.append({"path": edit["path"], "status": "error", "error": str(e)})

    return {"results": results}

@mcp_server.tool()
async def apply_patch(patch_content: str, base_path: str = ".") -> dict:
    """应用 unified diff 补丁"""
    # 实现：使用 patch 命令或 Python unidiff 库
```

#### 3.5.3 代码补丁智能合并

**补丁生成与应用**:
```python
# server-py/app/services/patch_service.py

class PatchService:
    async def generate_patch(self, file_path: str, original: str, modified: str) -> str:
        """生成 unified diff 补丁"""
        import difflib
        diff = difflib.unified_diff(
            original.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}"
        )
        return ''.join(diff)

    async def apply_patch_smart(self, patch: str, base_path: str) -> dict:
        """智能应用补丁（处理冲突）"""
        # 1. 尝试直接应用
        # 2. 如果失败，尝试模糊匹配（fuzzy matching）
        # 3. 如果仍失败，标记冲突并返回冲突文件列表
```

---

## 四、实施计划

### 4.1 时间线（4 周）

**Week 1: Phase 1 - 通用工具链补齐**
- Day 1-2: 文件操作工具（6 个）+ 权限控制
- Day 3-4: Git 工具（8 个）+ 审批流基础
- Day 5: Shell 工具（2 个）+ 安全配置

**Week 2: Phase 2 - 外部 MCP 生态打通**
- Day 1-2: MCP Server 动态加载器 + YAML 配置
- Day 3-4: UI 管理界面（前端 + 后端 API）
- Day 5: 预集成常用 MCP servers + 测试

**Week 3: Phase 3 - 安全与治理强化**
- Day 1-2: 细粒度权限模型 + 权限检查中间件
- Day 3: 前端审批流 UI
- Day 4: 操作审计日志
- Day 5: 集成测试 + 文档

**Week 4: Phase 4 - 高级自动化能力**
- Day 1-2: Computer Use API 集成
- Day 3: 多文件协同编辑
- Day 4: 代码补丁智能合并
- Day 5: 端到端测试 + 性能优化

### 4.2 里程碑

| 里程碑 | 完成标准 | 验收方式 |
|--------|---------|---------|
| M1: 基础工具链 | 16 个新工具可用 | Agent 能读写文件、执行 git 命令 |
| M2: MCP 生态 | 支持外部 MCP servers | 成功加载 filesystem/git servers |
| M3: 安全治理 | 权限控制 + 审批流 | 危险操作需审批，有审计日志 |
| M4: 高级能力 | Computer Use 可用 | Agent 能控制浏览器完成任务 |

### 4.3 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 外部 MCP servers 不稳定 | 功能不可用 | 中 | 提供降级方案（内部工具） |
| 审批流阻塞用户体验 | 用户抱怨 | 高 | 提供"信任模式"跳过审批 |
| Computer Use 安全风险 | 系统被破坏 | 低 | 默认禁用 + 沙箱隔离 |
| 性能下降（工具太多） | 响应变慢 | 中 | 工具懒加载 + 缓存 |

---

## 五、成功指标

### 5.1 功能指标

- ✅ 支持 30+ 工具（当前 24 + 新增 16）
- ✅ 支持 5+ 外部 MCP servers
- ✅ 100% 危险操作有审批流
- ✅ 100% 操作有审计日志

### 5.2 性能指标

- 工具调用延迟 < 500ms（P95）
- MCP server 加载时间 < 3s
- 审批请求响应时间 < 100ms

### 5.3 安全指标

- 0 次未授权文件访问
- 0 次危险命令执行（未审批）
- 100% 审计日志覆盖率

---

## 六、后续优化方向

1. **工具市场**: 用户可分享和下载自定义 MCP servers
2. **AI 辅助审批**: 使用 AI 预判操作风险，自动批准低风险操作
3. **协作模式**: 多用户同时与 Agent 交互
4. **时间旅行调试**: 回放 Agent 操作历史
5. **性能监控**: Agent 工具调用性能分析面板

---

## 附录

### A. 参考资料

- [Claude Agent SDK 文档](https://github.com/anthropics/claude-agent-sdk)
- [MCP 协议规范](https://modelcontextprotocol.io)
- [Anthropic Computer Use API](https://docs.anthropic.com/claude/docs/computer-use)

### B. 相关文件

- `server-py/app/mcp_tools/server.py` - 当前工具定义
- `server-py/app/agents/registry.py` - Agent 配置
- `server-py/app/engines/claude_engine.py` - Claude 引擎实现
- `src/hooks/useAgentStream.ts` - 前端流式处理

### C. 团队分工建议

- **后端开发（2 人）**: Phase 1-3 工具实现 + 权限系统
- **前端开发（1 人）**: UI 管理界面 + 审批流组件
- **DevOps（1 人）**: MCP servers 部署 + 安全沙箱
- **测试（1 人）**: 端到端测试 + 安全测试


---

## 七、实施状态（2026-02-21）

### 已落地（P5-P0 主体）
- ✅ 内建 coding 工具链（文件/Git/Shell）
- ✅ 严格沙箱（路径/命令策略、危险命令拦截、超时/输出限制）
- ✅ 高风险逐次审批（`approval_request` / `approval_result` SSE + approve/reject API）
- ✅ Claude/OpenAI 双链路审批接入
- ✅ 审计落库（Python -> Go internal ingest -> Postgres）
- ✅ AIAdvisor Coding 模式、workspace 与审批 UI

### 部分落地（P1/P2）
- ✅ `coding_v1` profile 透传与前端策略入口
- ✅ run 级 scratchpad 统一记忆（AgentService + Claude/OpenAI 双写入 + 升级链路快照）
- ✅ 高风险并发上限（默认 1）+ 低风险重试策略（OpenAI 工具链）
- ✅ 审批指标聚合与查询接口（`GET /agent/approvals/metrics`）
- ✅ `webagent_core` 新增 `ApprovalProvider` / `SandboxPolicy` / `AuditSink` 抽象
- ✅ external MCP 风险映射与内建优先/失败回退策略已落地
- ✅ 开发者文档收口完成（quickstart/runbook/API reference）
