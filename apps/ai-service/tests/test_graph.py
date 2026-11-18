import asyncio

from langgraph.checkpoint.memory import InMemorySaver

from ai_service.graph import build_graph, run_once


def test_empty_graph_runs_once_and_leaves_checkpoints():
    saver = InMemorySaver()
    # 노드가 MCP 도구(비동기)를 부르게 되므로 그래프는 비동기로 돈다 (E-02)
    result = asyncio.run(run_once(build_graph(saver), "t-1"))

    assert result["steps"] == ["noop"]
    assert len(list(saver.list({"configurable": {"thread_id": "t-1"}}))) >= 1
