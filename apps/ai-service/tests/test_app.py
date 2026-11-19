import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.test_loop import FakeTools, cluster

DB = os.environ.get("AI_SERVICE_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB, reason="AI_SERVICE_DATABASE_URL 이 없으면 건너뜀")


def client():
    from ai_service.app import app

    app.state.make_tools = lambda job_id, token: FakeTools({1: [cluster()], 2: []})
    return TestClient(app)


def test_health_start_and_resume_over_http():
    job = os.getpid() * 10
    with client() as c:
        assert c.get("/health").json() == {"status": "UP"}
        started = c.post("/loops", json={"jobId": job, "token": "t", "executionId": 1}).json()
        assert started["done"] is False
        assert c.post(f"/loops/{job}/resume", json={"token": "t", "child": {"jobId": 101, "status": "APPLIED"}}).json() == {"ignored": True}
        waiting = c.post(f"/loops/{job}/resume", json={"token": "t", "child": {"jobId": 101, "status": "NEEDS_REVIEW", "iterationsUsed": 1}}).json()
        assert "승인 대기" in waiting["steps"][-1]


def test_loops_survive_dropped_db_connections():
    """postgres 가 재시작되거나 유휴 연결이 끊겨도 다음 요청은 다시 연결해 성공한다 (E-07 재개의 전제)."""
    job = os.getpid() * 10 + 1
    with client() as c:
        assert c.post("/loops", json={"jobId": job, "token": "t", "executionId": 1}).status_code == 200
        with psycopg.connect(DB, autocommit=True) as admin:
            killed = admin.execute(
                "select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = 'ai-service'"
            ).fetchone()[0]
        assert killed >= 1
        reply = c.post(f"/loops/{job}/resume", json={"token": "t", "child": {"jobId": 101, "status": "NEEDS_REVIEW"}})
        assert reply.status_code == 200 and reply.json()["done"] is False
