#!/usr/bin/env python3
"""测试反向代理是否正常工作"""

import requests
import json

PROXY_URL = "http://127.0.0.1:8000"

def test_health():
    """测试健康检查"""
    print("1. 测试健康检查...")
    r = requests.get(f"{PROXY_URL}/")
    print(f"   ✅ {r.json()}")

def test_chat():
    """测试聊天接口"""
    print("\n2. 测试聊天接口...")
    r = requests.post(
        f"{PROXY_URL}/v1/chat/completions",
        json={
            "model": "test",
            "messages": [{"role": "user", "content": "Hello"}]
        }
    )
    print(f"   ✅ {r.json()['choices'][0]['message']['content']}")

def test_catch_all():
    """测试通用捕获"""
    print("\n3. 测试任意路径捕获...")
    r = requests.post(
        f"{PROXY_URL}/api/v1/some/kiro/endpoint",
        json={"test": "data"}
    )
    print(f"   ✅ {r.json()['message']}")

def test_auth():
    """测试认证端点"""
    print("\n4. 测试认证端点...")
    r = requests.post(f"{PROXY_URL}/auth/login")
    print(f"   ✅ Token: {r.json()['token']}")

def view_logs():
    """查看日志"""
    print("\n5. 查看捕获的请求日志...")
    r = requests.get(f"{PROXY_URL}/logs")
    data = r.json()
    print(f"   ✅ 共捕获 {data['total']} 个请求")

if __name__ == "__main__":
    print("=" * 50)
    print("Kiro 反向代理测试")
    print("=" * 50)
    
    try:
        test_health()
        test_chat()
        test_catch_all()
        test_auth()
        view_logs()
        print("\n" + "=" * 50)
        print("✅ 所有测试通过！反向代理工作正常")
        print("=" * 50)
    except requests.exceptions.ConnectionError:
        print("\n❌ 连接失败！请先启动代理服务器:")
        print("   python proxy_server.py")
