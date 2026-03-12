# WebAgent Core SDK Reference v1

> 适用代码：`server-py/app/services/webagent_core`

## 1. 核心导出

统一从：

```python
from app.services.webagent_core import ...
```

关键导出分组：

- 协议层：`PROTOCOL_VERSION`、`WebAgentPlan`、`WebAgentPlanNode`
- 运行时：`OrchestratorConfig`、`parse_runtime_orchestrator()`、`parse_orchestrator_config()`
- 编排层：`build_dag_layers()`、`resolve_worker_tools()`、`compact_worker_trace()`
- 契约层：`TenantContext`、`ArtifactContract`、`WorkerArtifact`
- 数据层：`DataAdapter`、`HttpDataAdapter`、`get_data_adapter()`、`set_data_adapter()`

---

## 2. Tenant Contract

### `TenantContext`

```python
@dataclass(slots=True)
class TenantContext:
    tenant_id: str = "public"
    role: str = "student"
    student_id: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None
    locale: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
```

### 解析函数

- `parse_tenant_context(payload, student_id=None, role='student') -> TenantContext`
- `compact_tenant_context(ctx) -> dict | None`

支持输入 key：`tenant_id` / `tenantId` / `org_id`（自动归一化到 `tenant_id`）。

---

## 3. Artifact Contract

### `ArtifactContract`

标准类型（`kind`）：

- `text`
- `note_markdown`
- `report_json`
- `pdf_url`

### 推断函数

- `infer_artifact_contract(response_text, structured_output) -> ArtifactContract`

用于把 worker 输出统一为可消费的产物结构，便于后续导出笔记、报告、PDF。

---

## 4. Data Adapter Contract

### `DataAdapter` Protocol

```python
class DataAdapter(Protocol):
    async def get_json(path, *, params=None, headers=None, tenant=None, timeout_s=10.0) -> Any: ...
    async def post_json(path, *, payload, params=None, headers=None, tenant=None, timeout_s=10.0) -> Any: ...
```

### 默认实现

- `HttpDataAdapter(base_url=settings.go_backend_url)`

### 注入方式

- `set_data_adapter(custom_adapter)`
- `get_data_adapter()`

适用于：测试替身、私有数据源、多租户路由、SDK 外部宿主接入。

---

## 5. Orchestrator Runtime Contract

`context._runtime.orchestrator` 字段：

- `enabled`
- `profile`
- `planner_mode`
- `executor_mode`
- `max_steps`
- `max_workers`
- `worker_timeout_s`
- `worker_max_retries`
- `worker_retry_backoff_ms`
- `max_budget_usd`

解析入口：`parse_runtime_orchestrator()`。

---

## 6. Streaming/Event Contract

### SSE meta

- `type: "meta"`
- 关键字段：`agent` / `engine` / `model` / `mode` / `tenant`

### SSE orchestrator

- `type: "orchestrator"`
- `stage`: `planned|layer_start|worker_start|worker_retry|worker_done|layer_done|budget_exhausted`
- 关键字段：`tenant`、`artifact_type`、`artifact_uri`（worker_done）

---

## 7. 兼容层

- 旧导入路径：`app.services.webagent_protocol`
- 新路径：`app.services.webagent_core`

当前兼容层仍可用，但建议新代码迁移到 `webagent_core`。
