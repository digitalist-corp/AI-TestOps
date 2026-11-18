# E-03 ai-service 뼈대 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 빈 LangGraph 그래프가 PostgreSQL 스키마 `langgraph` 에 체크포인트를 남기며 한 바퀴 도는 Python 서비스를 compose 프로파일 `ai` 로만 띄운다.

**Architecture:** `apps/ai-service/ai_service/` 에 그래프 정의(`graph.py`), 체크포인터 연결(`checkpoint.py`), FastAPI 앱(`app.py`). compose 는 기존 postgres 를 같이 쓰고 프로파일 `ai` 일 때만 뜬다.

**Tech Stack:** Python 3.12, langgraph 1.2.22, langgraph-checkpoint-postgres 3.2.1, psycopg[binary,pool] 3.3.9, fastapi 0.163.2, uvicorn 0.54.0, pytest 9.2.0, httpx 0.28.1

**Spec:** `docs/superpowers/specs/2026-11-18-ai-service-skeleton-design.md`

## Global Constraints

- 기본 `npm run dev` · 배포 · 시연 동선에 영향 0: 서비스는 `profiles: [ai]`, 운영 `docker-compose.yml` · `deploy-test.yml` 은 건드리지 않는다
- 체크포인트 스키마는 `langgraph` 하나. Flyway 마이그레이션(`apps/api/.../db/migration`)은 추가하지 않는다
- 호스트 포트를 열지 않는다. 내부 포트 8090
- 의존성은 `requirements.txt` 에 위 버전 그대로 고정
- 테스트 실행: `docker compose -f docker-compose.dev.yml --profile ai run --rm ai-service pytest -q`

## Review Focus

1. 스키마 `langgraph` 가 없는 새 DB → 기동 때 만들고 `setup()` 성공 (Task 2 Postgres 테스트가 새 스키마 이름으로 확인)
2. 같은 `thread_id` 로 두 번 돌리면 체크포인트가 이어 쌓이고 오류가 없음 (Task 2 테스트)
3. `public` 스키마(Flyway 테이블)에 체크포인트 테이블이 생기지 않음 (Task 2 테스트)
4. DB 가 아직 준비 안 됨 → compose `depends_on: postgres: condition: service_healthy` (Task 3)
5. `/runs` 를 연속 두 번 → 서로 다른 `thread_id` (Task 2 테스트)

---

### Task 1: 빈 그래프 (메모리 체크포인터)

**Files:** Create `apps/ai-service/requirements.txt`, `apps/ai-service/ai_service/__init__.py`, `apps/ai-service/ai_service/graph.py`, `apps/ai-service/tests/test_graph.py`, `apps/ai-service/Dockerfile`, `apps/ai-service/.dockerignore`

**Interfaces:**
- Produces: `build_graph(checkpointer) -> CompiledStateGraph` — 상태 `{"steps": list[str]}`(reducer: 리스트 더하기), 노드 `noop` 하나가 `{"steps": ["noop"]}` 를 돌려줌, `START → noop → END`
- Produces: `run_once(graph, thread_id: str) -> dict` — `graph.invoke({"steps": []}, {"configurable": {"thread_id": thread_id}})`

- [ ] **Step 1: 실패 테스트** `test_empty_graph_runs_once_and_leaves_checkpoints`: `InMemorySaver` 로 `run_once` → 결과 `steps == ["noop"]`, `list(saver.list({"configurable": {"thread_id": t}}))` 길이 ≥ 1
- [ ] **Step 2: Dockerfile**(python:3.12-slim, requirements 설치, `COPY . /app`, `CMD uvicorn ai_service.app:app --host 0.0.0.0 --port 8090`) 을 만들고 `docker build` 후 pytest 실행 → `ModuleNotFoundError`/ImportError 로 실패 확인
- [ ] **Step 3: 구현 → Step 4: 통과 → Step 5: 커밋** `feat: ai-service 뼈대 — 빈 LangGraph 그래프 (E-03)`

### Task 2: PostgresSaver · 스키마 langgraph · HTTP

**Files:** Create `apps/ai-service/ai_service/checkpoint.py`, `apps/ai-service/ai_service/app.py`, `apps/ai-service/tests/test_postgres.py`, `apps/ai-service/tests/test_app.py`

**Interfaces:**
- Consumes: Task 1 `build_graph`, `run_once`
- Produces: `open_saver(database_url: str, schema: str = "langgraph") -> contextmanager[PostgresSaver]` — `CREATE SCHEMA IF NOT EXISTS`, 연결 옵션 `-c search_path=<schema>`, `autocommit=True`, `prepare_threshold=0`, `row_factory=dict_row`, `setup()`
- Produces: FastAPI `app` — `GET /health` → `{"status": "UP"}`; `POST /runs` → `{"threadId": str, "steps": list[str], "checkpoints": int}`. DB 는 환경변수 `AI_SERVICE_DATABASE_URL`, 앱 시작 때 `open_saver` 한 번(lifespan)

- [ ] **Step 1: 실패 테스트**
  - `test_postgres.py`(`AI_SERVICE_DATABASE_URL` 없으면 skip): 임시 스키마 `langgraph_test_<pid>` 로 `open_saver` → 같은 thread 두 번 `run_once` → 체크포인트 수가 늘어남; `information_schema.tables` 에서 `checkpoints` 테이블이 그 스키마에 있고 `public` 에는 없음; 끝나면 스키마 DROP
  - `test_app.py`: `TestClient(app)`(Postgres 필요, 없으면 skip) → `/health` 200 UP, `/runs` 두 번 → `threadId` 서로 다름, `steps == ["noop"]`, `checkpoints >= 1`
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과**
- [ ] **Step 5: 커밋** `feat: ai-service 체크포인트를 PostgreSQL 스키마 langgraph 에 남기고 /health · /runs 제공 (E-03)`

### Task 3: compose 프로파일 ai · 한 바퀴 확인

**Files:** Modify `docker-compose.dev.yml`, `AGENTS.md` 실행 절에 한 줄(사용자 미커밋 변경과 섞이지 않게 `git add -p` 로 그 줄만) 또는 `apps/ai-service/README.md`

- [ ] **Step 1:** 서비스 `ai-service`: `build: ./apps/ai-service`, `container_name: playops-ai-service`, `profiles: [ai]`, `environment: AI_SERVICE_DATABASE_URL: postgresql://${POSTGRES_USER:-playops}:${POSTGRES_PASSWORD:-playops}@postgres:5432/${POSTGRES_DB:-playops}`, `depends_on: postgres: condition: service_healthy`, 포트 공개 없음, healthcheck 는 python 으로 `/health`
- [ ] **Step 2:** `docker compose -f docker-compose.dev.yml config --services` 에 ai-service 가 **없고**, `--profile ai config --services` 에는 있음
- [ ] **Step 3:** `--profile ai up -d ai-service` → healthy → `docker compose exec ai-service python -c "...POST /runs..."` 결과와 `psql ... -c "select count(*) from langgraph.checkpoints"` ≥ 1 을 기록(스크린샷 대신 출력)
- [ ] **Step 4:** `--profile ai run --rm ai-service pytest -q` 전부 통과(Postgres 테스트 skip 0)
- [ ] **Step 5: 커밋** `chore: ai-service 를 compose 프로파일 ai 로만 띄움 (E-03)`
