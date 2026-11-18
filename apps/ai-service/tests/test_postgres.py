import os

import psycopg
import pytest

from ai_service.checkpoint import open_saver
from ai_service.graph import build_graph, run_once

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


def test_checkpoints_land_in_their_own_schema_and_accumulate(schema):
    with open_saver(DB, schema) as saver:
        graph = build_graph(saver)
        run_once(graph, "t-pg")
        first = len(list(saver.list({"configurable": {"thread_id": "t-pg"}})))
        run_once(graph, "t-pg")
        second = len(list(saver.list({"configurable": {"thread_id": "t-pg"}})))

    assert first >= 1
    assert second > first
    assert "checkpoints" in tables_in(schema)
    assert "checkpoints" not in tables_in("public")
