# ai-service (LangGraph)

학습 루프(E-02 ~ E-11)를 돌리는 Python 서비스. 결정: `docs/langgraph-placement-decision.md`.
compose 프로파일 `ai` 로만 뜬다 — 기본 `npm run dev` · 배포 · 시연에는 없다.

```bash
docker compose -f docker-compose.dev.yml --profile ai up -d ai-service      # 띄우기
docker compose -f docker-compose.dev.yml --profile ai run --rm ai-service pytest -q   # 테스트 (dev postgres 사용)
docker compose -f docker-compose.dev.yml exec ai-service python -c "import urllib.request; print(urllib.request.urlopen(urllib.request.Request('http://localhost:8090/runs', method='POST')).read())"
```

- 체크포인트: 같은 postgres 의 스키마 `langgraph` (Flyway 는 건드리지 않음)
- 호스트 포트 없음(내부망 8090). LLM 은 Spring 프록시로만, 도구는 Spring MCP 로만 (E-02)
