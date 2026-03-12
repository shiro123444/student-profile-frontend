import json
import asyncio
import httpx
from kiro_proxy.core.state import state
from kiro_proxy.kiro_api import build_headers
from kiro_proxy.config import KIRO_API_URL

async def main():
    # Force load accounts if not loaded (state init does this usually)
    print(f"Loaded {len(state.accounts)} accounts")
    
    # Find account b4e24463 (from user logs)
    target_id = "b4e24463"
    account = next((a for a in state.accounts if a.id.startswith(target_id)), None)
    
    if not account:
        print(f"Account {target_id} not found!")
        # Print available accounts
        for acc in state.accounts:
            print(f"- {acc.id} ({acc.name}): {acc.status}")
        return

    print(f"Testing account: {account.id} ({account.name})")
    
    # Refresh token if needed
    print("Refreshing token...")
    success, msg = await account.refresh_token()
    if not success:
        print(f"Token refresh failed: {msg}")
        return
        
    token = account.get_token()
    creds = account.get_credentials()
    
    headers = build_headers(
        token,
        machine_id=account.get_machine_id(),
        profile_arn=creds.profile_arn if creds else None,
        client_id=creds.client_id if creds else None
    )
    
    # Minimal payload for opus 4.6
    payload = {
        "completionType": "generate_assistant_message",
        "modelId": "claude-opus-4.6",
        "conversationState": {
            "currentMessage": {
                "userInputMessage": {
                    "content": "Hi, please reply with 'Hello' only.",
                    "modelId": "claude-opus-4.6",
                }
            },
            "history": []
        }
    }
    
    print(f"Sending request to {KIRO_API_URL}...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(KIRO_API_URL, json=payload, headers=headers, timeout=30)
            print(f"Status Code: {resp.status_code}")
            print(f"Response Headers: {resp.headers}")
            print(f"Response Body: {resp.text[:1000]}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
