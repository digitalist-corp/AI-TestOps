"""Spring MCP(/internal/ai-jobs/{id}/mcp)에 작업 토큰으로 붙는다. 도구 정의는 Spring 한 곳 — 여기서는 이름으로 부르기만 한다.

E-02 스모크:
    MCP_URL=http://api:8080/internal/ai-jobs/<jobId>/mcp MCP_TOKEN=<콜백 토큰> python -m ai_service.mcp_smoke
토큰 값은 출력하지 않는다.
"""
import asyncio
import os

from langchain_mcp_adapters.client import MultiServerMCPClient


def client(url: str, token: str) -> MultiServerMCPClient:
    return MultiServerMCPClient({
        "playops": {"transport": "streamable_http", "url": url, "headers": {"Authorization": f"Bearer {token}"}},
    })


def _text(result) -> str:
    """어댑터는 글자 하나 또는 내용 조각 목록을 돌려준다. 그래프는 글자(JSON)만 다룬다."""
    if isinstance(result, str):
        return result
    if isinstance(result, (list, tuple)):
        return "".join(part.get("text", "") if isinstance(part, dict) else getattr(part, "text", str(part)) for part in result)
    return str(result)


class McpTools:
    def __init__(self, url: str, token: str):
        self.client = client(url, token)
        self.tools = None

    async def call(self, name: str, args: dict) -> str:
        if self.tools is None:
            self.tools = {tool.name: tool for tool in await self.client.get_tools()}
        return _text(await self.tools[name].ainvoke(args))


async def main() -> None:
    tools = McpTools(os.environ["MCP_URL"], os.environ["MCP_TOKEN"])
    print("list_executions:", (await tools.call("list_executions", {}))[:600])
    print("tools:", sorted(tools.tools))


if __name__ == "__main__":
    asyncio.run(main())
