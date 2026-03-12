# Obsidian Lite Compatibility v1

## 结论（基于仓库现状）

- `obsidian-releases/` 是 Obsidian 的发布与社区插件目录仓库，不包含 Obsidian 主程序源码。
- 因此当前系统不能“直接运行” Obsidian 桌面插件（它们依赖 Obsidian 私有运行时与 API）。
- 但可以做 **轻量兼容路径**：先兼容目录与工作流，再逐步兼容扩展点。

## 已落地

1. **目录兼容**
   - 从 `obsidian-releases/community-plugins.json` + `community-plugin-stats.json` 生成精选目录：
   - `public/obsidian/community-plugins-top.json`（Top 300，含下载量/更新时间）
2. **前端扩展入口**
   - Notes 系统面板新增 `Obsidian 插件扩展（轻量兼容）`：
   - 支持搜索、查看 Repo、启用/禁用扩展入口（本地持久化）。
3. **轻量运行时命令**
   - Notes 顶栏新增 `扩展命令` 菜单：
   - 内建命令支持：`插入今日小节`、`生成目录`、`汇总待办`、`规范 WikiLink`。
   - 已启用 Obsidian 插件会自动生成“迁移入口命令”（跳转仓库，按 PathMind API 适配）。
   - 顶栏展示实时状态徽标：字数 / 双链 / 待办 / 扩展数。

## 当前边界

- 仅“目录级 + 入口级 + 内建命令级”兼容，不执行 Obsidian 插件 `main.js`。
- 不提供 Obsidian API shim（如 `app.vault`, `workspace`, `metadataCache`）。
- 不支持直接安装 `.obsidian/plugins/*` 即运行。

## 下一阶段（可执行）

### P1：PathMind Notes 扩展 API（推荐）

- 定义稳定扩展接口：
  - `onNoteOpen`, `onNoteChange`, `onRenderPreview`, `commands`, `statusItems`
- 允许插件运行在受限沙箱（iframe/WebWorker）中。
- 将 Obsidian 目录插件映射为“可迁移候选”，支持一键生成适配模板。

### P2：Obsidian 插件迁移工具链

- `manifest.json` 解析 + 能力扫描（依赖哪些 Obsidian API）
- 生成迁移报告：
  - 可直接迁移 / 需适配 / 暂不支持
- 为常见 API 提供适配层（部分兼容）

### P3：受控执行

- 插件权限模型（文件读写/网络/命令）
- 审批与审计接入现有 Agent 安全链路
- 插件执行异常隔离与熔断
