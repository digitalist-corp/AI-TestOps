"""E-02 스모크: 작업 토큰으로 Spring MCP(/internal/ai-jobs/{id}/mcp)에 붙어 도구 목록을 받고 list_executions 를 부른다.

    MCP_URL=http://api:8080/internal/ai-jobs/<jobId>/mcp MCP_TOKEN=<콜백 토큰> python -m ai_service.mcp_smoke

도구 정의는 Spring 한 곳이다 — 여기서는 이름으로 찾아 부르기만 한다. 토큰 값은 출력하지 않는다.
"""
import asyncio
import os

from langchain_mcp_adapters.client import MultiServerMCPClient


def client(url: str, token: str) -> MultiServerMCPClient:
    return MultiServerMCPClient({
        "playops": {"transport": "streamable_http", "url": url, "headers": {"Authorization": f"Bearer {token}"}},
    })


async def call_tool(url: str, token: str, name: str, args: dict) -> str:
    tools = {tool.name: tool for tool in await client(url, token).get_tools()}
    return await tools[name].ainvoke(args)


async def main() -> None:
    url, token = os.environ["MCP_URL"], os.environ["MCP_TOKEN"]
    tools = await client(url, token).get_tools()
    print("tools:", sorted(tool.name for tool in tools))
    result = await call_tool(url, token, "list_executions", {})
    print("list_executions:", str(result)[:600])


if __name__ == "__main__":
    asyncio.run(main())
