# E-03 ai-service 뼈대 (짧은 설계)

2026-11-18. 근거: 인수인계 `docs/handoff/2026-11-18-LangGraph-개선-인수인계.md` 2-3 순서 1, `docs/langgraph-placement-decision.md`(E-01, 1안). 범위 · 기술은 두 문서가 정했고 여기서는 그대로 따른다.

## 왜

LangGraph 학습 루프(E-02 ~ E-11)를 얹을 Python 서비스가 아직 없다. 11/19 정오 전환 조건 1번이 "ai-service 가 compose 로 뜨고 빈 그래프가 PostgresSaver 체크포인트를 남기며 한 바퀴 돎"이다.

## 목표 (완료 기준)

- `apps/ai-service`: Python 3.12, `langgraph`, `langgraph-checkpoint-postgres`, `psycopg[binary]`
- 빈 그래프 `START → noop → END` 를 `PostgresSaver` 로 돌리면 같은 PostgreSQL 의 **스키마 `langgraph`** 에 체크포인트가 남는다 (Flyway 는 이 스키마를 건드리지 않음)
- `docker-compose.dev.yml` 에 서비스 `ai-service`, **`profiles: [ai]`** — `npm run dev`(기본)에서는 뜨지 않는다. `docker compose -f docker-compose.dev.yml --profile ai up ai-service` 로만
- HTTP: `GET /health`, `POST /runs`(빈 그래프 한 바퀴 → `thread_id` · 체크포인트 수). E-02 스모크와 E-07 재개가 이 서버 위에 붙는다
- pytest: 메모리 체크포인터로 한 바퀴(항상), Postgres 로 한 바퀴 · 체크포인트 수 ≥ 1(`AI_SERVICE_DATABASE_URL` 있을 때만)

## 비목표

- MCP 호출(E-02), LLM 프록시 호출, 노드 로직(E-04~), Spring 쪽 연동, 운영 compose(`docker-compose.yml`) · 배포 반영. 기본 배포 · 시연 동선에 영향 0

## 접근

| 안 | 판정 |
|---|---|
| FastAPI + uvicorn 상주 서버 | **채택**. 재개(E-07) · 스트리밍이 붙을 자리. LangGraph 생태계 표준 |
| 표준 라이브러리 http.server | 탈락. 곧 비동기 · 재개 요청을 받아야 해서 다시 바꾸게 됨 |
| 서버 없이 CLI 한 번 실행 | 탈락. compose 서비스로 상주해야 E-02 스모크 · Spring 호출이 가능 |

## 내가 정한 것 (준호 확인용)

- 패키지 이름 `ai_service`, 진입 `uvicorn ai_service.app:app --port 8090`
- 연결 문자열은 compose 의 POSTGRES_* 로 만든 `AI_SERVICE_DATABASE_URL`, 연결 옵션 `search_path=langgraph`, 기동 때 `CREATE SCHEMA IF NOT EXISTS langgraph` 후 `setup()`
- 의존성은 정확한 버전으로 고정(`requirements.txt`)
- 호스트 포트는 열지 않는다(내부망 전용, 결정 문서 "내부망"). 확인은 `docker compose exec`
