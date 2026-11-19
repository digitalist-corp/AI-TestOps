"""E-06 · E-07 · E-09: 학습 루프 그래프. 도구(MCP)는 가짜로 대신한다."""
import asyncio
import json

from langgraph.checkpoint.memory import InMemorySaver

from ai_service.graph import build_graph, resume_loop, start_loop

CLICK = {
    "signature": "aaaaaaaaaaaa", "head": "expect(locator).toBeVisible() failed",
    "locator": "getByRole('link', { name: '문의하기' })", "specPath": "demo.spec.ts",
    "cause": "SCRIPT_ERROR", "causeSource": "RULE", "summary": "'문의하기' 링크를 찾지 못했습니다",
    "count": 1, "cases": ["문의하기 링크가 보인다"], "sampleError": "...", "pastFixes": 0, "recalled": [],
}
PAST = {"aiJobId": 3, "specPath": "tests/demo.spec.ts", "cause": "SCRIPT_ERROR", "head": "...", "locator": "...",
        "diff": "-  name: '문의하기'\n+  name: 'Learn more'", "createdAt": "2026-11-19T00:00:00Z"}


def cluster(count=1, **kw):
    return {**CLICK, "count": count, **kw}


class FakeTools:
    """list_failure_clusters 는 실행 번호별로 정해 둔 묶음을, start_code_fix 는 새 작업 번호를 돌려준다."""

    def __init__(self, clusters):
        self.clusters = clusters
        self.fixes = []

    async def call(self, name, args):
        if name == "list_failure_clusters":
            return json.dumps(self.clusters[args["executionId"]])
        if name == "start_code_fix":
            self.fixes.append(args)
            return json.dumps({"jobId": 100 + len(self.fixes), "targetSpecPath": "tests/demo.spec.ts"})
        raise AssertionError(name)


def child(job_id, status, iterations=1, verification=None, execution=None, reviewed_by=None):
    return {"jobId": job_id, "status": status, "iterationsUsed": iterations, "reviewedBy": reviewed_by,
            "verificationStatus": verification, "verificationExecutionId": execution}


class Loop:
    def __init__(self, clusters, job_id=7):
        self.tools = FakeTools(clusters)
        self.graph = build_graph(InMemorySaver(), self.tools)
        self.job_id = job_id

    def start(self, execution_id=10):
        return asyncio.run(start_loop(self.graph, self.job_id, execution_id))

    def resume(self, snapshot):
        return asyncio.run(resume_loop(self.graph, self.job_id, snapshot))


def test_one_round_recalls_past_fix_waits_for_approval_and_passes_on_rerun():
    loop = Loop({10: [cluster(pastFixes=1, recalled=[PAST])], 11: []})

    started = loop.start()
    assert started["done"] is False
    assert "과거 수정 1건 참고" in started["steps"][0]
    fix = loop.tools.fixes[0]
    assert fix["executionId"] == 10 and fix["specPath"] == "demo.spec.ts"
    assert "+  name: 'Learn more'" in fix["instruction"]  # 승인됐던 수정이 예시로 들어간다

    waiting = loop.resume(child(101, "NEEDS_REVIEW", iterations=2))
    assert waiting["done"] is False
    assert "승인 대기" in waiting["steps"][-1]

    passed = loop.resume(child(101, "APPLIED", verification="PASSED", execution=11, reviewed_by=1))
    assert passed["done"] is True
    assert passed["outcome"] == "PASSED"
    assert passed["round"] == 1
    assert "재실행 실패 1 → 0건" in "\n".join(passed["steps"])


def test_resume_that_does_not_match_the_wait_is_ignored():
    loop = Loop({10: [cluster()], 11: []})
    loop.start()

    assert loop.resume(child(101, "APPLIED", verification="PASSED", execution=11)) == {"ignored": True}
    assert loop.resume(child(999, "NEEDS_REVIEW")) == {"ignored": True}
    assert loop.resume(child(101, "NEEDS_REVIEW"))["done"] is False
    assert loop.resume(child(101, "NEEDS_REVIEW")) == {"ignored": True}  # 같은 이벤트가 두 번 와도 한 번만
    assert loop.resume(child(101, "APPLIED", verification="PASSED", execution=11))["done"] is True
    assert loop.resume(child(101, "APPLIED", verification="PASSED", execution=11)) == {"ignored": True}


def test_environment_or_product_defect_is_handed_to_a_person_without_a_fix():
    for cause in ("ENVIRONMENT", "PRODUCT_DEFECT"):
        loop = Loop({10: [cluster(cause=cause)]})
        reply = loop.start()
        assert reply["done"] is True and reply["outcome"] == "STOPPED"
        assert loop.tools.fixes == []
        assert "사람에게" in reply["steps"][-1]


def test_human_rejection_stops_the_loop():
    loop = Loop({10: [cluster()]})
    loop.start()
    loop.resume(child(101, "NEEDS_REVIEW"))
    reply = loop.resume(child(101, "REJECTED", reviewed_by=1))
    assert reply["done"] is True and reply["outcome"] == "REJECTED"


def test_two_rounds_without_progress_stop():
    loop = Loop({10: [cluster()]})
    loop.start()
    # 러너가 격리 사본에서 못 고쳤다 → 사람에게 안 가고 다음 바퀴
    second = loop.resume(child(101, "REJECTED"))
    assert second["done"] is False and second["round"] == 2
    assert "사람에게 보내지 않음" in "\n".join(second["steps"])
    reply = loop.resume(child(102, "FAILED"))
    assert reply["done"] is True and reply["outcome"] == "STOPPED"
    assert "두 번 연속 진전 없음" in reply["steps"][-1]


def test_stops_after_three_rounds_even_with_progress():
    loop = Loop({10: [cluster(4)], 11: [cluster(3)], 12: [cluster(2)], 13: [cluster(1)]})
    loop.start()
    for n in range(3):
        loop.resume(child(101 + n, "NEEDS_REVIEW"))
        reply = loop.resume(child(101 + n, "APPLIED", verification="PASSED", execution=11 + n))
    assert reply["done"] is True and reply["outcome"] == "STOPPED"
    assert reply["round"] == 3
    assert "최대 3바퀴" in reply["steps"][-1]
    assert [f["executionId"] for f in loop.tools.fixes] == [10, 11, 12]


def test_stops_when_the_runner_budget_is_spent():
    loop = Loop({10: [cluster(3)], 11: [cluster(2)], 12: [cluster(1)]})
    loop.start()
    loop.resume(child(101, "NEEDS_REVIEW", iterations=8))
    assert loop.resume(child(101, "APPLIED", verification="PASSED", execution=11))["done"] is False
    loop.resume(child(102, "NEEDS_REVIEW", iterations=8))
    reply = loop.resume(child(102, "APPLIED", verification="PASSED", execution=12))
    assert reply["done"] is True and reply["outcome"] == "STOPPED"
    assert "예산" in reply["steps"][-1]


def test_reverted_fix_counts_as_no_progress_and_keeps_the_execution():
    loop = Loop({10: [cluster(2)], 11: [cluster(1)]})
    loop.start()
    loop.resume(child(101, "NEEDS_REVIEW"))
    reply = loop.resume(child(101, "APPLIED", verification="REGRESSED", execution=11))
    assert reply["done"] is False and reply["round"] == 2
    assert loop.tools.fixes[-1]["executionId"] == 10
