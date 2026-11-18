"""학습 루프 그래프 (E-03 뼈대). 지금은 아무것도 안 하는 노드 하나 — E-04 부터 ingest · cluster · classify … 가 붙는다."""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class LoopState(TypedDict):
    # 지나간 노드 이름. 체크포인트로 어디까지 왔는지 보인다.
    steps: Annotated[list[str], operator.add]


def noop(state: LoopState) -> dict:
    return {"steps": ["noop"]}


def build_graph(checkpointer):
    graph = StateGraph(LoopState)
    graph.add_node("noop", noop)
    graph.add_edge(START, "noop")
    graph.add_edge("noop", END)
    return graph.compile(checkpointer=checkpointer)


def run_once(graph, thread_id: str) -> dict:
    return graph.invoke({"steps": []}, {"configurable": {"thread_id": thread_id}})
