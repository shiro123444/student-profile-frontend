# 测试文件

## 文件说明

- `test_kiro_proxy.py` - 主程序功能测试
- `test_proxy.py` - 代理功能测试

## 运行测试

```bash
# 激活虚拟环境
source venv/bin/activate  # Windows: venv\Scripts\activate

# 运行所有测试
python -m pytest tests/

# 运行单个测试文件
python -m pytest tests/test_kiro_proxy.py

# 详细输出
python -m pytest tests/ -v
```

## 测试覆盖

目前主要依赖手动测试：

1. 启动服务
2. 测试各个 API 端点
3. 测试 Web UI
4. 测试客户端集成

## 待完善

- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能测试
- [ ] 压力测试
