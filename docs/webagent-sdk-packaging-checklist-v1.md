# WebAgent SDK Packaging Checklist v1

## A. 打包范围（必须）

- `server-py/app/services/webagent_core/__init__.py`
- `server-py/app/services/webagent_core/protocol.py`
- `server-py/app/services/webagent_core/runtime.py`
- `server-py/app/services/webagent_core/contracts.py`
- `server-py/app/services/webagent_core/orchestrator.py`
- `server-py/app/services/webagent_core/data_adapter.py`

## B. 文档范围（必须）

- `docs/webagent-protocol-v1.md`
- `docs/webagent-sdk-reference-v1.md`
- `docs/webagent-sdk-quickstart.md`
- `docs/webagent-sdk-release-contract-v1.md`

## C. 示例范围（建议）

- `server-py/examples/webagent_sdk_boundary_example.py`

## D. 打包前检查

1. 导出契约检查
   - `python3 server-py/scripts/verify_webagent_core_contract.py`
2. Python 语法检查
   - `python3 -m py_compile server-py/app/services/webagent_core/*.py`
3. 跨语言兼容检查
   - `cd server-go && go test ./...`
4. 前端消费检查
   - `npm run build`

统一入口：

- Quick: `npm run check:webagent`
- Full: `npm run check:webagent:full`

## E. 最小发布流程（建议）

1. 冻结 contract：更新 reference + release contract
2. 执行门禁命令并记录输出
3. 生成版本说明（contract diff + migration）
4. 打 tag（例如 `webagent-core-v1.0.0`）
5. 发布后验证 demo 与主链路（query + stream + orchestrator）

## F. 非目标（当前阶段）

- 不在 P4-4 强制拆分独立仓库
- 不在 P4-4 强制引入 breaking 的强类型租户 struct
- 不在 P4-4 覆盖全部历史 custom tools 的 adapter 迁移

