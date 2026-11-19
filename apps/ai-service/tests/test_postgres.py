import asyncio
import os

import psycopg
import pytest

from ai_service.checkpoint import open_saver
from ai_service.graph import build_graph, resume_loop, start_loop
from tests.test_loop import FakeTools, child, cluster

DB = os.environ.get("AI_SERVICE_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB, reason="AI_SERVICE_DATABASE_URL 이 없으면 건너뜀")


@pytest.fixture
def schema():
    name = f"langgraph_test_{os.getpid()}"
    yield name
    with psycopg.connect(DB, autocommit=True) as conn:
        conn.execute(f"DROP SCHEMA IF EXISTS {name} CASCADE")


def tables_in(schema_name):
    with psycopg.connect(DB) as conn:
        return {r[0] for r in conn.execute(
            "select table_name from information_schema.tables where table_schema = %s", (schema_name,))}


async def count(saver, thread_id):
    return len([c async for c in saver.alist({"configurable": {"thread_id": thread_id}})])


def test_checkpoints_land_in_their_own_schema(schema):
    async def scenario():
        async with open_saver(DB, schema) as saver:
            await start_loop(build_graph(saver, FakeTools({10: [cluster()]})), 1, 10)
            return await count(saver, "loop-1")

    assert asyncio.run(scenario()) >= 1
    assert "checkpoints" in tables_in(schema)
    assert "checkpoints" not in tables_in("public")


def test_waiting_loop_resumes_after_a_restart(schema):
    """E-07: 승인을 기다리는 중에 ai-service 가 재시작돼도(saver · 그래프를 새로 만듦) 재개하면 이어진다."""
    tools = {10: [cluster()], 11: []}

    async def before_restart():
        async with open_saver(DB, schema) as saver:
            graph = build_graph(saver, FakeTools(tools))
            await start_loop(graph, 5, 10)
            return await resume_loop(graph, 5, child(101, "NEEDS_REVIEW"))

    async def after_restart():
        async with open_saver(DB, schema) as saver:
            return await resume_loop(build_graph(saver, FakeTools(tools)), 5,
                                     child(101, "APPLIED", verification="PASSED", execution=11, reviewed_by=1))

    waiting = asyncio.run(before_restart())
    assert waiting["done"] is False and "승인 대기" in waiting["steps"][-1]
    resumed = asyncio.run(after_restart())
    assert resumed["done"] is True and resumed["outcome"] == "PASSED"
    assert resumed["steps"][:len(waiting["steps"])] == waiting["steps"]
