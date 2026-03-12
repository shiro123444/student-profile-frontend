# WebAgent Core SDK Quickstart

## 1) 导入核心接口

```python
from app.services.webagent_core import (
    parse_tenant_context,
    get_data_adapter,
    set_data_adapter,
    DataAdapter,
)
```

## 2) 注入自定义 DataAdapter

```python
class MyAdapter:
    async def get_json(self, path, *, params=None, headers=None, tenant=None, timeout_s=10.0):
        ...

    async def post_json(self, path, *, payload, params=None, headers=None, tenant=None, timeout_s=10.0):
        ...

set_data_adapter(MyAdapter())
```

## 3) 传入租户上下文

请求 `context` 中传：

```json
{
  "_tenant": {
    "tenant_id": "school-a",
    "role": "teacher",
    "user_id": "teacher-001"
  }
}
```

后端会自动归一化为 `TenantContext`，并在 `query/stream` 中回传 `tenant`。

## 4) Worker 产物消费

在 orchestrator 事件中可读取：

- `artifact_type`
- `artifact_uri`

典型分支：

- `report_json` → 渲染结构化报告
- `note_markdown` → 写入笔记系统
- `pdf_url` → 直接触发下载/预览

## 5) 最小运行示例

可直接运行：

- `server-py/examples/webagent_sdk_boundary_example.py`

该示例展示：

- 自定义 adapter 注入
- tenant 构建
- 统一数据访问调用
