#!/usr/bin/env python3
"""获取 Kiro 支持的模型列表"""

import json
import uuid
import httpx
from pathlib import Path

TOKEN_PATH = Path.home() / ".aws/sso/cache/kiro-auth-token.json"
MACHINE_ID = "fa41d5def91e29225c73f6ea8ee0941a87bd812aae5239e3dde72c3ba7603a26"
MODELS_URL = "https://q.us-east-1.amazonaws.com/ListAvailableModels"

def get_token():
    with open(TOKEN_PATH) as f:
        return json.load(f).get("accessToken", "")

def get_models():
    token = get_token()
    headers = {
        "content-type": "application/json",
        "x-amz-user-agent": f"aws-sdk-js/1.0.27 KiroIDE-0.8.0-{MACHINE_ID}",
        "amz-sdk-invocation-id": str(uuid.uuid4()),
        "Authorization": f"Bearer {token}",
    }
    
    # 尝试不同的参数
    params = {"origin": "AI_EDITOR"}
    
    with httpx.Client(verify=False, timeout=30) as client:
        resp = client.get(MODELS_URL, headers=headers, params=params)
        print(f"Status: {resp.status_code}")
        print(f"Headers: {dict(resp.headers)}")
        print(f"\nRaw response ({len(resp.content)} bytes):")
        
        # 尝试解析
        try:
            data = resp.json()
            print(json.dumps(data, indent=2, ensure_ascii=False))
        except:
            # 可能是 event-stream 格式
            print(resp.content[:2000])

if __name__ == "__main__":
    get_models()
