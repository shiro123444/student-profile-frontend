# 更新日志

## [Unreleased]

### Added
- 后台服务支持（开机自启 + 后台运行）
  - Windows 任务计划程序集成
  - Linux systemd 服务支持
  - 自动检测虚拟环境
  - 服务管理脚本（install/uninstall/check）
- 项目结构重组
  - `scripts/` - 工具脚本目录
  - `docs/` - 文档目录
  - 完整的项目结构文档
- 兼容不带 `/v1` 前缀的 API 路径（支持 Obsidian Copilot）
- **手动添加 Token 支持 AWS BuilderId** - 前端新增认证方式选择和 clientId/clientSecret 字段

### Changed
- 优化 README 结构，添加后台服务章节和项目更新维护指南
- 改进服务安装脚本的依赖检查
- 更新 .gitignore，排除生成的服务文件

### Fixed
- 修复服务状态检查脚本的字段名错误
- 修复虚拟环境检测逻辑
- **修复 BuilderId Token 刷新失败** - 手动添加时支持完整的 OIDC 凭据（clientId + clientSecret）

## [1.7.2] - 2024-XX-XX

### Added
- 多语言支持 - WebUI 完整支持中英文切换
- 双语启动器 - 端口/语言设置
- 英文帮助文档 - 全部 5 篇文档已翻译

## [1.7.1] - 2024-XX-XX

### Added
- Windows 支持补强 - 注册表浏览器检测 + PATH 回退
- 打包资源修复 - PyInstaller 打包后可正常加载资源

### Fixed
- Token 扫描稳定性 - Windows 路径编码处理

## [1.6.3] - 2024-XX-XX

### Added
- 命令行工具 (CLI)
  - 账号管理命令
  - 在线登录命令
  - 远程登录链接生成
- 账号导入导出功能
- 手动添加 Token 功能

## [1.6.2] - 2024-XX-XX

### Added
- Codex CLI 完整支持
  - OpenAI Responses API
  - 工具调用支持
  - 图片输入支持
  - 网络搜索支持
- Claude Code 增强
  - 图片理解支持
  - 网络搜索支持

## [1.6.1] - 2024-XX-XX

### Added
- 请求限速功能
  - 每账号最小请求间隔
  - 每账号每分钟最大请求数
  - 全局每分钟最大请求数
- 账号封禁检测
  - 自动检测 TEMPORARILY_SUSPENDED
  - 自动禁用被封禁账号
  - 自动切换到其他账号
- 统一错误处理

## [1.6.0] - 2024-XX-XX

### Added
- 历史消息管理
  - 自动截断
  - 智能摘要
  - 摘要缓存
  - 错误重试
  - 预估检测
- Gemini 工具调用支持
- WebUI 设置页面

## [1.5.0] - 2024-XX-XX

### Added
- 用量查询功能
- 多登录方式（Google/GitHub/AWS Builder ID）
- 流量监控功能
- 浏览器选择功能
- 文档中心

## [1.4.0] - 2024-XX-XX

### Added
- Token 预刷新机制
- 健康检查功能
- 请求统计增强
- 请求重试机制

## [1.0.0] - 2024-XX-XX

### Added
- 初始版本
- 多协议支持（OpenAI/Anthropic/Gemini）
- 多账号轮询
- Token 自动刷新
- Web UI
- 配额管理
