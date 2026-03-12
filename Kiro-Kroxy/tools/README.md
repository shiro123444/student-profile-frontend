# 开发工具

## 文件说明

### capture_kiro.py
Kiro IDE 请求抓取工具，使用 mitmproxy 抓取和分析请求。

**使用方法：**
```bash
# 安装 mitmproxy
pip install mitmproxy

# 运行抓取工具
python tools/capture_kiro.py

# 或使用 mitmproxy 命令行
mitmproxy --mode regular@8888 -s tools/capture_kiro.py
```

**配置：**
1. 设置系统代理为 127.0.0.1:8888
2. 安装 mitmproxy CA 证书（访问 http://mitm.it）
3. 启动 Kiro IDE 并使用
4. 查看抓取结果

### get_models.py
获取 Kiro API 可用模型列表。

**使用方法：**
```bash
python tools/get_models.py
```

### proxy_server.py
测试用的简单代理服务器。

**使用方法：**
```bash
python tools/proxy_server.py
```

### kiro_proxy.py
旧版代理实现，保留用于参考。

## 注意事项

- 这些工具仅用于开发和调试
- 不要在生产环境使用
- 抓包工具可能包含敏感信息，注意保护

## 相关文档

- [docs/CAPTURE_GUIDE.md](../docs/CAPTURE_GUIDE.md) - 抓包详细指南
