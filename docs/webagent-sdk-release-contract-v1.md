# WebAgent SDK Release Contract v1

## 目标

定义 `webagent_core` 的发布约束，确保在跨服务（Python/Go/Frontend）与跨模型链路（Claude/OpenAI）下保持稳定可升级。

---

## 1. 语义版本策略（SemVer）

版本格式：`MAJOR.MINOR.PATCH`

- **MAJOR**：破坏性变更（删除/重命名导出、协议字段语义变更）
- **MINOR**：向后兼容新增（新增导出、新增可选字段、新增 helper）
- **PATCH**：修复与实现细节优化（不改变 public contract）

当前建议起始版本：`1.0.0`

---

## 2. Public Contract Surface

v1 受保护公共面（新增可以，破坏需 MAJOR）：

- 模块：`app.services.webagent_core`
- 导出分组：
  - Protocol: `PROTOCOL_VERSION`, `WebAgentPlan`, `WebAgentPlanNode`
  - Runtime: `OrchestratorConfig`, `parse_runtime_orchestrator`
  - Contracts: `TenantContext`, `ArtifactContract`, `WorkerArtifact`
  - Data Adapter: `DataAdapter`, `HttpDataAdapter`, `get_data_adapter`, `set_data_adapter`
  - Orchestrator helpers: `build_dag_layers`, `resolve_worker_tools`, `compact_worker_trace`

兼容层：`app.services.webagent_protocol`（Deprecated but supported in v1）

---

## 3. 协议兼容矩阵

| Layer | Contract | Compatibility Rule |
|------|----------|--------------------|
| Python API | `/agent/query` response | `tenant` 字段必须保持可选且结构稳定 |
| SSE | `meta`, `orchestrator` events | 保留既有字段；新增字段必须 optional |
| Frontend | `useAgentStream` parse | 旧字段语义不变；新增字段 fallback-safe |
| Go Proxy | `AgentQueryResponse` | 与 Python 结构同名对齐（至少 optional） |

---

## 4. 弃用策略（Deprecation Policy）

- 弃用阶段至少经历 2 个 MINOR 版本：
  1) 标记 deprecated（文档 + 警告）
  2) 提供替代字段/函数
  3) 下一个 MAJOR 才可移除

- 弃用说明必须包含：
  - 影响范围
  - 替代方案
  - 迁移样例
  - 最早移除版本

---

## 5. 发布前门禁（Release Gates）

每次 release 至少满足：

1. **Contract Check**
   - `python3 server-py/scripts/verify_webagent_core_contract.py`
   - 或统一入口：`bash scripts/check_webagent_release.sh`
2. **Python Syntax**
   - `python3 -m py_compile server-py/app/services/webagent_core/*.py`
3. **Go Proxy Compatibility**
   - `cd server-go && go test ./...`
4. **Frontend Build**
   - `npm run build`
5. **Docs Sync**
   - `docs/webagent-protocol-v1.md`
   - `docs/webagent-sdk-reference-v1.md`
   - `docs/webagent-sdk-quickstart.md`

---

## 6. Release Notes 模板

- Version
- Contract changes (added/changed/deprecated/removed)
- Migration impact
- Verification commands and results
- Known limitations

