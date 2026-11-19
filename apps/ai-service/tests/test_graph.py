import asyncio

from langgraph.checkpoint.memory import InMemorySaver

from ai_service.graph import build_graph, start_loop
from tests.test_loop import FakeTools, cluster


def test_loop_leaves_checkpoints_while_waiting():
    saver = InMemorySaver()
    asyncio.run(start_loop(build_graph(saver, FakeTools({10: [cluster()]})), 1, 10))

    assert len(list(saver.list({"configurable": {"thread_id": "loop-1"}}))) >= 1
