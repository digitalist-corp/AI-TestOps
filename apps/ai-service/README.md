# ai-service (LangGraph)

학습 루프(E-06 ~ E-09)를 돌리는 Python 서비스. 결정: `docs/langgraph-placement-decision.md`.
compose 프로파일 `ai` 로만 뜬다 — 기본 `npm run dev` · 배포 · 시연에는 없다. 꺼져 있으면 화면은 "AI 루프로 고치기" 대신 안내를 보인다.

```bash
docker compose -f docker-compose.dev.yml --profile ai up -d ai-service      # 띄우기
docker compose -f docker-compose.dev.yml --profile ai run --rm -v "$PWD/apps/ai-service":/app ai-service pytest -q   # 테스트 (dev postgres 사용)
```

- 그래프: `ai_service/graph.py` — classify → fix → wait_fix → wait_approval → measure → decide. 기다림은 모두 `interrupt()`
- 입구: `POST /loops`(Spring 이 시작), `POST /loops/{jobId}/resume`(자식 수정 작업 상태로 재개). 맞지 않는 재개는 `{"ignored": true}`
- 체크포인트: 같은 postgres 의 스키마 `langgraph` (Flyway 는 건드리지 않음). thread_id = `loop-{jobId}`
- 호스트 포트 없음(내부망 8090). LLM 은 러너가 Spring 프록시로만, 도구는 Spring MCP 로만 (`list_failure_clusters`, `start_code_fix`)
