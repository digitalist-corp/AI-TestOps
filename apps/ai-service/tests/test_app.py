import os

import psycopg
import pytest
from fastapi.testclient import TestClient

DB = os.environ.get("AI_SERVICE_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB, reason="AI_SERVICE_DATABASE_URL 이 없으면 건너뜀")


def test_health_and_one_run_per_request():
    from ai_service.app import app

    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "UP"}
        a = client.post("/runs").json()
        b = client.post("/runs").json()

    assert a["threadId"] != b["threadId"]
    assert a["steps"] == ["noop"]
    assert a["checkpoints"] >= 1


def test_runs_survive_dropped_db_connections():
    """postgres 가 재시작되거나 유휴 연결이 끊겨도 다음 요청은 다시 연결해 성공한다 (E-07 재개의 전제)."""
    from ai_service.app import app

    with TestClient(app) as client:
        assert client.post("/runs").status_code == 200
        with psycopg.connect(DB, autocommit=True) as admin:
            killed = admin.execute(
                "select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = 'ai-service'"
            ).fetchone()[0]
        assert killed >= 1
        assert client.post("/runs").status_code == 200
