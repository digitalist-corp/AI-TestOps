"""ai-service HTTP. Spring(AiLoopService)이 학습 루프를 시작 · 재개하는 입구 (E-06 · E-07).

토큰은 요청마다 받아 MCP 클라이언트에만 쓰고 체크포인트(상태)에는 남기지 않는다.
같은 루프의 시작 · 재개는 잠금으로 줄 세운다 — 시작이 첫 기다림에 닿기 전에 재개가 와도 놓치지 않는다.
"""
import asyncio
import os
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from ai_service.checkpoint import open_saver
from ai_service.graph import build_graph, resume_loop, start_loop
from ai_service.mcp_smoke import McpTools


def mcp_tools(job_id: int, token: str) -> McpTools:
    return McpTools(f"{os.environ.get('PLAYOPS_API_URL', 'http://api:8080')}/internal/ai-jobs/{job_id}/mcp", token)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with open_saver(os.environ["AI_SERVICE_DATABASE_URL"]) as saver:
        app.state.saver = saver
        yield


app = FastAPI(title="AI-TestOps ai-service", lifespan=lifespan)
app.state.make_tools = mcp_tools
locks: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


class StartLoop(BaseModel):
    jobId: int
    token: str
    executionId: int


class ResumeLoop(BaseModel):
    token: str
    child: dict


@app.get("/health")
def health():
    return {"status": "UP"}


@app.post("/loops")
async def create_loop(body: StartLoop):
    async with locks[body.jobId]:
        graph = build_graph(app.state.saver, app.state.make_tools(body.jobId, body.token))
        return await start_loop(graph, body.jobId, body.executionId)


@app.post("/loops/{job_id}/resume")
async def resume(job_id: int, body: ResumeLoop):
    async with locks[job_id]:
        graph = build_graph(app.state.saver, app.state.make_tools(job_id, body.token))
        return await resume_loop(graph, job_id, body.child)
