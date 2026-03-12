#!/usr/bin/env python3
"""
Kiro IDE 请求抓取工具

使用 mitmproxy 抓取 Kiro IDE 发送到 AWS 的请求。

安装:
    pip install mitmproxy

使用方法:
    1. 运行此脚本: python capture_kiro.py
    2. 设置系统代理为 127.0.0.1:8888
    3. 安装 mitmproxy 的 CA 证书 (访问 http://mitm.it)
    4. 启动 Kiro IDE 并使用
    5. 查看 kiro_requests/ 目录下的抓取结果

或者使用 mitmproxy 命令行:
    mitmproxy --mode regular@8888 -s capture_kiro.py
    
    或者使用 mitmdump (无 UI):
    mitmdump --mode regular@8888 -s capture_kiro.py
"""

import json
import os
from datetime import datetime
from mitmproxy import http, ctx

# 创建输出目录
OUTPUT_DIR = "kiro_requests"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 计数器
request_count = 0

def request(flow: http.HTTPFlow) -> None:
    """处理请求"""
    global request_count
    
    # 只抓取 Kiro/AWS 相关请求
    if "q.us-east-1.amazonaws.com" not in flow.request.host:
        return
    
    request_count += 1
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 保存请求
    request_data = {
        "timestamp": timestamp,
        "method": flow.request.method,
        "url": flow.request.url,
        "headers": dict(flow.request.headers),
        "body": None
    }
    
    # 解析请求体
    if flow.request.content:
        try:
            request_data["body"] = json.loads(flow.request.content.decode('utf-8'))
        except:
            request_data["body_raw"] = flow.request.content.decode('utf-8', errors='replace')
    
    # 保存到文件
    filename = f"{OUTPUT_DIR}/{timestamp}_{request_count:04d}_request.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(request_data, f, indent=2, ensure_ascii=False)
    
    ctx.log.info(f"[Kiro] Captured request #{request_count}: {flow.request.method} {flow.request.path}")


def response(flow: http.HTTPFlow) -> None:
    """处理响应"""
    # 只处理 Kiro/AWS 相关响应
    if "q.us-east-1.amazonaws.com" not in flow.request.host:
        return
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 保存响应
    response_data = {
        "timestamp": timestamp,
        "status_code": flow.response.status_code,
        "headers": dict(flow.response.headers),
        "body": None
    }
    
    # 响应体可能是 event-stream 格式
    if flow.response.content:
        try:
            # 尝试解析为 JSON
            response_data["body"] = json.loads(flow.response.content.decode('utf-8'))
        except:
            # 保存原始内容（可能是 event-stream）
            response_data["body_raw_length"] = len(flow.response.content)
            # 保存前 2000 字节用于调试
            response_data["body_preview"] = flow.response.content[:2000].decode('utf-8', errors='replace')
    
    # 保存到文件
    filename = f"{OUTPUT_DIR}/{timestamp}_{request_count:04d}_response.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(response_data, f, indent=2, ensure_ascii=False)
    
    ctx.log.info(f"[Kiro] Captured response: {flow.response.status_code}")


# 如果直接运行此脚本
if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════════════╗
║           Kiro IDE 请求抓取工具                                    ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  方法 1: 使用 mitmproxy (推荐)                                    ║
║  ─────────────────────────────────────────────────────────────── ║
║  1. 安装: pip install mitmproxy                                  ║
║  2. 运行: mitmproxy -s capture_kiro.py                           ║
║     或:   mitmdump -s capture_kiro.py                            ║
║  3. 设置 Kiro IDE 的代理为 127.0.0.1:8080                         ║
║  4. 安装 CA 证书: 访问 http://mitm.it                             ║
║                                                                  ║
║  方法 2: 使用 Burp Suite                                          ║
║  ─────────────────────────────────────────────────────────────── ║
║  1. 启动 Burp Suite                                              ║
║  2. 设置代理监听 127.0.0.1:8080                                   ║
║  3. 导出 CA 证书并安装到系统                                       ║
║  4. 设置 Kiro IDE 的代理                                          ║
║                                                                  ║
║  方法 3: 直接修改 Kiro IDE (最简单)                                ║
║  ─────────────────────────────────────────────────────────────── ║
║  在 Kiro IDE 的设置中添加:                                        ║
║    "http.proxy": "http://127.0.0.1:8080"                         ║
║                                                                  ║
║  或者设置环境变量:                                                 ║
║    export HTTPS_PROXY=http://127.0.0.1:8080                      ║
║    export HTTP_PROXY=http://127.0.0.1:8080                       ║
║    export NODE_TLS_REJECT_UNAUTHORIZED=0                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
""")
