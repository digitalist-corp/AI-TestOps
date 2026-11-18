import os

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(not os.environ.get("AI_SERVICE_DATABASE_URL"), reason="AI_SERVICE_DATABASE_URL 이 없으면 건너뜀")


def test_health_and_one_run_per_request():
    from ai_service.app import app

    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "UP"}
        a = client.post("/runs").json()
        b = client.post("/runs").json()

    assert a["threadId"] != b["threadId"]
    assert a["steps"] == ["noop"]
    assert a["checkpoints"] >= 1
