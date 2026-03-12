<p align="center">
  <img src="assets/icon.svg" width="80" height="96" alt="Kiro Proxy">
</p>

<h1 align="center">Kiro API Proxy</h1>

<p align="center">
  Kiro IDE API reverse proxy server with multi-account rotation, auto token refresh, and quota management
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#background-service">Background Service</a> •
  <a href="#client-configuration">Client Config</a> •
  <a href="#project-structure">Structure</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="README.md">中文</a> | <strong>English</strong>
</p>

---

> **📢 v1.7.2 Update**
> 
> Full multi-language support! The WebUI now supports **English** and **Chinese**. Select your language in the launcher or settings.

## Features

### Core Features
- **Multi-Protocol Support** - Compatible with OpenAI / Anthropic / Gemini protocols
- **Full Tool Calling** - Complete tool calling support for all three protocols
- **Image Understanding** - Supports Claude Code / Codex CLI image input
- **Web Search** - Supports Claude Code / Codex CLI web search tools
- **Multi-Account Rotation** - Add multiple Kiro accounts with automatic load balancing
- **Session Stickiness** - Same session uses same account for 60 seconds to maintain context
- **Web UI** - Clean management interface with monitoring, logs, and settings
- **Multi-Language UI** - Full English and Chinese interface support

### v1.7.2 New Features
- **Multi-Language Support** - Complete English WebUI and documentation
- **Bilingual Launcher** - Port/Language settings with clear Start button
- **English Help Docs** - All 5 documentation files translated

### v1.7.1 Features
- **Windows Support Enhancement** - Registry browser detection + PATH fallback
- **Packaging Fix** - PyInstaller correctly loads icons and embedded docs
- **Token Scanning Stability** - Windows path encoding fixes

### v1.6.x Features
- **CLI Tools** - Manage accounts on headless servers
- **Remote Login Link** - Complete auth on browser machine, token syncs automatically
- **Account Import/Export** - Migrate account configs across machines
- **Codex CLI Support** - Full OpenAI Responses API (`/v1/responses`)
- **Rate Limiting** - Reduce account ban risk with request frequency limits
- **History Management** - 4 strategies to handle conversation length limits

## Tool Calling Support

| Feature | Anthropic (Claude Code) | OpenAI (Codex CLI) | Gemini |
|---------|------------------------|-------------------|--------|
| Tool Definition | ✅ `tools` | ✅ `tools.function` | ✅ `functionDeclarations` |
| Tool Call Response | ✅ `tool_use` | ✅ `tool_calls` | ✅ `functionCall` |
| Tool Results | ✅ `tool_result` | ✅ `tool` role msg | ✅ `functionResponse` |
| Force Tool Call | ✅ `tool_choice` | ✅ `tool_choice` | ✅ `toolConfig.mode` |
| Tool Limit | ✅ 50 | ✅ 50 | ✅ 50 |
| History Repair | ✅ | ✅ | ✅ |
| Image Understanding | ✅ | ✅ | ❌ |
| Web Search | ✅ | ✅ | ❌ |

## Known Limitations

### Conversation Length Limit

Kiro API has input length limits. Long conversations will return:

```
Input is too long. (CONTENT_LENGTH_EXCEEDS_THRESHOLD)
```

#### Automatic Handling (v1.6.0+)

Built-in history management in Settings page:

- **Error Retry** (default): Auto-truncate and retry on length error
- **Smart Summary**: Use AI to summarize early conversations
- **Summary Cache** (default): Reuse recent summaries when history hasn't changed much
- **Auto Truncate**: Prioritize recent context before sending
- **Pre-estimate**: Estimate tokens before sending, pre-truncate if exceeds

#### Manual Handling

1. Type `/clear` in Claude Code to clear conversation history
2. Tell AI what you were working on, it will read code files to restore context

## Quick Start

> 💡 **Recommended: Install as Service** - Auto-start on boot and run in background. See [Background Service](#background-service) section.

### Option 1: Download Pre-built Binary

Download from [Releases](../../releases) for your platform and run directly.

### Option 2: Run from Source

```bash
# Clone project
git clone https://github.com/petehsu/KiroProxy.git
cd KiroProxy

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run
python run.py

# Or specify port
python run.py 8081
```

Visit http://localhost:8080 after startup.

### Add Accounts

**Option 1: Online Login (Recommended)**
1. Open Web UI, click "Online Login"
2. Choose: Google / GitHub / AWS Builder ID
3. Complete authorization in browser
4. Account added automatically

**Option 2: Scan Local Tokens**
1. If logged in Kiro IDE, tokens saved to `~/.aws/sso/cache/`
2. Click "Scan Tokens" in Web UI or run:
   ```bash
   python run.py accounts scan --auto
   ```

**Option 3: Manual Add**
```bash
python run.py accounts add
```

---

## Background Service

Install Kiro Proxy as a system service for auto-start and background running.

### Quick Installation

**Windows (Administrator):**
```cmd
# Run CMD or PowerShell as Administrator
cd E:\path\to\KiroProxy
python scripts\install_service.py
```

**Linux (sudo required):**
```bash
cd /path/to/KiroProxy
sudo python3 scripts/install_service.py
```

### Features

- ✅ **Auto-start on boot** - No manual startup needed
- ✅ **Background running** - No window, no terminal occupation
- ✅ **Virtual environment support** - Auto-detect and use venv
- ✅ **Dependency check** - Auto-verify before installation
- ✅ **Persistent running** - Unaffected by terminal closure

### Management Commands

**Windows**
```cmd
# Check status
python scripts\check_service.py

# Start now
schtasks /Run /TN KiroProxyService

# Uninstall
python scripts\uninstall_service.py
```

**Linux**
```bash
# Check status
python3 scripts/check_service.py

# Start/Stop/Restart
sudo systemctl start kiro-proxy
sudo systemctl stop kiro-proxy
sudo systemctl restart kiro-proxy

# View logs
sudo journalctl -u kiro-proxy -f

# Uninstall
sudo python3 scripts/uninstall_service.py
```

### Detailed Documentation

- [docs/SERVICE_GUIDE.md](docs/SERVICE_GUIDE.md) - Complete service management guide
- [docs/QUICK_START_SERVICE.md](docs/QUICK_START_SERVICE.md) - Quick start and troubleshooting

---

## CLI Tools

Manage accounts on headless servers:

```bash
# Account Management
python run.py accounts list              # List accounts
python run.py accounts export -o acc.json  # Export accounts
python run.py accounts import acc.json   # Import accounts
python run.py accounts add               # Interactive token add
python run.py accounts scan --auto       # Scan and auto-add local tokens

# Login
python run.py login google               # Google login
python run.py login github               # GitHub login
python run.py login remote --host myserver.com:8080  # Generate remote login link

# Service
python run.py serve                      # Start service (default 8080)
python run.py serve -p 8081              # Specify port
python run.py status                     # View status
```

### Getting Tokens

**Option 1: Online Login (Recommended)**
1. Open Web UI, click "Online Login"
2. Choose: Google / GitHub / AWS Builder ID
3. Complete authorization in browser
4. Account added automatically

**Option 2: Scan Tokens**
1. Open Kiro IDE, login with Google/GitHub
2. Tokens saved to `~/.aws/sso/cache/`
3. Click "Scan Tokens" in Web UI

## CLI Configuration

### Model Mapping

| Kiro Model | Capability | Claude Code | Codex |
|------------|------------|-------------|-------|
| `claude-sonnet-4` | ⭐⭐⭐ Recommended | `claude-sonnet-4` | `gpt-4o` |
| `claude-sonnet-4.5` | ⭐⭐⭐⭐ Stronger | `claude-sonnet-4.5` | `gpt-4o` |
| `claude-haiku-4.5` | ⚡ Fast | `claude-haiku-4.5` | `gpt-4o-mini` |
| `claude-opus-4.5` | ⭐⭐⭐⭐⭐ Strongest | `claude-opus-4.5` | `o1` |

### Claude Code Configuration

```
Name: Kiro Proxy
API Key: any
Base URL: http://localhost:8080
Model: claude-sonnet-4
```

### Codex Configuration

```bash
# Set environment variables
export OPENAI_API_KEY=any
export OPENAI_BASE_URL=http://localhost:8080/v1

# Run Codex
codex
```

Or in `~/.codex/config.toml`:

```toml
[providers.openai]
api_key = "any"
base_url = "http://localhost:8080/v1"
```

## API Endpoints

| Protocol | Endpoint | Purpose |
|----------|----------|---------|
| OpenAI | `POST /v1/chat/completions` | Chat Completions API |
| OpenAI | `POST /v1/responses` | Responses API (Codex CLI) |
| OpenAI | `GET /v1/models` | Model list |
| Anthropic | `POST /v1/messages` | Claude Code |
| Anthropic | `POST /v1/messages/count_tokens` | Token count |
| Gemini | `POST /v1/models/{model}:generateContent` | Gemini CLI |

### Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts` | GET | Get all account status |
| `/api/accounts/{id}` | GET | Get account details |
| `/api/accounts/{id}/usage` | GET | Get account usage info |
| `/api/accounts/{id}/refresh` | POST | Refresh account token |
| `/api/accounts/{id}/restore` | POST | Restore account (from cooldown) |
| `/api/accounts/refresh-all` | POST | Refresh all expiring tokens |
| `/api/flows` | GET | Get request records |
| `/api/flows/stats` | GET | Get request statistics |
| `/api/quota` | GET | Get quota status |
| `/api/stats` | GET | Get statistics |

## Disclaimer

This project is for educational purposes only. Commercial use is prohibited. Any consequences from using this project are the user's responsibility.

This project is not affiliated with Kiro / AWS / Anthropic.

## License

MIT
