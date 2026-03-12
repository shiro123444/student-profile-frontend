"""Quick diagnostic for AnthropicDirectEngine stream cascade."""
import asyncio, logging, time, json, os, sys
os.chdir(os.path.dirname(__file__))

logging.basicConfig(level=logging.WARNING)

from app.engines.anthropic_engine import AnthropicDirectEngine, _FIRST_BYTE_TIMEOUT_SEC
print('first_byte_timeout:', _FIRST_BYTE_TIMEOUT_SEC, flush=True)

engine = AnthropicDirectEngine(model_tier='sonnet')
print('fallback_models:', engine._fallback_models, flush=True)


async def main():
    t = time.time()
    chunks = []
    async for chunk in engine.stream(
        prompt='reply with OK only',
        system='You are a helpful assistant.',
        tools=[],
        agent_name='test',
    ):
        elapsed = round(time.time() - t, 2)
        obj = json.loads(chunk)
        print(f't={elapsed} type={obj.get("type")} preview={str(obj)[:120]}', flush=True)
        chunks.append(obj)
        if obj.get('type') == 'done':
            break
    print('total elapsed:', round(time.time() - t, 2), flush=True)


asyncio.run(main())
