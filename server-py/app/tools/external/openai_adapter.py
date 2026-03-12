"""OpenAI external MCP adapter.

Provides direct external MCP tool execution for OpenAI-compatible agent chain.
Supported transports:
- stdio: local subprocess with MCP framing
- http: streamable HTTP JSON-RPC endpoint
- sse: legacy SSE endpoint + message endpoint flow
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from itertools import count
from typing import Any
from urllib.parse import urljoin

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class OpenAIExternalMcpAdapter:
    """Execute external MCP tools for OpenAI engine."""

    def __init__(self):
        self._timeout_sec = max(5, int(getattr(settings, "external_mcp_openai_timeout_sec", 45)))
        self._request_ids = count(1)

    async def call_tool(self, local_tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Call an external MCP tool by local registry name."""
        from app.tools.external import get_external_mcp_manager
        from app.tools.registry import get_registry

        registry = get_registry()
        mcp_ref = registry.get_mcp_tool_ref(local_tool_name)
        if not mcp_ref:
            return self._error(f"Tool '{local_tool_name}' not registered in MCP map")

        parts = mcp_ref.split("__", 2)
        if len(parts) != 3:
            return self._error(f"Invalid MCP tool ref for '{local_tool_name}': {mcp_ref}")

        server_name = parts[1]
        remote_tool_name = parts[2]
        if server_name == "pathmind":
            return self._error(f"Tool '{local_tool_name}' is internal, not external")

        server_cfg = get_external_mcp_manager().get_claude_mcp_servers().get(server_name)
        if not isinstance(server_cfg, dict):
            return self._error(f"External MCP server '{server_name}' config not available")

        transport = str(server_cfg.get("type") or "stdio").lower()

        try:
            if transport == "stdio":
                return await self._call_stdio_tool(
                    server_name=server_name,
                    tool_name=remote_tool_name,
                    tool_args=args or {},
                    command=str(server_cfg.get("command") or "").strip(),
                    cmd_args=[str(x) for x in (server_cfg.get("args") or [])],
                    env=self._build_env(server_cfg.get("env")),
                )

            if transport == "http":
                return await self._call_http_tool(
                    server_name=server_name,
                    tool_name=remote_tool_name,
                    tool_args=args or {},
                    url=str(server_cfg.get("url") or "").strip(),
                    headers=self._normalize_headers(server_cfg.get("headers")),
                )

            if transport == "sse":
                return await self._call_sse_tool(
                    server_name=server_name,
                    tool_name=remote_tool_name,
                    tool_args=args or {},
                    url=str(server_cfg.get("url") or "").strip(),
                    headers=self._normalize_headers(server_cfg.get("headers")),
                )

            return self._error(
                f"External MCP server '{server_name}' uses unsupported transport '{transport}'"
            )
        except Exception as exc:
            logger.exception(
                "OpenAI external MCP call failed: server=%s tool=%s transport=%s",
                server_name,
                remote_tool_name,
                transport,
            )
            return self._error(
                f"External MCP call failed ({server_name}.{remote_tool_name}): {exc}"
            )

    async def _call_stdio_tool(
        self,
        server_name: str,
        tool_name: str,
        tool_args: dict[str, Any],
        command: str,
        cmd_args: list[str],
        env: dict[str, str],
    ) -> dict[str, Any]:
        if not command:
            return self._error(f"External MCP server '{server_name}' missing command")

        proc = await asyncio.create_subprocess_exec(
            command,
            *cmd_args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        if proc.stdin is None or proc.stdout is None:
            return self._error(f"Failed to initialize stdio pipes for MCP server '{server_name}'")

        try:
            init_payload, init_id = self._build_request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "clientInfo": {
                        "name": "pathmind-openai-external-adapter",
                        "version": "0.1.0",
                    },
                    "capabilities": {},
                },
            )
            init_response = await self._send_request(proc.stdin, proc.stdout, init_payload, init_id)
            if init_response.get("error"):
                return self._error(self._rpc_error_text(server_name, "initialize", init_response["error"]))

            await self._send_notification(
                proc.stdin,
                self._build_notification("notifications/initialized", {}),
            )

            tool_payload, tool_id = self._build_request(
                "tools/call",
                {
                    "name": tool_name,
                    "arguments": tool_args,
                },
            )
            response = await self._send_request(proc.stdin, proc.stdout, tool_payload, tool_id)

            if response.get("error"):
                return self._error(self._rpc_error_text(server_name, tool_name, response["error"]))

            return self._normalize_tool_result(server_name, tool_name, response.get("result"))
        finally:
            await self._shutdown_process(proc)

    async def _call_http_tool(
        self,
        server_name: str,
        tool_name: str,
        tool_args: dict[str, Any],
        url: str,
        headers: dict[str, str],
    ) -> dict[str, Any]:
        if not url:
            return self._error(f"External MCP HTTP server '{server_name}' missing url")

        session_headers = dict(headers)
        session_headers.setdefault("Content-Type", "application/json")
        session_headers.setdefault("Accept", "application/json, text/event-stream")

        async with httpx.AsyncClient(timeout=httpx.Timeout(self._timeout_sec), follow_redirects=True) as client:
            init_payload, init_id = self._build_request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "clientInfo": {
                        "name": "pathmind-openai-external-adapter",
                        "version": "0.1.0",
                    },
                    "capabilities": {},
                },
            )
            init_response, init_meta = await self._post_jsonrpc(
                client=client,
                url=url,
                headers=session_headers,
                payload=init_payload,
                request_id=init_id,
            )
            self._apply_session_header(session_headers, init_meta)

            if init_response is None:
                return self._error(f"MCP initialize no response from server '{server_name}'")
            if init_response.get("error"):
                return self._error(self._rpc_error_text(server_name, "initialize", init_response["error"]))

            notify_payload = self._build_notification("notifications/initialized", {})
            await self._post_jsonrpc(
                client=client,
                url=url,
                headers=session_headers,
                payload=notify_payload,
                request_id=None,
            )

            tool_payload, tool_id = self._build_request(
                "tools/call",
                {
                    "name": tool_name,
                    "arguments": tool_args,
                },
            )
            response, _ = await self._post_jsonrpc(
                client=client,
                url=url,
                headers=session_headers,
                payload=tool_payload,
                request_id=tool_id,
            )

            if response is None:
                return self._error(f"MCP tools/call no response from server '{server_name}'")
            if response.get("error"):
                return self._error(self._rpc_error_text(server_name, tool_name, response["error"]))

            return self._normalize_tool_result(server_name, tool_name, response.get("result"))

    async def _call_sse_tool(
        self,
        server_name: str,
        tool_name: str,
        tool_args: dict[str, Any],
        url: str,
        headers: dict[str, str],
    ) -> dict[str, Any]:
        if not url:
            return self._error(f"External MCP SSE server '{server_name}' missing url")

        get_headers = dict(headers)
        get_headers["Accept"] = "text/event-stream"

        post_headers = dict(headers)
        post_headers.setdefault("Content-Type", "application/json")
        post_headers.setdefault("Accept", "application/json, text/event-stream")

        async with httpx.AsyncClient(timeout=httpx.Timeout(self._timeout_sec), follow_redirects=True) as client:
            async with client.stream("GET", url, headers=get_headers) as sse_resp:
                if sse_resp.status_code >= 400:
                    body = await sse_resp.aread()
                    return self._error(
                        f"SSE connect failed ({server_name}): {sse_resp.status_code} {body[:200]!r}"
                    )

                ctype = sse_resp.headers.get("content-type", "").lower()
                if "text/event-stream" not in ctype:
                    body = await sse_resp.aread()
                    return self._error(
                        f"SSE connect invalid content-type ({server_name}): {ctype}, body={body[:160]!r}"
                    )

                endpoint_future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
                message_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

                consume_task = asyncio.create_task(
                    self._consume_sse_stream(sse_resp, endpoint_future, message_queue)
                )

                try:
                    endpoint_path = await asyncio.wait_for(endpoint_future, timeout=self._timeout_sec)
                    message_url = urljoin(url, endpoint_path)

                    init_payload, init_id = self._build_request(
                        "initialize",
                        {
                            "protocolVersion": "2024-11-05",
                            "clientInfo": {
                                "name": "pathmind-openai-external-adapter",
                                "version": "0.1.0",
                            },
                            "capabilities": {},
                        },
                    )
                    init_response, init_meta = await self._post_jsonrpc(
                        client=client,
                        url=message_url,
                        headers=post_headers,
                        payload=init_payload,
                        request_id=init_id,
                        fallback_queue=message_queue,
                    )
                    self._apply_session_header(post_headers, init_meta)

                    if init_response is None:
                        return self._error(f"MCP initialize no response from SSE server '{server_name}'")
                    if init_response.get("error"):
                        return self._error(
                            self._rpc_error_text(server_name, "initialize", init_response["error"])
                        )

                    await self._post_jsonrpc(
                        client=client,
                        url=message_url,
                        headers=post_headers,
                        payload=self._build_notification("notifications/initialized", {}),
                        request_id=None,
                        fallback_queue=message_queue,
                    )

                    tool_payload, tool_id = self._build_request(
                        "tools/call",
                        {
                            "name": tool_name,
                            "arguments": tool_args,
                        },
                    )
                    response, _ = await self._post_jsonrpc(
                        client=client,
                        url=message_url,
                        headers=post_headers,
                        payload=tool_payload,
                        request_id=tool_id,
                        fallback_queue=message_queue,
                    )

                    if response is None:
                        return self._error(
                            f"MCP tools/call no response from SSE server '{server_name}'"
                        )
                    if response.get("error"):
                        return self._error(
                            self._rpc_error_text(server_name, tool_name, response["error"])
                        )

                    return self._normalize_tool_result(server_name, tool_name, response.get("result"))
                finally:
                    consume_task.cancel()
                    try:
                        await consume_task
                    except asyncio.CancelledError:
                        pass

    def _build_env(self, value: Any) -> dict[str, str]:
        env = dict(os.environ)
        if isinstance(value, dict):
            env.update({str(k): str(v) for k, v in value.items()})
        return env

    def _normalize_headers(self, value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        return {str(k): str(v) for k, v in value.items()}

    def _build_request(self, method: str, params: dict[str, Any]) -> tuple[dict[str, Any], str]:
        request_id = f"pm-{next(self._request_ids)}"
        payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }
        return payload, request_id

    def _build_notification(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }

    async def _send_request(
        self,
        stdin: asyncio.StreamWriter,
        stdout: asyncio.StreamReader,
        payload: dict[str, Any],
        request_id: str,
    ) -> dict[str, Any]:
        await self._write_message(stdin, payload)

        while True:
            msg = await asyncio.wait_for(self._read_message(stdout), timeout=self._timeout_sec)
            if str(msg.get("id")) == str(request_id) and ("result" in msg or "error" in msg):
                return msg

    async def _send_notification(
        self,
        stdin: asyncio.StreamWriter,
        payload: dict[str, Any],
    ) -> None:
        await self._write_message(stdin, payload)

    async def _write_message(self, stdin: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii")
        stdin.write(header + raw)
        await stdin.drain()

    async def _read_message(self, stdout: asyncio.StreamReader) -> dict[str, Any]:
        first = await stdout.readline()
        if not first:
            raise EOFError("MCP server closed stdout")

        if first.lstrip().startswith(b"{"):
            return json.loads(first.decode("utf-8"))

        headers: dict[str, str] = {}
        line = first
        while True:
            if line in (b"\r\n", b"\n"):
                break

            text = line.decode("utf-8", errors="replace").strip()
            if ":" in text:
                key, value = text.split(":", 1)
                headers[key.strip().lower()] = value.strip()

            line = await stdout.readline()
            if not line:
                raise EOFError("Unexpected EOF while reading MCP headers")

        content_length = int(headers.get("content-length") or "0")
        if content_length <= 0:
            raise ValueError("Invalid MCP Content-Length")

        body = await stdout.readexactly(content_length)
        return json.loads(body.decode("utf-8"))

    async def _post_jsonrpc(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        request_id: str | None,
        fallback_queue: asyncio.Queue[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any] | None, dict[str, str]]:
        response_headers: dict[str, str] = {}

        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            response_headers = {k.lower(): v for k, v in resp.headers.items()}
            status = resp.status_code
            ctype = resp.headers.get("content-type", "").lower()

            if status >= 400:
                body = await resp.aread()
                raise RuntimeError(f"HTTP {status}: {body[:300]!r}")

            if "application/json" in ctype:
                body = await resp.aread()
                if not body:
                    return None, response_headers
                decoded = json.loads(body.decode("utf-8"))
                if request_id and str(decoded.get("id")) == str(request_id):
                    return decoded, response_headers
                if request_id is None:
                    return decoded, response_headers

            elif "text/event-stream" in ctype:
                if request_id is not None:
                    streamed = await self._read_sse_response_for_request(resp, request_id)
                    if streamed is not None:
                        return streamed, response_headers

            else:
                body = await resp.aread()
                if body:
                    try:
                        decoded = json.loads(body.decode("utf-8"))
                    except json.JSONDecodeError:
                        decoded = None
                    if isinstance(decoded, dict):
                        if request_id and str(decoded.get("id")) == str(request_id):
                            return decoded, response_headers
                        if request_id is None:
                            return decoded, response_headers

        if request_id and fallback_queue is not None:
            queued = await self._wait_sse_queue_response(fallback_queue, request_id)
            return queued, response_headers

        return None, response_headers

    def _apply_session_header(self, headers: dict[str, str], response_headers: dict[str, str]) -> None:
        session_id = response_headers.get("mcp-session-id")
        if session_id:
            headers["Mcp-Session-Id"] = session_id

    async def _read_sse_response_for_request(
        self,
        response: httpx.Response,
        request_id: str,
    ) -> dict[str, Any] | None:
        async for event_name, data in self._iter_sse_events(response):
            if event_name not in {"", "message"}:
                continue
            message = self._parse_sse_json(data)
            if message is None:
                continue
            if str(message.get("id")) == str(request_id):
                return message
        return None

    async def _consume_sse_stream(
        self,
        response: httpx.Response,
        endpoint_future: asyncio.Future[str],
        message_queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        try:
            async for event_name, data in self._iter_sse_events(response):
                if event_name == "endpoint":
                    endpoint = data.strip()
                    if endpoint and not endpoint_future.done():
                        endpoint_future.set_result(endpoint)
                    continue

                if event_name in {"", "message"}:
                    message = self._parse_sse_json(data)
                    if message is not None:
                        await message_queue.put(message)
        except Exception as exc:
            logger.debug("SSE stream consumer stopped: %s", exc)
            if not endpoint_future.done():
                endpoint_future.set_exception(exc)
        finally:
            if not endpoint_future.done():
                endpoint_future.set_exception(RuntimeError("SSE stream closed before endpoint event"))
            await message_queue.put({"_stream_closed": True})

    async def _iter_sse_events(self, response: httpx.Response):
        event_name = "message"
        data_lines: list[str] = []

        async for raw in response.aiter_lines():
            line = raw.rstrip("\r")
            if line == "":
                if data_lines:
                    yield event_name, "\n".join(data_lines)
                event_name = "message"
                data_lines = []
                continue

            if line.startswith(":"):
                continue

            if line.startswith("event:"):
                event_name = line[6:].strip() or "message"
                continue

            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
                continue

        if data_lines:
            yield event_name, "\n".join(data_lines)

    async def _wait_sse_queue_response(
        self,
        queue: asyncio.Queue[dict[str, Any]],
        request_id: str,
    ) -> dict[str, Any]:
        stash: list[dict[str, Any]] = []

        try:
            while True:
                message = await asyncio.wait_for(queue.get(), timeout=self._timeout_sec)

                if message.get("_stream_closed"):
                    raise RuntimeError("SSE stream closed before response")

                if str(message.get("id")) == str(request_id):
                    return message

                stash.append(message)
        finally:
            for item in stash:
                queue.put_nowait(item)

    def _parse_sse_json(self, data: str) -> dict[str, Any] | None:
        payload = (data or "").strip()
        if not payload:
            return None
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            logger.debug("Ignore non-JSON SSE payload: %r", payload[:120])
            return None
        if not isinstance(decoded, dict):
            return None
        return decoded

    async def _shutdown_process(self, proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is not None:
            return

        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=1.5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    def _rpc_error_text(self, server_name: str, method: str, error: Any) -> str:
        if isinstance(error, dict):
            code = error.get("code")
            message = error.get("message")
            data = error.get("data")
            if data is not None:
                return f"MCP error ({server_name}.{method}) code={code} msg={message} data={data}"
            return f"MCP error ({server_name}.{method}) code={code} msg={message}"
        return f"MCP error ({server_name}.{method}): {error}"

    def _normalize_tool_result(
        self,
        server_name: str,
        tool_name: str,
        result: Any,
    ) -> dict[str, Any]:
        if isinstance(result, dict):
            content = result.get("content")
            is_error = bool(result.get("isError") or result.get("is_error"))
            if isinstance(content, list):
                return {
                    "content": content,
                    "is_error": is_error,
                }

        text = json.dumps(result, ensure_ascii=False)
        return {
            "content": [
                {
                    "type": "text",
                    "text": text,
                }
            ],
            "is_error": False,
            "meta": {
                "server": server_name,
                "tool": tool_name,
            },
        }

    def _error(self, message: str) -> dict[str, Any]:
        return {
            "content": [{"type": "text", "text": message}],
            "is_error": True,
        }


_adapter: OpenAIExternalMcpAdapter | None = None


def get_openai_external_adapter() -> OpenAIExternalMcpAdapter:
    """Get singleton adapter for OpenAI engine external MCP calls."""
    global _adapter
    if _adapter is None:
        _adapter = OpenAIExternalMcpAdapter()
    return _adapter
