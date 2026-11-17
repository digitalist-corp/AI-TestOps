# LangGraph 실행 위치 결정 (E-01)

2026-11-07 결정. 담당 준호·윤재. 6주차(11/09 ~ 11/15) E-02 ~ E-11이 이 결정을 따른다.

## 결정

**1안 — Python `ai-service`(LangGraph) + MCP로 Spring 도구 호출.**
이번 주 수요일(11/11)에 아래 "전환 조건"을 확인한다. 조건에 걸리면 3안(LangGraph4j)으로 바꾼다.

| 안 | 방식 | 판정 |
|---|---|---|
| 1안 | Python LangGraph 별도 서비스 + MCP | **채택** |
| 2안 | Python LangGraph + REST 직접 호출 | 탈락. 도구가 19개라 Java·Python 두 곳에 스키마를 맞추는 비용이 크다 |
| 3안 | LangGraph4j로 Spring 안에서 실행 | 예비안. 전환 조건에 걸릴 때만 |

## 근거

1. **기준 문서가 Python을 정해 두었다.** PRD v2.0의 F-08(필수)은 "Python ai-service가 ingest → … → decide 실행"이라고 적었다. 기술 스택 표에도 "AI (ai-service): Python · LangGraph + PostgresSaver"가 있고, 윤재의 역할도 "ai-service(LangGraph)"다. 3안을 고르면 PRD와 차터를 고치고 다시 합의해야 한다.
2. **필요한 기능이 Python 쪽에 검증되어 있다.** 이 루프의 핵심은 승인 3곳의 `interrupt()`와 재시작 후 재개(E-07)다. Python LangGraph는 `langgraph-checkpoint-postgres`(1.0.x)로 이 둘을 공식 문서와 예제로 제공한다. LangGraph4j(1.9.x)에도 `langgraph4j-postgres-saver`가 있지만, 사람 승인과 재개는 README에 설명이 없고 예제를 찾아 읽어야 한다. 6주차는 이미 가장 빠듯한 주라서 자료를 찾는 데 시간을 쓰면 안 된다.
3. **MCP 비용은 이제 회수된다.** 개선사항 v2.0 4.3절은 "도구 소비자가 셋이 되는 시점에 MCP가 비용을 회수한다"고 했다. 지금 채팅(Spring)과 분석 에이전트(컨테이너)가 이미 있고 LangGraph가 세 번째다. 도구 계층은 3단계에서 `catalog()` / `execute()`로 프로토콜과 무관하게 정리되어 있어, MCP는 새 설계가 아니라 어댑터 하나다(E-02).
4. **자원은 감당된다.** Docker Desktop 메모리가 4GB다. Python 서비스는 상주 메모리가 수백 MB 수준이고, compose 프로파일(`ai`)로 분리해 필요할 때만 띄운다.

3안의 장점(프로세스 경계 없음, 배포와 디버깅이 가장 단순)은 실제로 있다. 그래서 버리지 않고 예비안으로 둔다.

## 구조

```
web ──▶ Spring api ──(루프 시작·재개, 내부망)──▶ ai-service (Python, LangGraph)
            ▲  ▲                                      │
            │  └──── MCP tools/list · tools/call ─────┤  도구
            └─────── /internal/ai-jobs/{id}/llm ──────┘  LLM (키는 Spring에만)
                                                      │
                         PostgreSQL ◀── PostgresSaver (스키마 langgraph)
```

정한 것:

| 항목 | 결정 | 이유 |
|---|---|---|
| LLM 호출 | ai-service는 LangChain 모델 클래스(ChatAnthropic 등)를 쓰지 않는다. 노드가 Spring 프록시 `/internal/ai-jobs/{id}/llm`을 HTTP로 부른다 | 바뀌지 않는 원칙 "LLM 호출은 LlmGatewayService 단일 출구, 컨테이너는 API 키를 보지 않음" |
| 도구 정의 | Spring에만 둔다. ai-service는 시작할 때 `tools/list`로 받는다 (`langchain-mcp-adapters`의 `MultiServerMCPClient`, `transport: "http"`) | 스키마 한 벌 |
| 인증 | MCP 요청 헤더 `Authorization: Bearer <작업 전용 토큰>`. 기존 `ai_jobs.callback_token` 체계를 그대로 쓴다 | 인증 체계 하나 |
| 승인 대기 중 토큰 만료 | 토큰은 30분이라 승인 대기 중에 만료된다. Spring이 재개를 호출할 때 새 토큰을 함께 넘기고, ai-service는 그 토큰으로 다시 연결한다 | 긴 토큰을 따로 만들지 않는다 |
| 승인 3곳 | 그래프는 `interrupt()`로 멈추기만 한다. 승인 화면과 기록은 Spring(AI 작업 카드)이 맡고, 승인되면 Spring이 ai-service에 재개(`Command(resume=...)`)를 보낸다 | 승인 게이트를 Spring 한 곳에 둔다 |
| 파일 반영 | ai-service도, MCP 도구도 프로젝트 파일을 직접 쓰지 않는다. 수정은 AI 작업(diff)으로만 만들고, 반영은 지금처럼 `AiJobService.applyDiff` 한 곳에서만 일어난다 | D-03에서 확인한 "승인 없는 반영 0건"을 그대로 지킨다. `ApprovalGateInventoryTest`가 지킨다 |
| 체크포인트 | 같은 PostgreSQL, 별도 스키마 `langgraph`. `PostgresSaver.setup()`이 테이블을 만들고 Flyway는 이 스키마를 건드리지 않는다 | DB를 하나 더 띄우지 않는다 |
| 기동 | `docker-compose.dev.yml`에 프로파일 `ai`로 추가. 루프를 다루지 않는 날에는 띄우지 않는다 | 메모리 4GB |

E-02 담당자에게 넘기는 것:

- **Spring AI MCP 스타터를 그냥 쓸 수는 없다.** Spring AI 1.1은 Spring Boot 3.4 · 3.5를, 2.0은 Boot 4를 지원한다. 우리는 Boot 3.3.5다. PRD의 "Spring AI(@McpTool)"를 쓰려면 Boot 업그레이드가 먼저 필요하다.
- **권장: 공식 MCP Java SDK의 코어(`io.modelcontextprotocol.sdk:mcp`)를 쓴다.** 코어에 있는 `HttpServletStreamableServerTransportProvider`를 서블릿으로 등록해 `/mcp`에 붙인다. 최신 SDK는 Jackson 3을 쓰니 Boot 3.3(Jackson 2)과 맞는 버전을 고른다.
- **SDK가 막히면:** `initialize` · `tools/list` · `tools/call` 세 메서드만 처리하는 무상태 JSON-RPC 컨트롤러로 대신한다. `catalog()` / `execute()` 위의 얇은 층이라 분량이 작다.
- **MCP로 내보낼 도구는 허용 목록으로 정한다.** 채팅의 RUN 단계 도구(사용자에게 묻고 실행)를 그래프에서 어떻게 다룰지도 E-02에서 정한다. 원칙은 하나다. 파일을 직접 쓰는 도구는 두지 않는다.

## 전환 조건 (수요일 11/11 중간 점검)

아래 둘 중 하나라도 수요일까지 안 되면 3안으로 바꾼다.

1. E-03: ai-service가 compose로 뜨고, 빈 그래프가 PostgresSaver 체크포인트를 남기며 한 바퀴 돎
2. E-02: ai-service가 MCP로 Spring 도구 하나(`list_executions` 등)를 불러 결과를 받음

3안으로 바꿀 때:

- 노드 순서·상태 모양·승인 3곳 설계는 그대로 쓴다.
- 노드 구현은 Spring 안의 Java로 옮기고, 도구는 `execute()`를 직접 부른다. 체크포인트는 `langgraph4j-postgres-saver`로 둔다.
- PRD F-08과 기술 스택 표의 "Python"을 고치는 변경을 이번 주 회의록에 남긴다.

## 남은 위험

| 위험 | 대응 |
|---|---|
| 프로세스가 늘어 장애 원인 추적이 어려움 | E-10: 노드마다 단계 상태를 DB에 기록하고 조회 API로 보여 준다 |
| Python 노드가 Spring 프록시를 거치면서 LangChain의 모델·스트리밍 편의 기능을 못 씀 | 루프 노드는 단발 호출 위주라 영향이 작다. 필요하면 프록시 호출을 감싼 작은 함수 하나를 둔다 |
| ai-service가 재시작되는 동안 승인을 받음 | 재개 요청이 실패하면 Spring이 작업을 "재개 대기"로 두고 다시 시도한다. 체크포인트가 DB에 있어 상태는 잃지 않는다 (E-07) |

## 참고

- PRD v2.0 F-08, 기술 스택 표 / 개선사항 v2.0 4.3절
- [Spring AI 1.1 시작하기 — 지원 Boot 버전](https://docs.spring.io/spring-ai/reference/1.1/getting-started.html)
- [MCP Java SDK 서버 문서](https://java.sdk.modelcontextprotocol.io/latest/server/)
- [langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters)
- [langgraph-checkpoint-postgres](https://pypi.org/project/langgraph-checkpoint-postgres)
- [LangGraph4j](https://github.com/langgraph4j/langgraph4j)
