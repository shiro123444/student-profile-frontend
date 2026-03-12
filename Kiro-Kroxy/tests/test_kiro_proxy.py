#!/usr/bin/env python3
"""测试 Kiro 反向代理"""

import requests
import json

PROXY_URL = "http://127.0.0.1:8000"

def test_health():
    print("1. 测试健康检查...")
    r = requests.get(f"{PROXY_URL}/")
    print(f"   ✅ {r.json()}")

def test_token():
    print("\n2. 检查 Token 状态...")
    r = requests.get(f"{PROXY_URL}/token/status")
    data = r.json()
    if data.get("valid"):
        print(f"   ✅ Token 有效，过期时间: {data.get('expires_at')}")
    else:
        print(f"   ❌ Token 无效: {data.get('error')}")

def test_models():
    print("\n3. 列出可用模型...")
    r = requests.get(f"{PROXY_URL}/v1/models")
    models = r.json().get("data", [])
    for m in models:
        print(f"   - {m['id']}")

def test_chat():
    print("\n4. 测试聊天接口...")
    r = requests.post(
        f"{PROXY_URL}/v1/chat/completions",
        json={
            "model": "claude-sonnet-4",
            "messages": [
                {"role": "user", "content": "说一句话测试"}
            ]
        },
        timeout=60
    )
    
    if r.status_code == 200:
        data = r.json()
        content = data["choices"][0]["message"]["content"]
        print(f"   ✅ AI 回复: {content[:200]}...")
    else:
        print(f"   ❌ 错误 {r.status_code}: {r.text}")

if __name__ == "__main__":
    print("=" * 50)
    print("Kiro 反向代理测试")
    print("=" * 50)
    
    try:
        test_health()
        test_token()
        test_models()
        test_chat()
        print("\n" + "=" * 50)
        print("测试完成")
        print("=" * 50)
    except requests.exceptions.ConnectionError:
        print("\n❌ 连接失败！请先启动代理服务器:")
        print("   source venv/bin/activate")
        print("   python kiro_proxy.py")
