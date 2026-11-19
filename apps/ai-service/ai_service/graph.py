"""학습 루프 그래프 (E-06 · E-07 · E-09).

    classify ─▶ fix ─▶ wait_fix ─▶ wait_approval ─▶ measure ─▶ decide ─▶ (classify | END)

- classify: MCP list_failure_clusters 로 실패 묶음 · 원인(Spring 규칙) · 과거에 승인된 수정을 읽는다.
  환경 · 제품 결함은 테스트 코드를 고칠 일이 아니라 사람에게 넘기고 멈춘다.
- fix: 과거 수정을 예시로 넣은 지시문으로 MCP start_code_fix 를 부른다. 러너가 격리 사본에서 고치고 다시 돌려
  통과한 diff 만 검토 대기로 올린다 — 재검증에 실패한 수정안은 사람에게 가지 않는다.
- wait_fix · wait_approval: interrupt 로 멈춘다. 체크포인트에 남아 ai-service 가 재시작돼도 Spring 의 재개로 이어진다.
- measure · decide: 재실행(사후 검증 실행) 실패 건수로 진전을 재고, 최대 3바퀴 · 러너 예산 · 정체 2번에서 멈춘다.

LLM 은 그래프가 직접 부르지 않는다. 러너가 Spring 프록시(/internal/ai-jobs/{id}/llm)로만 부른다.
"""
import json
import operator
from typing import Annotated, Any, Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

MAX_ROUNDS = 3
# 러너 반복 1회 = LLM 호출 1회. 자식 수정 작업들의 반복 합이 이만큼이면 멈춘다
BUDGET = 15
NO_PROGRESS_LIMIT = 2
FIXABLE = ("SCRIPT_ERROR", "FLAKY", "UNCLASSIFIED")
CAUSE_KO = {"PRODUCT_DEFECT": "제품 결함", "SCRIPT_ERROR": "스크립트 오류", "ENVIRONMENT": "환경",
            "FLAKY": "불안정", "UNCLASSIFIED": "미분류"}
FIX_SETTLED = ("NEEDS_REVIEW", "REJECTED", "FAILED", "ERROR", "TIMEOUT", "CANCELED")
VERIFIED = ("PASSED", "REGRESSED", "SKIPPED")


class Tools(Protocol):
    async def call(self, name: str, args: dict) -> str: ...


class LoopState(TypedDict, total=False):
    # 노드마다 한 줄. Spring 이 루프 작업 summary 로 보여 준다 (E-10 간이)
    steps: Annotated[list[str], operator.add]
    execution_id: int
    round: int
    failures: int
    budget_used: int
    no_progress: int
    target: dict
    fix_job_id: int
    reviewing: bool  # 수정안이 재검증을 통과해 사람 승인을 기다림
    verified: dict  # 승인 뒤 재실행이 끝난 자식 작업 상태
    outcome: str  # PASSED · STOPPED · REJECTED — 있으면 끝


def accepts(wait: dict, child: dict) -> bool:
    """지금 기다리는 단계에 맞는 자식 상태인지. 엔티티 저장마다 이벤트가 와서 같은 상태가 여러 번 올 수 있다."""
    if child.get("jobId") != wait.get("jobId"):
        return False
    status = child.get("status")
    if wait.get("wait") == "fix":
        return status in FIX_SETTLED
    if wait.get("wait") == "approval":
        return status in ("REJECTED", "CANCELED") or (status == "APPLIED" and child.get("verificationStatus") in VERIFIED)
    return False


def counts(found: list[dict]) -> tuple[int, int]:
    """(환경을 뺀 실패 수, 환경 실패 수). 환경(네트워크 · 브라우저 실행)은 루프가 고칠 대상이 아니라 진전 계산에서 뺀다."""
    env = sum(c["count"] for c in found if c["cause"] == "ENVIRONMENT")
    return sum(c["count"] for c in found) - env, env


def instruction(target: dict) -> str:
    cases = ", ".join(f"'{c}'" for c in target.get("cases", [])[:3])
    text = (f"{cases} 실패를 고쳐 주세요. 원인 분류: {CAUSE_KO.get(target['cause'], target['cause'])}. "
            f"실패: {target.get('summary') or target.get('head')}.")
    recalled = target.get("recalled") or []
    if recalled:
        text += "\n\n이 프로젝트에서 사람이 승인했던 비슷한 실패의 수정입니다. 같은 방식이 맞으면 따르세요."
        for past in recalled:
            text += f"\n\n[과거 수정 #{past['aiJobId']} · {past['specPath']}]\n{past['diff']}"
    return text


def build_graph(checkpointer, tools: Tools):
    async def clusters(execution_id: int) -> list[dict]:
        return json.loads(await tools.call("list_failure_clusters", {"executionId": execution_id}))

    async def classify(state: LoopState) -> dict:
        found = await clusters(state["execution_id"])
        failures, _ = counts(found)
        prefix = f"{state['round']}바퀴"
        if not found:
            return {"failures": 0, "outcome": "PASSED", "steps": [f"{prefix} 분류: 실패 없음"]}
        target = next((c for c in found if c["cause"] in FIXABLE), None)
        if target is None:
            causes = ", ".join(sorted({CAUSE_KO.get(c["cause"], c["cause"]) for c in found}))
            return {"failures": failures, "outcome": "STOPPED",
                    "steps": [f"{prefix} 정지: 테스트 코드로 고칠 실패가 아닙니다({causes}) — 사람에게 넘김"]}
        recalled = len(target.get("recalled") or [])
        return {"failures": failures, "target": target,
                "steps": [f"{prefix} 분류: {CAUSE_KO.get(target['cause'])} · {target.get('summary') or target.get('head')}"
                          f" · 과거 수정 {recalled}건 참고"]}

    async def fix(state: LoopState) -> dict:
        target = state["target"]
        started = json.loads(await tools.call("start_code_fix", {
            "executionId": state["execution_id"], "specPath": target["specPath"], "instruction": instruction(target)}))
        return {"fix_job_id": started["jobId"],
                "steps": [f"수정 작업 #{started['jobId']} 시작 — 격리 사본에서 고치고 다시 돌려 봄"]}

    def wait_fix(state: LoopState) -> dict:
        child = interrupt({"wait": "fix", "jobId": state["fix_job_id"]})
        used = state.get("budget_used", 0) + (child.get("iterationsUsed") or 0)
        if child["status"] == "NEEDS_REVIEW":
            return {"budget_used": used, "reviewing": True, "steps": [f"수정안 #{child['jobId']} 재검증 통과 → 승인 대기"]}
        return {"budget_used": used, "reviewing": False, "no_progress": state.get("no_progress", 0) + 1,
                "steps": [f"수정안 #{child['jobId']} 격리 재검증 실패({child['status']}) — 사람에게 보내지 않음"]}

    def wait_approval(state: LoopState) -> dict:
        child = interrupt({"wait": "approval", "jobId": state["fix_job_id"]})
        if child["status"] in ("REJECTED", "CANCELED"):
            return {"outcome": "REJECTED", "steps": [f"수정안 #{child['jobId']} 사람이 거부 → 정지"]}
        return {"verified": child, "steps": [
            f"승인 · 반영 → 재실행 #{child.get('verificationExecutionId')} (사후 검증 {child.get('verificationStatus')})"]}

    async def measure(state: LoopState) -> dict:
        child = state["verified"]
        before = state["failures"]
        rerun = child.get("verificationExecutionId")
        if child.get("verificationStatus") == "REGRESSED" or rerun is None:
            # 회귀로 되돌려졌거나 재실행이 없다 → 진전 없음, 같은 실행으로 다시
            return {"no_progress": state.get("no_progress", 0) + 1, "steps": ["재실행으로 진전을 확인하지 못함"]}
        after, env = counts(await clusters(rerun))
        note = f" · 환경 실패 {env}건은 사람이 확인" if env else ""
        update = {"execution_id": rerun, "failures": after, "steps": [f"재실행 실패(환경 제외) {before} → {after}건{note}"]}
        update["no_progress"] = 0 if after < before else state.get("no_progress", 0) + 1
        if after == 0:
            update["outcome"] = "PASSED"
        return update

    def decide(state: LoopState) -> dict:
        if state.get("no_progress", 0) >= NO_PROGRESS_LIMIT:
            return {"outcome": "STOPPED", "steps": ["정지: 두 번 연속 진전 없음 — 사람에게 넘김"]}
        if state["round"] >= MAX_ROUNDS:
            return {"outcome": "STOPPED", "steps": [f"정지: 최대 {MAX_ROUNDS}바퀴 — 사람에게 넘김"]}
        if state.get("budget_used", 0) >= BUDGET:
            return {"outcome": "STOPPED", "steps": [f"정지: 예산(러너 반복 {BUDGET}회) 소진 — 사람에게 넘김"]}
        return {"round": state["round"] + 1}

    def done_or(next_node: str):
        return lambda state: END if state.get("outcome") else next_node

    graph = StateGraph(LoopState)
    for name, node in [("classify", classify), ("fix", fix), ("wait_fix", wait_fix), ("wait_approval", wait_approval),
                       ("measure", measure), ("decide", decide)]:
        graph.add_node(name, node)
    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", done_or("fix"))
    graph.add_edge("fix", "wait_fix")
    graph.add_conditional_edges("wait_fix", lambda s: "wait_approval" if s["reviewing"] else "decide")
    graph.add_conditional_edges("wait_approval", done_or("measure"))
    graph.add_conditional_edges("measure", done_or("decide"))
    graph.add_conditional_edges("decide", done_or("classify"))
    return graph.compile(checkpointer=checkpointer)


def _config(job_id: int) -> dict:
    return {"configurable": {"thread_id": f"loop-{job_id}"}}


async def _reply(graph, job_id: int) -> dict[str, Any]:
    state = await graph.aget_state(_config(job_id))
    values = state.values
    return {"done": not state.next, "outcome": values.get("outcome"), "round": values.get("round"),
            "steps": values.get("steps", [])}


async def start_loop(graph, job_id: int, execution_id: int) -> dict:
    await graph.ainvoke({"steps": [], "execution_id": execution_id, "round": 1, "budget_used": 0, "no_progress": 0},
                        _config(job_id))
    return await _reply(graph, job_id)


async def resume_loop(graph, job_id: int, child: dict) -> dict:
    state = await graph.aget_state(_config(job_id))
    waits = [i.value for task in state.tasks for i in task.interrupts]
    if not waits or not accepts(waits[0], child):
        return {"ignored": True}
    await graph.ainvoke(Command(resume=child), _config(job_id))
    return await _reply(graph, job_id)
