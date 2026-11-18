"""ai-service HTTP. Spring 이 루프를 시작 · 재개하는 입구가 될 자리 (E-07). 지금은 빈 그래프 한 바퀴만."""
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI

from ai_service.checkpoint import open_saver
from ai_service.graph import build_graph, run_once


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with open_saver(os.environ["AI_SERVICE_DATABASE_URL"]) as saver:
        app.state.saver = saver
        app.state.graph = build_graph(saver)
        yield


app = FastAPI(title="AI-TestOps ai-service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "UP"}


@app.post("/runs")
async def create_run():
    thread_id = str(uuid.uuid4())
    result = await run_once(app.state.graph, thread_id)
    checkpoints = len([c async for c in app.state.saver.alist({"configurable": {"thread_id": thread_id}})])
    return {"threadId": thread_id, "steps": result["steps"], "checkpoints": checkpoints}
