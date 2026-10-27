# AI-TestOps 기술 요구사항 및 개발 설계서 (TRD v1.2 기반)

> **문서 정보**
> - **프로젝트 명**: AI와 Playwright를 활용한 Web 자동화 테스트 (서비스명: **AI-TestOps**)
> - **문서 버전**: TRD v1.2 (2026-10-15 개정 / 기준 문서: TRD v1.0, 2026-10-12 `dev` 및 코드베이스 분석 PR #45 기준)
> - **원문 작성자**: 장준호 (TRD v1.0 원문 및 v1.2 설계 보완)
> - **문서 목적**: 원본 `.docx` 설계서의 전체 요구사항(기능/비기능/보안/DB/API/운영/TC)을 누락 없이 구조화하고, 현재 워크스페이스(`apps/api`, `apps/web`) 코드베이스와의 **현행(As-Is) vs 보완 설계(To-Be) Gap 및 개발 실행 계획**을 정의한다.

---

## 0. 코드베이스 현황 대조 요약 (As-Is vs TRD v1.2 Gap 분석)

원문 TRD v1.2는 크게 **① 원문 기반 항목(TRD v1.0 + PR #45)**, **② 이번 개정에서 추가된 보완 설계(v1.2)**, **③ 후속 예정 기능**의 3단계로 구분되어 있다. 실제 저장소(`rockfish`)와 대조한 결과는 다음과 같다.

| 구분 | TRD v1.2 내용 | 현재 워크스페이스(`dev` 최신 pull: `069494e`) 상태 | 개발 조치 방향 |
| :--- | :--- | :--- | :--- |
| **코드베이스 분석 (PR #45)** | `ScreenFinder`, `ScreenExtractor`, `SelectorBuilder`, `SiteAnalysisService`, `SiteMapPromptService`, 6개 테이블 (`site_*`, `scenario_origin`), `StructureTab.tsx` | **구현 및 병합 완료 (`PR #45`, `PR #48`)** — API 단위 테스트(`ScreenFinderTest`, `ScreenExtractorTest`, `SelectorBuilderTest`, `SiteAnalysisServiceTest`, `SiteMapPromptServiceTest`) 모두 통과 | 분석 수치 상한(100MiB/500화면/1MB/15분) 및 `partial=true` 보완 규칙만 추가 점검 |
| **원문 9개 + 기본 11개 엔티티 및 API** | 프로젝트, 실행, 스위트, 예약 실행, AI 작업/채팅/사용량/공급자 설정, 코드베이스 분석, 사용자/세션/감사로그, 게시판/댓글, 슬랙 설정 | **20개 물리 테이블에 대응하는 JPA 엔티티 및 기본 CRUD/실행/분석/AI 컨트롤러·프론트엔드 페이지 모두 구현됨** | TRD v1.2에서 추가된 "보완 설계" 항목(하단 참조) 위주로 업그레이드 |
| **Amazon Bedrock 연동** | `BedrockTransport.java`, `ai_provider_settings.transport/region` | 미구현 (`LlmGatewayService`에 Anthropic, OpenAI 직접 호출만 존재) | `BedrockTransport` 추가 및 `AiProviderSettings` 확장 |
| **DB 마이그레이션** | PostgreSQL + **Flyway** 버전 관리, 운영 `ddl-auto=validate` | `build.gradle`에 Flyway 미포함, `ddl-auto: update` 및 `BoardPostSchemaReconciler` 사용 중 | Flyway 도입, 초기 Baseline SQL(`V1`) 및 v1.2 보완 스키마(`V2`) 작성 |
| **API 공통 응답/계약** | `{data, requestId}`, `{error:{code,message,details}, requestId}`, `Idempotency-Key` 영속 저장, SSE `Last-Event-ID` 버퍼(1,000개) | 컨트롤러별 DTO 직접 반환, 멱등키 미적용, SSE 재연결 버퍼 미적용 | 기존 성공 응답은 호환 유지하고 표준 오류 응답·`Idempotency-Key`·SSE 버퍼 점진 적용 |
| **인증·세션·권한 (SEC-01/07)** | 32바이트 CSPRNG 토큰, DB에는 **SHA-256 `token_hash`만 저장**, 절대 8시간/유휴 30분 만료, 프로젝트 소유권(`owner_user_id`) 검사, 자기 승인 금지(`created_by != reviewed_by`), Rate Limit | `UserSession`에 UUID 원문 `token` 저장(만료는 7일), `Project.ownerUserId` 없음, `AiJob` 자기 승인 차단 없음 | `user_sessions` 해시+8h/30m 만료 전환, 프론트 메모리 토큰 보관, `owner_user_id` 및 4-eyes 승인 규칙 반영 |
| **기존 테이블 v1.2 보완 컬럼** | `projects.monthly_ai_budget_usd/version`, `ai_usage` 선예약(`reserved_usd`, `request_id`), `executions(schedule_id, scheduled_for)` UNIQUE, Slack `notification_outbox` 등 | `AiProviderSettings` 단일 행 구조, 예산 선예약/정산 없음, 낙관적 잠금(`@Version`) 없음, Outbox 없음 | Flyway 마이그레이션 및 서비스 레이어 보완 로직 구현 |
| **예정 기능 (Out-of-Scope / 후속)** | React Flow(`StructureGraph.tsx`), Python·LangGraph `ai-service`, 컨테이너 멀티턴 에이전트, `/api/ai-tasks/stream`, `/graphql`, `SITE` 직접 탐색 | 미구현 (TRD에서도 '예정'으로 분류됨) | 후속 릴리스 범위로 분리 유지 |

---

## 1. 프로젝트 개요 및 범위

### 1.1 개요
- **AI-TestOps**는 Playwright 기반 웹 테스트의 **생성, 실행, 실패 분석과 코드 수정**을 지원한다.
- 앱 소스 저장소를 분석해 **화면(Node)·요소(Element)·전환(Edge)·공용 메뉴(Layout)** 정보를 만들고, 이 정보를 AI 테스트 생성과 실행 결과 검증에 연결한다.
- AI가 만든 코드 변경은 반드시 **사람의 승인(Human-in-the-Loop)** 후 반영한다.

### 1.2 개발 범위 구분
- **In-Scope (현행 및 v1.2 보완 구현 대상)**
  - 로그인, 프로젝트 및 저장소 설정, 테스트 스위트와 예약 실행
  - 격리 컨테이너(Docker)의 Playwright 실행, 실시간 로그(SSE)와 케이스별 결과·아티팩트 수집
  - Next.js와 React Router 코드베이스의 화면·요소·전환·공용 메뉴 분석 (`CODE` 출처)
  - 화면별 제외·메모 보존, 셀렉터 생성과 실행 결과 기반 확인 상태(`UNVERIFIED` → `PASSED`/`FAILED`) 갱신
  - AI 테스트 생성·실패 수정·diff 검토·사람 승인과 반영
  - Claude·GPT·Amazon Bedrock 단일 게이트웨이, 공급자 설정과 사용량·월 예산(선예약/정산) 관리
- **Out-of-Scope (예정 및 현행 범위 밖)**
  - React Flow 구조 그래프(`TAB-MAP-02`), AI Task SSE(`API-TASK-01`)와 GraphQL 집계(`API-GRAPH-01`)는 **예정**이다.
  - Python·LangGraph `ai-service`와 컨테이너 내 멀티턴 AI 에이전트는 **예정**이다.
  - 사이트 직접 탐색에 따른 `SITE` 출처 추가는 **후속 기능**이다 (현행 화면 출처는 `CODE`).
  - Next.js와 React Router 외 프레임워크는 분석 지원 범위 밖이다 (`UNSUPPORTED_FRAMEWORK`).

---

## 2. 기능 요구사항 (FR) 및 비기능 요구사항 (NFR)

### 2.1 기능 요구사항 (FR-01 ~ FR-16)

| FR-ID | 기능명 | 세부 요구사항 ID 및 내용 | 우선순위 | 관련 API / 테이블 |
| :--- | :--- | :--- | :---: | :--- |
| **FR-01** | 사용자 인증 | - `FR-01-01`: 사용자명과 비밀번호로 로그인하고 토큰을 발급한다.<br>- `FR-01-02`: 사용자 역할(`ADMIN`/`USER`)과 로그인 세션을 관리한다. | **상** | `API-AUTH-01`, `API-AUTH-02`<br>`users`, `user_sessions` |
| **FR-02** | 프로젝트 관리 | - `FR-02-01`: 실행 환경과 테스트 코드·앱 소스 저장소를 관리한다.<br>- `FR-02-02`: 소스 저장소가 있으면 등록 시 분석을 자동 시작하고 삭제 시 분석 결과를 정리한다. | **상** | `API-PROJ-01~04`, `API-MAP-02`<br>`projects` |
| **FR-03** | 테스트 실행 | - `FR-03-01`: 전체·spec·케이스 단위 실행을 요청하고 격리 러너 컨테이너에서 실행한다.<br>- `FR-03-02`: 상태, 케이스별 결과, 실시간 로그, 리포트·trace·영상을 수집한다. | **상** | `API-EXEC-01~03`<br>`executions`, `execution_case_results` |
| **FR-04** | 테스트 스위트 | - `FR-04-01`: 함께 실행할 spec·케이스 묶음을 조회·저장하고 스위트 단위로 실행한다. | **상** | `API-SUITE-01`<br>`test_suites` |
| **FR-05** | 코드베이스 분석 | - `FR-05-01`: 저장소 복제 후 Next.js 폴더 구조 또는 React Router `<Route>` 정의로 화면을 찾는다 (LLM 미사용).<br>- `FR-05-02`: LLM으로 요소·링크를 추출하고 화면·전환·공용 메뉴를 저장한다. | **상** | `API-MAP-02`, `API-MAP-03`<br>`site_analysis_run`, `site_node`, `site_edge`, `site_layout` |
| **FR-06** | 구조 조회 | - `FR-06-01`: 분석 상태, 진행률, 남은 시간과 화면·요소·셀렉터·전환·공용 메뉴를 조회한다. | **상** | `API-MAP-01`, `API-MAP-04`, `API-MAP-06` |
| **FR-07** | 화면 편집 | - `FR-07-01`: 화면별 테스트 제외(`excluded`)와 메모(`note`)를 저장하고 재분석 시에도 보존한다.<br>- `FR-07-02`: 제외한 화면은 테스트 생성 프롬프트에서 뺀다. | **상** | `API-MAP-05`<br>`site_node_edit` |
| **FR-08** | AI 테스트 생성 | - `FR-08-01`: 선택한 `routeKeys`와 요청 문장(`instruction`)으로 테스트 생성 작업을 만든다.<br>- `FR-08-02`: 생성 spec이 사용한 화면·셀렉터를 `scenario_origin`에 기록한다. | **상** | `API-JOB-01`<br>`ai_jobs`, `scenario_origin` |
| **FR-09** | AI 코드 수정 | - `FR-09-01`: 실패한 실행(`failedExecutionId`)을 대상으로 코드 수정 작업을 만들고 작업 상태와 변경 diff를 조회한다. | **상** | `API-JOB-02`, `API-JOB-03`<br>`ai_jobs` |
| **FR-10** | AI 검토 | - `FR-10-01`: `NEEDS_REVIEW` 작업은 사람이 승인해야 `APPLIED`가 된다.<br>- `FR-10-02`: 수정 허용 경로(`ai_allowed_path_globs`)와 위험 표시(`risk_flags`)를 관리하고 반영 뒤 재실행 결과를 기록한다. | **상** | `API-JOB-03`, `API-JOB-04`<br>`ai_jobs` |
| **FR-11** | AI 채팅 | - `FR-11-01`: 채팅 도구로 화면 조회(`get_sitemap`), 테스트 생성(`generate_scenario`), 실행을 수행하고 작업 카드와 패널 내 승인 기능을 제공한다. | **상** | `API-AI-01`, `API-JOB-04` |
| **FR-12** | LLM 관리 | - `FR-12-01`: Claude·GPT·Amazon Bedrock 호출을 단일 게이트웨이로 처리하고 공급자 키·모델·단가 및 토큰·비용·소요 시간을 관리한다. | **상** | `API-JOB-05`, `API-AI-02~03`, `API-BUDGET-01`<br>`ai_provider_settings`, `ai_usage` |
| **FR-13** | 예약 실행 | - `FR-13-01`: 정해진 시각에 실행할 대상과 주기를 `execution_schedules`에 저장한다. | **중** | `API-SCHED-01`, `API-SCHED-02`<br>`execution_schedules` |
| **FR-14** | 관리 기능 | - `FR-14-01`: 러너 컨테이너, 사용자, 템플릿, 공지·문의 게시판을 관리한다. | **중** | `API-ADMIN-01~02`, `API-BOARD-01~02`, `API-OPS-01`, `API-TPL-01` |
| **FR-15** | 구조 그래프 | - `FR-15-01`: React Flow 그래프에 경로 선택, 확인 상태 색과 상세 패널을 제공한다. | **후속(예정)** | `TAB-MAP-02` |
| **FR-16** | AI 자동화 | - `FR-16-01`: Python·LangGraph로 분석·생성·실행·분류·수정·승인·PR 루프를 조율한다.<br>- `FR-16-02`: 컨테이너 에이전트, AI Task SSE와 GraphQL 집계를 확장한다. | **후속(예정)** | `API-TASK-01`, `API-GRAPH-01` |

### 2.2 비기능 요구사항 (NFR-01 ~ NFR-05)

| NFR-ID | 품질속성 | 요구사항 요약 | 검증 방법 |
| :--- | :--- | :--- | :--- |
| **NFR-01** | **보안** | 저장소 토큰·공급자 키·Webhook 암호화 저장(AES-GCM). LLM 키는 API만 보관하며 러너는 내부 프록시(`/internal/ai-jobs/{jobId}/llm`) 사용. 저장소 복제와 실행은 컨테이너 격리. | 키·토큰 노출 점검 및 컨테이너 격리 확인 (`TC-11`, `TC-12`, `TC-19`) |
| **NFR-02** | **효율성** | `content_hash`가 같은 화면은 LLM 재호출 생략. 호출별 사용량 기록 및 프로젝트별 월 예산 선예약·차단. 분석 상한 도달 시 `partial=true` 표시. | 동일 해시 재분석 시 LLM 호출 수 0건 확인 및 월 예산 동시성 차단 확인 (`TC-05`, `TC-09`, `TC-14`) |
| **NFR-03** | **정합성** | LLM이 추출한 글자가 실제 소스 파일에 없으면 폐기. `TESTID` → `ROLE` → `LABEL` → `PLACEHOLDER` → `TEXT` 순으로 셀렉터 조립 및 중복 표시. 생성 셀렉터와 저장분 대조 및 실행 결과로 확인 상태 갱신. | 추출 근거·중복 셀렉터·실행 결과 상태 갱신 확인 (`TC-07`, `TC-15`) |
| **NFR-04** | **운영** | `/actuator/health` 배포 게이트 사용, 실행 로그 SSE 전달. 분석 상태·진행 시각·오류와 사용자 감사 로그(`user_audit_logs`) 저장. Slack 알림 durable outbox. | 헬스 체크, SSE 재연결, 분석 오류 및 감사/알림 기록 확인 (`TC-10`, `TC-17`, `TC-21`) |
| **NFR-05** | **성능** | 메타데이터 조회 **p95 ≤ 1초**, 비동기 변경 요청 접수 **p95 ≤ 2초**, 서버 5xx < 1%. 외부 LLM·저장소·러너 작업은 비동기 처리. | 4 vCPU·8 GiB API 환경, 동시 사용자 20명, 5분 워밍업 후 15분 부하 테스트 (`TC-18`) |

### 2.3 성능·자원 한도·예산 상세 기준 (보완 설계)

| 구분 | 초기 설계 기준치 | 구현 및 동작 규칙 |
| :--- | :--- | :--- |
| **기준 환경/데이터** | API: 4 vCPU · 8 GiB / DB: 2 vCPU · 4 GiB<br>프로젝트 50개, 실행 10,000건, 프로젝트당 화면 200개·요소 2,000개 | 동시 사용자 20명, 워밍업 5분 후 15분 측정. 외부 작업은 비동기 접수 시간만 측정(4xx는 서버 오류율 제외). |
| **실행 자원/슬롯** | 러너당 2 vCPU · 2 GiB<br>동시 실행: **전체 2건 · 프로젝트당 1건**<br>`PENDING` 대기열: **최대 20건** | 대기열 접수와 실행 슬롯 점유를 각각 원자화. 대기열 초과 시 `429 QUEUE_FULL`. 슬롯은 `RUNNING` 및 러너 준비 점유 기준. |
| **테스트 실행 제한** | 실행 제한 **20분**, 러너 준비 **120초**, 종료 유예 **30초** | 초과 시 `ERROR` 상태 및 `RUNNER_TIMEOUT` 기록 후 컨테이너 강제 정리. |
| **코드 분석 제한** | 소스 크기 **100 MiB**, 최대 화면 **500개**, 개별 화면 파일 **1 MiB**, 전체 분석 시간 **15분** | 수치 상한 도달 시 `partial=true` 및 `warnings` 기록(읽지 못한 화면을 `stale`로 단정하지 않음). 시간 초과는 `FAILED` 처리하며 사용자 편집(`site_node_edit`) 보존. |
| **LLM 호출 제한** | 단건 호출 타임아웃 **90초**, AI 작업 전체 **10분**<br>재시도: `429`·`5xx`만 **1초·3초** 뒤 최대 2회 (`Retry-After` 우선) | 재시도 시 각 실제 호출을 별도 `requestId`로 기록. 동일 논리 호출의 사용량 중복 정산 금지. |
| **SSE 로그 전달** | 서버 수신 로그의 95%를 **2초 이내** 전달, Heartbeat **15초** | `Last-Event-ID` 지원, 최근 **1,000개** 이벤트 인메모리/영속 버퍼 재전송, 버퍼 만료 시 `reset` 이벤트 발송. |
| **월 예산 선예약** | 프로젝트별 UTC 월 예산 (`projects.monthly_ai_budget_usd`, 기본값 `0` = AI 차단, `ADMIN`만 변경) | 호출 전 DB 잠금으로 `(입력 예상 비용 + maxOutputTokens 비용)`을 `ai_usage`에 `RESERVED` 상태로 선예약 → 호출 후 실제 사용량으로 `SUCCEEDED`/`FAILED` 정산. 공급자 사용량 누락 시 `usage_estimated=true`로 예약액 유지. |

---

## 3. 시스템 아키텍처 및 핵심 모듈 설계

### 3.1 처리 경로 요약

```mermaid
flowchart TD
    subgraph Client["프론트엔드 (React / TypeScript / Monaco)"]
        UI_Tabs["프로젝트 탭 (대시보드·소스·구조·시나리오·실행)"]
        UI_AI["AI 검토 페이지 · AI 채팅 패널"]
    end

    subgraph API["API 서버 (Spring Boot 3 / Java 21 / JPA)"]
        Auth["인증·인가·감사 (Auth / Session / Ownership)"]
        Analysis["코드 분석 (SiteAnalysisService → ScreenFinder → ScreenExtractor → SelectorBuilder)"]
        Prompt["프롬프트·검증 (SiteMapPromptService)"]
        AiJob["AI 작업·도구 (AiJobService / AiChatToolService)"]
        Gateway["LLM 단일 게이트웨이 (LlmGatewayService / BedrockTransport)"]
        Exec["실행·러너 제어 (TestExecutionService / DockerRunnerService)"]
    end

    subgraph Runner["격리 컨테이너 (Docker)"]
        GitClone["저장소 복제 (Git Clone)"]
        PW["Playwright 실행 / AI 러너"]
    end

    subgraph External["외부 연동 및 DB"]
        DB[("PostgreSQL (Flyway)")]
        LLM["Claude / GPT / Amazon Bedrock"]
        GitHost["Git 원격 저장소"]
    end

    UI_Tabs -->|REST / SSE| API
    UI_AI -->|REST| API
    Analysis -->|격리 복제| GitClone
    GitClone --> GitHost
    Analysis -->|요소 추출| Gateway
    AiJob --> Prompt
    AiJob --> Gateway
    Gateway --> LLM
    Exec --> PW
    PW -->|내부 프록시 /internal/ai-jobs/{id}/llm| Gateway
    Exec -->|실행 결과 반영| Prompt
    API --> DB
```

### 3.2 백엔드 핵심 서비스 모듈 (`apps/api`)

| 모듈 (클래스) | 책임 및 핵심 로직 | 현행 상태 |
| :--- | :--- | :---: |
| `ScreenFinder.java` | 저장소 코드에서 규칙 기반으로 화면(라우트)과 화면 파일을 탐색. Next.js는 폴더 구조(`app/`, `pages/`), React Router는 `<Route>` 정의를 파싱. **LLM 미사용**. | PR #45 브랜치 구현 |
| `ScreenExtractor.java` | 화면 파일 묶음을 LLM에 보내 요소·링크 추출. **추출된 문자열이 실제 파일에 존재하는지 대조해 없으면 폐기(Hallucination 방지)**. `content_hash`가 동일한 화면은 LLM 호출 생략. | PR #45 브랜치 구현 |
| `SelectorBuilder.java` | 추출된 속성으로 Playwright 셀렉터 조립. 우선순위: `TESTID`(`data-testid`) → `ROLE`(역할+이름) → `LABEL` → `PLACEHOLDER` → `TEXT`. 동일 화면 내 중복 셀렉터는 표시만 수행. | PR #45 브랜치 구현 |
| `SiteAnalysisService.java` | 분석 1회 조율: 격리 컨테이너 저장소 복제 → 화면 탐색 → 요소 추출 → `site_node`·`site_edge`·`site_layout` 저장, 진행률(`processed_count`/`screen_count`)·남은 시간 계산, 재분석 시 `site_node_edit` 보존 및 사라진 화면 `stale=true` 처리(전체 탐색 성공 시에만). | PR #45 브랜치 구현 + v1.2 한도 보완 |
| `SiteMapPromptService.java` | 테스트 생성 프롬프트에 화면·요소·공용 메뉴 주입(`excluded=true` 화면 제외). 생성된 spec의 셀렉터를 저장분과 대조해 `scenario_origin` 기록 및 `risk_flags` 산출. 실행 완료 후 케이스 결과로 요소의 확인 상태(`UNVERIFIED` → `PASSED`/`FAILED`) 갱신. | PR #45 브랜치 구현 |
| `AiJobService.java`<br>`AiChatToolService.java` | AI 작업(`TEMPLATE_GENERATE`, `CODE_FIX`, `TEST_ANALYSIS`) 생명주기 관리, diff 생성, 위험도 평가, 사람 승인(`NEEDS_REVIEW` → `APPLIED`)·거부(`REJECTED`), 반영 후 재실행 검증(`post_apply_verification_status`), 채팅 도구(`get_sitemap`, `generate_scenario` 등) 실행. | 현행 구현 + v1.2 동시성/4-eyes 보완 |
| `LlmGatewayService.java`<br>`BedrockTransport.java` | 모든 LLM 호출의 단일 출구. 공급자(`CLAUDE`/`GPT`) 및 전송 방식(`ANTHROPIC`/`OPENAI`/`BEDROCK`) 선택, 프로젝트 월 예산 선예약·실비 정산, 타임아웃(90초) 및 재시도(1초·3초). | `LlmGatewayService` 구현 / `BedrockTransport` 및 선예약 추가 필요 |
| `TestExecutionService.java`<br>`DockerRunnerService.java` | 격리 러너 컨테이너(`EPHEMERAL`/`PERSISTENT`)에서 Playwright 실행 및 저장소 복제 수행. 실시간 로그(SSE), 케이스별 결과, HTML 리포트·trace·영상 수집. | 현행 구현 + 슬롯/타임아웃 보완 |

---

## 4. 데이터베이스 설계 (20개 물리 테이블 + 운영 보조 저장소)

> **DB 운영 원칙 (ADR-09, ADR-13)**
> - 운영 DB는 **PostgreSQL**을 사용하며 **Flyway**로 버전별 마이그레이션한다 (`ddl-auto=validate`).
> - 모든 시각 컬럼(`TIMESTAMPTZ` / `TIMESTAMP`)은 **UTC**로 저장하며, 예약 실행은 IANA `timezone`(기본 `Asia/Seoul`)을 별도 컬럼에 명시한다.

### 4.1 공통 Enum 정의

| Enum 명칭 | 허용 상수 값 | 설명 |
| :--- | :--- | :--- |
| `ExecutionStatus` | `SCHEDULED`, `PENDING`, `RUNNING`, `CANCEL_REQUESTED`, `CANCELLED`, `PASSED`, `FAILED`, `ERROR` | 테스트 실행의 진행 및 최종 상태 |
| `AiJobType` | `TEMPLATE_GENERATE`, `CODE_FIX`, `TEST_ANALYSIS` | AI 작업 종류 (테스트 생성 · 코드 수정 · 실패 분석) |
| `AiJobStatus` | `PENDING`, `RUNNING`, `DIFF_READY`, `NEEDS_REVIEW`, `APPLIED`, `REJECTED`, `FAILED`, `ERROR`, `CANCELED`, `TIMEOUT` | `NEEDS_REVIEW`에서 사람이 승인해야 `APPLIED` 전환 |
| `AiModelProvider` | `CLAUDE`, `GPT` | `CLAUDE`는 설정에 따라 Anthropic API 또는 Amazon Bedrock 호출 |
| `SiteAnalysisStatus` | `RUNNING`, `COMPLETED`, `FAILED` | 코드베이스 분석 1회의 상태 (`site_analysis_run.status`) |
| `Framework` | `NEXT`, `REACT_ROUTER` | 분석에서 인식한 프레임워크 (그 외는 `UNSUPPORTED_FRAMEWORK`) |
| `Verification` | `UNVERIFIED`, `PASSED`, `FAILED` | 요소의 확인 상태 (추출 직후 미확인 → 실행 결과로 갱신) |
| `SelectorKind` | `TESTID`, `ROLE`, `LABEL`, `PLACEHOLDER`, `TEXT` | 셀렉터 조립 근거 (왼쪽일수록 높은 우선순위) |
| `RunnerLifecycle` | `EPHEMERAL`, `PERSISTENT` | 러너 컨테이너를 실행마다 생성/삭제할지 유지할지 여부 |
| `DockerStatus` | `NOT_CONFIGURED`, `STOPPED`, `RUNNING`, `ERROR` | 프로젝트 러너 컨테이너 상태 |
| `UserRole` | `ADMIN`, `USER` | 관리자와 일반 사용자 구분 |

---

### 4.2 원문 9개 핵심 테이블 상세 스키마 (+ v1.2 확장 제약 포함)

#### (1) `projects` (프로젝트)
| 컬럼명 | 타입 | 제약조건 | 설명 및 v1.2 보완 사항 |
| :--- | :--- | :--- | :--- |
| `project_id` | `VARCHAR(100)` | `PK, NOT NULL` | 소문자·숫자·하이픈 (`^[a-z0-9-]+$`) |
| `project_name` | `VARCHAR(200)` | `NOT NULL` | 표시용 이름 |
| `base_url` | `VARCHAR(500)` | `NULL` | 테스트 대상 사이트 URL |
| `repository_url` | `VARCHAR(500)` | `NULL` | 테스트 코드(spec) 저장소 (`repository_branch`, 암호화 토큰 컬럼 동반) |
| `source_repository_url` | `VARCHAR(500)` | `NULL` | 코드베이스 분석이 읽는 앱 소스 저장소 URL |
| `source_repository_branch` | `VARCHAR(100)` | `NULL` | 앱 소스 브랜치 (비우면 기본 브랜치) |
| `source_repository_token_encrypted` | `TEXT` | `NULL` | 앱 소스 비공개 저장소 토큰 (AES-GCM 암호화 저장, write-only) |
| `test_command` | `VARCHAR(500)` | `NOT NULL` | 기본값: `npx playwright test --project=chromium` |
| `env_variables` | `TEXT` | `NULL` | JSON 문자열. 실행 시 러너에 전달 |
| `login_setup_spec_path` | `VARCHAR(500)` | `NULL` | 로그인 상태를 만들어 재사용하는 선행 spec 경로 |
| `runner_lifecycle` | `VARCHAR(20)` | `NOT NULL` | `EPHEMERAL` / `PERSISTENT` |
| `docker_status` | `VARCHAR(20)` | `NOT NULL` | `NOT_CONFIGURED`, `STOPPED`, `RUNNING`, `ERROR` |
| `ai_model_provider` | `VARCHAR(20)` | `NOT NULL` | `CLAUDE` / `GPT` |
| `ai_auto_apply_enabled` | `BOOLEAN` | `NOT NULL` | 기본값 `false` (사람 승인 후에만 반영) |
| `ai_allowed_path_globs` | `TEXT` | `NULL` | AI 수정 허용 경로 글로브. 기본값 `tests/**` |
| `owner_user_id` *(보완)* | `BIGINT` | `NOT NULL, FK(users.id)` | 프로젝트 소유자 (소유권 인가 검사 기준) |
| `monthly_ai_budget_usd` *(보완)* | `NUMERIC(18,8)` | `NOT NULL, DEFAULT 0` | 프로젝트 월 AI 예산 (기본 `0` = AI 호출 차단, `ADMIN`만 설정) |
| `version` *(보완)* | `BIGINT` | `NOT NULL, DEFAULT 0` | 낙관적 잠금(`@Version`) |

#### (2) `executions` (테스트 실행 이력)
| 컬럼명 | 타입 | 제약조건 | 설명 및 v1.2 보완 사항 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 실행 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | 프로젝트 ID |
| `status` | `VARCHAR(20)` | `NOT NULL` | `ExecutionStatus` |
| `spec_path` | `VARCHAR(500)` | `NULL` | 실행 spec 경로 (비우면 전체 실행) |
| `case_title` | `VARCHAR(500)` | `NULL` | 케이스 단위 실행 시 제목 |
| `grep_filter` | `VARCHAR(500)` | `NULL` | 스위트 실행 시 케이스 필터 |
| `total_tests` | `INTEGER` | `NOT NULL` | `passed_tests`, `failed_tests`, `skipped_tests` 컬럼 동반 |
| `duration_ms` | `BIGINT` | `NULL` | 실행 소요 시간 (밀리초) |
| `report_path` | `VARCHAR(500)` | `NULL` | HTML 리포트·trace·영상 저장 경로 |
| `source` | `VARCHAR(30)` | `NOT NULL` | `MANUAL`, `SCHEDULE`, `CI`, `AI` |
| `log_output` | `TEXT` | `NULL` | 러너 표준 출력 (시크릿 마스킹 후 저장) |
| `error_message` | `TEXT` | `NULL` | 실패 시 최상위 오류 요약 (`RUNNER_TIMEOUT` 등) |
| `started_at` | `TIMESTAMPTZ` | `NULL` | `finished_at`, `created_at` 동반 (UTC) |
| `schedule_id` *(보완)* | `BIGINT` | `NULL, FK(execution_schedules.id)` | 예약 실행으로 생성된 경우 참조 |
| `scheduled_for` *(보완)* | `TIMESTAMPTZ` | `NULL` | 예정 시각. `UNIQUE(schedule_id, scheduled_for)`로 중복 생성 방지 |
- **인덱스**: `INDEX(project_id, created_at DESC)`, `UNIQUE(schedule_id, scheduled_for)`

#### (3) `ai_jobs` (AI 작업)
| 컬럼명 | 타입 | 제약조건 | 설명 및 v1.2 보완 사항 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 작업 식별자 (작업 브랜치 `ai/{id}` 이름으로 사용) |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | 프로젝트 ID |
| `job_type` | `VARCHAR(30)` | `NOT NULL` | `AiJobType` (`TEMPLATE_GENERATE`, `CODE_FIX`, `TEST_ANALYSIS`) |
| `status` | `VARCHAR(20)` | `NOT NULL` | `AiJobStatus` |
| `ai_model_provider` | `VARCHAR(20)` | `NOT NULL` | `CLAUDE` / `GPT` |
| `instruction` | `TEXT` | `NULL` | 사용자 요청 문장 (최대 10,000자) |
| `target_spec_path` | `VARCHAR(500)` | `NULL` | 생성하거나 수정할 대상 spec 파일 경로 |
| `route_keys` | `TEXT` | `NULL` | JSON 배열. 선택한 화면 경로 목록 |
| `failed_execution_id` | `BIGINT` | `NULL, FK(executions.id)` | 코드 수정(`CODE_FIX`)의 계기가 된 실패 실행 ID |
| `risk_flags` | `TEXT` | `NULL` | JSON/문자열. 미저장 셀렉터 사용, 검증(assertion) 축소 등 위험 표시 |
| `changed_files` | `TEXT` | `NULL` | 변경 파일 목록 (`diff_path`에 diff 파일 위치 저장) |
| `reviewed_by` | `BIGINT` | `NULL, FK(users.id)` | 승인/거부 수행자 ID |
| `applied_commit_sha` | `VARCHAR(100)` | `NULL` | 승인 후 반영된 Git 커밋 SHA |
| `post_apply_verification_status` | `VARCHAR(20)` | `NULL` | 승인 반영 후 자동 재실행 검증 결과 |
| `created_by` *(보완)* | `BIGINT` | `NOT NULL, FK(users.id)` | 작업 요청자 ID (`created_by != reviewed_by` 검증용) |
| `version` *(보완)* | `BIGINT` | `NOT NULL, DEFAULT 0` | 동시 승인 방지용 낙관적 잠금 |
- **인덱스**: `INDEX(project_id, status, created_at)`

#### (4) `site_analysis_run` (코드베이스 분석 기록)
| 컬럼명 | 타입 | 제약조건 | 설명 및 v1.2 보완 사항 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 분석 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | 프로젝트 ID |
| `status` | `VARCHAR(20)` | `NOT NULL` | `RUNNING`, `COMPLETED`, `FAILED` |
| `commit_sha` | `VARCHAR(64)` | `NULL` | 분석한 앱 소스의 커밋 해시 |
| `framework` | `VARCHAR(30)` | `NULL` | `NEXT`, `REACT_ROUTER` |
| `partial` | `BOOLEAN` | `NOT NULL, DEFAULT false` | 상한(화면 500개 등)에 걸려 일부만 분석했는지 여부 |
| `screen_count` | `INTEGER` | `NOT NULL, DEFAULT 0` | 규칙으로 찾은 전체 화면 수 |
| `processed_count` | `INTEGER` | `NULL` | 요소까지 추출 완료한 화면 수 (진행률 계산용) |
| `llm_calls` | `INTEGER` | `NULL` | 실제 호출한 LLM 횟수 (해시 동일 화면 제외) |
| `progress_at` | `TIMESTAMPTZ` | `NULL` | 최근 진행 갱신 시각 (남은 시간 ETA 계산용) |
| `warnings` | `TEXT` | `NULL` | 경고 메시지 JSON 배열 |
| `error_message` | `TEXT` | `NULL` | 실패 사유 |
| `started_at` | `TIMESTAMPTZ` | `NOT NULL` | `finished_at` 동반 |
- **제약**: 프로젝트당 동시 `RUNNING` 1건 제한 — PostgreSQL 부분 유일 인덱스 `CREATE UNIQUE INDEX uq_site_analysis_running ON site_analysis_run(project_id) WHERE status = 'RUNNING'`

#### (5) `site_node` (화면 및 요소)
| 컬럼명 | 타입 | 제약조건 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 화면 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | `(project_id, route_key)` 복합 UNIQUE |
| `route_key` | `VARCHAR(500)` | `NOT NULL` | `/products/:id` 형태의 라우트 경로 |
| `title` | `VARCHAR(300)` | `NULL` | LLM이 추출한 화면 제목 |
| `source_file` | `VARCHAR(700)` | `NULL` | 앱 저장소 내 상대 파일 경로 |
| `origin` | `VARCHAR(20)` | `NOT NULL` | 현행 `CODE` (후속 사이트 탐색에서 `SITE` 추가) |
| `auth_required` | `BOOLEAN` | `NULL` | 보호된 라우트(로그인 필요) 여부 |
| `elements` | `TEXT` | `NOT NULL` | JSON 배열: `{key, kind, label, selector, selectorKind, ambiguous, sourceFile, sourceLine, verification}` |
| `links` | `TEXT` | `NULL` | JSON 배열: 전환(`site_edge`) 재구성 근거 |
| `content_hash` | `VARCHAR(64)` | `NULL` | 화면 파일 SHA-256 해시 (동일 시 LLM 재호출 생략) |
| `first_seen_commit` | `VARCHAR(64)` | `NULL` | `last_seen_commit` 동반 |
| `stale` | `BOOLEAN` | `NOT NULL, DEFAULT false` | 코드에서 사라진 화면 표시 (삭제하지 않고 유지) |

#### (6) `site_edge` (화면 간 전환)
| 컬럼명 | 타입 | 제약조건 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 전환 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | 프로젝트 ID |
| `from_route_key` | `VARCHAR(500)` | `NOT NULL` | 출발 화면 (`FK(project_id, from_route_key) -> site_node`) |
| `to_route_key` | `VARCHAR(500)` | `NOT NULL` | 도착 화면 (`FK(project_id, to_route_key) -> site_node`) |
| `kind` | `VARCHAR(20)` | `NOT NULL` | `LINK` |
| `label` | `VARCHAR(300)` | `NULL` | 클릭 대상 링크·버튼 텍스트 |
| `selector` | `VARCHAR(700)` | `NULL` | `SelectorBuilder`가 조립한 Playwright 셀렉터 |
| `source_file` | `VARCHAR(700)` | `NULL` | 코드 위치 (`source_line` 동반) |

#### (7) `site_layout` (공용 메뉴 / 레이아웃)
| 컬럼명 | 타입 | 제약조건 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 레이아웃 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | 프로젝트 ID |
| `source_file` | `VARCHAR(700)` | `NOT NULL` | 상단바·사이드바 레이아웃 컴포넌트 파일 경로 |
| `route_keys` | `TEXT` | `NULL` | 이 레이아웃이 감싸는 화면 `route_key` JSON 배열 |
| `elements` | `TEXT` | `NULL` | 공용 요소 JSON 배열 |
| `links` | `TEXT` | `NULL` | 공용 메뉴 링크 JSON 배열 |
| `content_hash` | `VARCHAR(64)` | `NULL` | 재분석 시 변경 판단용 파일 해시 |

#### (8) `site_node_edit` (화면별 사용자 편집)
| 컬럼명 | 타입 | 제약조건 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL` | `UNIQUE(project_id, route_key)` |
| `route_key` | `VARCHAR(500)` | `NOT NULL` | 대상 화면 경로 |
| `excluded` | `BOOLEAN` | `NOT NULL, DEFAULT false` | `true`이면 AI 테스트 생성 프롬프트에서 제외 |
| `note` | `VARCHAR(500)` | `NULL` | 사용자 메모 (재분석 시에도 보존) |
| `version` *(보완)* | `BIGINT` | `NOT NULL, DEFAULT 0` | 낙관적 잠금 |

#### (9) `scenario_origin` (생성 테스트 출처)
| 컬럼명 | 타입 | 제약조건 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PK, IDENTITY` | 식별자 |
| `project_id` | `VARCHAR(100)` | `NOT NULL, FK(projects)` | `UNIQUE(project_id, spec_path)`로 upsert |
| `spec_path` | `VARCHAR(500)` | `NOT NULL` | 생성된 테스트 spec 파일 경로 |
| `route_keys` | `TEXT` | `NULL` | 사용한 화면 `route_key` JSON 배열 |
| `selector_keys` | `TEXT` | `NULL` | 사용한 셀렉터 키 JSON 배열 (실행 결과를 요소 상태에 역반영하는 키) |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` | 재생성 시 덮어쓰기 시각 |

---

### 4.3 추가 11개 물리 테이블 상세 보완 스키마

| 테이블명 | 주요 컬럼 및 타입 | 핵심 제약 및 설계 규칙 |
| :--- | :--- | :--- |
| **`users`** | `id`(BIGINT PK), `username`(VARCHAR(100) UNIQUE), `password_hash`(VARCHAR(255) NOT NULL), `role`(VARCHAR(20): `ADMIN`/`USER`), `enabled`(BOOLEAN DEFAULT true), `created_at`, `updated_at`(TIMESTAMPTZ) | 비밀번호는 bcrypt(cost 12) 해시 저장. 입력은 UTF-8 72바이트 이하, 최소 10자. |
| **`execution_case_results`** | `id`(BIGINT PK), `execution_id`(BIGINT FK), `spec_path`(VARCHAR(500)), `case_title`(VARCHAR(500)), `status`(VARCHAR(20): `PASSED`/`FAILED`/`SKIPPED`/`ERROR`), `duration_ms`(BIGINT >=0), `error_message`(TEXT), `attempt_index`(INT), `case_index`(INT), `created_at`(TIMESTAMPTZ) | `UNIQUE(execution_id, case_index, attempt_index)`. `error_message` 저장 전 민감정보 마스킹. |
| **`test_suites`** | `id`(BIGINT PK), `project_id`(VARCHAR(100) FK), `name`(VARCHAR(200)), `specs_json`(TEXT NOT NULL), `version`(BIGINT DEFAULT 0), `created_at`, `updated_at`(TIMESTAMPTZ) | `UNIQUE(project_id, name)`. 낙관적 잠금(`version`) 적용. |
| **`execution_schedules`** | `id`(BIGINT PK), `project_id`(VARCHAR(100) FK), `suite_id`(BIGINT NULL FK), `spec_path`(VARCHAR(500) NULL), `case_title`(VARCHAR(500) NULL), `cron_expression`(VARCHAR(100) NULL), `timezone`(VARCHAR(64) DEFAULT `'Asia/Seoul'`), `run_at`(TIMESTAMPTZ NULL), `next_run_at`(TIMESTAMPTZ), `enabled`(BOOLEAN DEFAULT true), `misfire_policy`(VARCHAR(20) DEFAULT `'FIRE_ONCE'`), `version`(BIGINT), `created_at`, `updated_at` | `suite_id`와 `spec_path` 동시 지정 금지(XOR). `cron_expression`과 `run_at` 중 하나만 지정(XOR). |
| **`ai_usage`** | `id`(BIGINT PK), `project_id`(VARCHAR(100) FK), `job_id`(BIGINT NULL FK), `request_id`(VARCHAR(100) UNIQUE), `provider`(VARCHAR(20)), `model`(VARCHAR(200)), `input_tokens`(BIGINT), `output_tokens`(BIGINT), `input_unit_price`(NUMERIC(18,8)), `output_unit_price`(NUMERIC(18,8)), `cost_usd`(NUMERIC(18,8)), `reserved_usd`(NUMERIC(18,8)), `status`(VARCHAR(20): `RESERVED`/`SUCCEEDED`/`FAILED`), `usage_estimated`(BOOLEAN), `latency_ms`(BIGINT), `created_at`, `settled_at`(TIMESTAMPTZ) | `request_id` UNIQUE로 중복 과금 방지. 단가 스냅샷 저장. 원문 프롬프트·응답·키 저장 금지. |
| **`ai_provider_settings`** | `id`(BIGINT PK), `provider`(VARCHAR(20) UNIQUE: `CLAUDE`/`GPT`), `transport`(VARCHAR(30): `ANTHROPIC`/`OPENAI`/`BEDROCK`), `model`(VARCHAR(200)), `api_key_encrypted`(TEXT), `key_version`(VARCHAR(50)), `region`(VARCHAR(50)), `input_unit_price`(NUMERIC(18,8)), `output_unit_price`(NUMERIC(18,8)), `enabled`(BOOLEAN), `version`(BIGINT), `updated_at`(TIMESTAMPTZ) | 직접 API 키는 AES-GCM envelope 암호화. Bedrock은 워크로드 IAM 역할 인증 사용(`region` 필수). |
| **`board_posts`** | `id`(BIGINT PK), `author_id`(BIGINT FK users), `category`(VARCHAR(20): `NOTICE`/`INQUIRY`), `title`(VARCHAR(200)), `content`(TEXT), `deleted`(BOOLEAN DEFAULT false), `created_at`, `updated_at`(TIMESTAMPTZ) | 공지(`NOTICE`) 작성은 `ADMIN` 전용, 문의(`INQUIRY`)는 작성자 및 `ADMIN` 열람/관리. XSS 방지를 위해 원문 HTML 실행 금지. |
| **`board_post_comments`** | `id`(BIGINT PK), `post_id`(BIGINT FK board_posts), `author_id`(BIGINT FK users), `content`(TEXT: 1~10,000자), `deleted`(BOOLEAN DEFAULT false), `created_at`, `updated_at`(TIMESTAMPTZ) | 게시글 접근 권한 검사 + 댓글 작성자 또는 `ADMIN`만 수정·삭제. |
| **`user_sessions`** | `id`(BIGINT PK), `user_id`(BIGINT FK users), `token_hash`(CHAR(64) UNIQUE), `created_at`(TIMESTAMPTZ), `last_seen_at`(TIMESTAMPTZ), `expires_at`(TIMESTAMPTZ), `revoked_at`(TIMESTAMPTZ NULL), `user_agent`(VARCHAR(500) NULL) | **원문 토큰 저장 금지**, SHA-256 해시(`token_hash`)만 저장. 발급 후 **8시간 절대 만료**, `last_seen_at` 기준 **30분 유휴 만료**. |
| **`user_audit_logs`** | `id`(BIGINT PK), `actor_user_id`(BIGINT NULL FK), `target_user_id`(BIGINT NULL FK), `project_id`(VARCHAR(100) NULL FK), `action`(VARCHAR(100)), `resource_type`(VARCHAR(100)), `resource_id`(VARCHAR(100)), `request_id`(VARCHAR(100)), `outcome`(VARCHAR(20): `SUCCESS`/`DENIED`/`FAILED`), `metadata`(TEXT), `created_at`(TIMESTAMPTZ) | 애플리케이션에서 수정·삭제 금지(Append-only). `metadata` JSON에서 시크릿·토큰·프롬프트 원문 제외. |
| **`slack_settings`** | `id`(BIGINT PK), `project_id`(VARCHAR(100) NULL FK), `webhook_url_encrypted`(TEXT NOT NULL), `event_types`(TEXT JSON), `enabled`(BOOLEAN), `version`(BIGINT), `updated_at`(TIMESTAMPTZ) | `project_id`가 NULL이면 전역 설정(부분 유일 인덱스로 전역 1건 보장). 프로젝트 설정이 전역보다 우선. |

### 4.4 운영 보조 영속 테이블 (20개 업무 테이블 외)
- **`idempotency_records`**: `(project_id, operation_type, idempotency_key)` 복합 UNIQUE, `request_hash`(CHAR(64)), `response_status`(INT), `response_body`(TEXT), `resource_id`(VARCHAR(100)), `expires_at`(TIMESTAMPTZ, 생성+24시간).
- **`notification_outbox`**: Slack 알림 내구성 보장용. `id`, `dedup_key`(UNIQUE: `event_type:resource_id:final_status`), `payload_json`, `status`(`PENDING`/`SENT`/`DEAD_LETTER`), `retry_count`, `next_retry_at`, `created_at`.

---

## 5. API 및 인터페이스 상세 설계

### 5.1 공통 API 계약 (보완 설계)
1. **응답 봉투(Envelope) 표준**
   - 성공 응답: `{"data": ..., "requestId": "req-..."}`
   - 오류 응답: `{"error": {"code": "ERROR_CODE", "message": "...", "details": [...]}, "requestId": "req-..."}`
   - 예외: SSE(`text/event-stream`), 헬스 체크(`/actuator/health`), GraphQL(`/graphql`)은 전용 형식 사용.
2. **데이터 직렬화 규칙**
   - `BIGINT` ID(`id`, `executionId`, `jobId`, `suiteId`, `scheduleId`, `userId` 등)는 JavaScript `Number.MAX_SAFE_INTEGER` 정밀도 손실 방지를 위해 **JSON 문자열(`"123"`)**로 직렬화한다.
   - 모든 시각은 **UTC ISO 8601(`2026-10-15T09:00:00Z`)**로 입출력한다.
   - 페이지네이션 기본값은 `page=0, size=20` (최대 `size=100`), 응답 형식은 `{items, page, size, totalElements, totalPages}`.
3. **입력 검증 상한**
   - 일반 JSON 요청 본문 최대 **1 MiB**, `instruction` 최대 **10,000자**, `routeKeys` 최대 **100개**, 파일 경로는 저장소 내부 상대 경로만 허용(`realpath` 검증으로 `..` 및 심볼릭 링크 탈출 차단).
   - 시크릿(`password`, `apiKey`, `sourceRepositoryToken`, `webhookUrl`)은 **write-only**이며 응답에는 `configured: boolean` 또는 마스킹 값만 반환한다.
4. **비동기 접수 및 멱등성 (`Idempotency-Key`)**
   - 실행(`API-EXEC-01`, 스위트 실행), 분석(`API-MAP-03`), AI 작업 생성(`API-JOB-01`, `API-JOB-02`)은 **`202 Accepted`**와 작업 ID를 즉시 반환한다.
   - `Idempotency-Key` 헤더를 프로젝트·작업 종류별로 24시간 영속 저장한다. 동일 키+동일 본문 해시는 기존 응답을 재사용하고, 동일 키+상이한 본문은 **`409 IDEMPOTENCY_CONFLICT`**로 거절한다.

### 5.2 표준 오류 코드 표

| HTTP 상태 | 오류 코드 (`error.code`) | 적용 기준 |
| :---: | :--- | :--- |
| `400` | `VALIDATION_ERROR`, `URL_INVALID`, `REPOSITORY_INVALID`, `PATH_NOT_ALLOWED`, `MODEL_CONFIG_INVALID`, `DATE_RANGE_INVALID` | 형식·길이·enum·경로·날짜 범위 검증 실패 |
| `401` | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS` | 토큰 누락·무효·만료(유휴 30분/절대 8시간) 또는 로그인 실패 |
| `403` | `FORBIDDEN`, `ACCOUNT_DISABLED`, `ADMIN_REQUIRED`, `SELF_APPROVAL_FORBIDDEN`, `JOB_SCOPE_MISMATCH`, `TARGET_BLOCKED` | 권한 부족, 타인 프로젝트 접근, 작성자 본인 AI 승인 시도, 내부 프록시 job 불일치, SSRF 차단 |
| `404` | `NOT_FOUND`, `SPEC_NOT_FOUND`, `ROUTE_NOT_FOUND` | 리소스 없음 또는 권한 없는 타 프로젝트 리소스 은닉 |
| `409` | `STATE_CONFLICT`, `JOB_ALREADY_RUNNING`, `EXECUTION_ALREADY_RUNNING`, `ANALYSIS_ALREADY_RUNNING`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `PROJECT_ID_EXISTS`, `SUITE_NAME_EXISTS`, `ACTIVE_JOB_EXISTS`, `ROUTE_EXCLUDED`, `EXECUTION_NOT_FAILED`, `DIFF_NOT_READY`, `BASE_COMMIT_CHANGED` | 중복 작업, 낙관적 잠금(`version`) 충돌, 멱등키 본문 불일치, 승인 시 베이스 커밋 변경 등 |
| `422` | `UNSUPPORTED_FRAMEWORK`, `SELECTOR_INVALID` | Next.js / React Router 외 프레임워크 또는 유효하지 않은 셀렉터 |
| `429` | `RATE_LIMITED`, `AI_BUDGET_EXCEEDED`, `QUEUE_FULL` | Rate Limit 초과(`Retry-After` 포함), 월 예산 부족, 실행 대기열(20건) 초과 |
| `502` / `503` | `UPSTREAM_ERROR`, `RUNNER_UNAVAILABLE` | 외부 LLM/Git 오류, Docker 러너 준비 불가 |
| `504` | `UPSTREAM_TIMEOUT`, `SITE_CHECK_TIMEOUT` | 동기 LLM 프록시·채팅·사이트 확인 제한 시간 초과 |

### 5.3 전체 API 명세 (원문 26개 + 보완 10개)

| ID | Method | Endpoint | 요청 계약 (Request) | 성공 응답 (Response) | 주요 오류 코드 |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **API-AUTH-01** | `POST` | `/api/auth/login` | `{username(1~100), password(≤72B)}` | `200`: `{token, tokenType:"Bearer", expiresAt, user:{id,username,role}}` | `401 INVALID_CREDENTIALS`, `403 ACCOUNT_DISABLED`, `429 RATE_LIMITED` |
| **API-AUTH-02** *(보완)* | `POST` | `/api/auth/logout` | `Authorization: Bearer` | `204 No Content` (현재 세션 즉시 폐기) | `401` |
| **API-PROJ-01** | `GET` | `/api/projects` | `page, size, status?` | `200`: `{items:[{projectId, projectName, dockerStatus, latestAnalysis}], ...}` | `401`, `400` |
| **API-PROJ-02** | `POST` | `/api/projects` | `{projectId, projectName, baseUrl?, repositoryUrl?, sourceRepositoryUrl?, ...}` | `201`: `{projectId, projectName, analysisRunId?}` (`owner_user_id` = 인증 사용자) | `409 PROJECT_ID_EXISTS`, `400 URL_INVALID` |
| **API-PROJ-03** | `GET`/`PUT`/`DELETE` | `/api/projects/{id}` | `PUT`: `{..., version}` | `GET`/`PUT` `200`: 시크릿 제외 상세 / `DELETE` `204` | `404`, `409 VERSION_CONFLICT` / `ACTIVE_JOB_EXISTS` |
| **API-PROJ-04** | `GET` | `/api/projects/site-check` | `?url=https://...` (최대 500자) | `200`: `{reachable, httpStatus, checkedAt}` (원문 본문 미반환) | `400 URL_INVALID`, `403 TARGET_BLOCKED`, `504 SITE_CHECK_TIMEOUT` |
| **API-EXEC-01** | `POST` | `/api/projects/{id}/executions` | Header: `Idempotency-Key`<br>`{specPath?, caseTitle?, grepFilter?}` | `202`: `{executionId, status:"PENDING", statusUrl}` | `409 EXECUTION_ALREADY_RUNNING`, `429 QUEUE_FULL` |
| **API-EXEC-02** | `GET` | `/api/executions/{execId}` | Path: `execId` | `200`: `{executionId, status, totalTests, passedTests, failedTests, skippedTests, durationMs, cases[], reportUrl, errorMessage}` | `403`, `404` |
| **API-EXEC-03** | `GET` | `/api/executions/{execId}/logs/stream` | Header: `Last-Event-ID?` | `200 SSE`: `event: log` `{id,time,level,message}`, `event: done` `{status}`, `event: reset`, 15초 heartbeat | `401`, `404`, `429` (사용자당 최대 3연결) |
| **API-SUITE-01** | `GET`/`POST` | `/api/projects/{id}/test-suites`<br>`.../{suiteId}/execute` | `POST`: `{name, specs:[{specPath, caseTitles[]}]}`<br>`execute`: `Idempotency-Key` | `GET 200` 목록 / `POST 201` `{suiteId}` / `execute 202` `{executionId}` | `404 SPEC_NOT_FOUND`, `409 SUITE_NAME_EXISTS` |
| **API-MAP-01** | `GET` | `/api/projects/{id}/sitemap` | Path: `id` | `200`: `{analysis:{id,status,partial,counts,warnings}, nodes[], edges[], layouts[]}` (분석 전 `analysis:null`, 빈 배열) | `404` |
| **API-MAP-02** | `PUT` | `/api/projects/{id}/sitemap/source` | `{sourceRepositoryUrl, sourceRepositoryBranch?, sourceRepositoryToken?}` (`null`이면 토큰 삭제) | `200`: `{sourceRepositoryUrl, sourceRepositoryBranch, tokenConfigured}` | `400 REPOSITORY_INVALID`, `403` |
| **API-MAP-03** | `POST` | `/api/projects/{id}/sitemap/analyze` | Header: `Idempotency-Key`<br>`{force?: boolean}` (기본 `false`) | `202`: `{analysisRunId, status:"RUNNING", statusUrl}` | `409 ANALYSIS_ALREADY_RUNNING`, `422 UNSUPPORTED_FRAMEWORK` |
| **API-MAP-04** | `GET` | `/api/projects/{id}/sitemap/node` | `?route=/...` (최대 500자) | `200`: `{routeKey, title, sourceFile, authRequired, stale, elements[], transitions[], edit}` | `404 ROUTE_NOT_FOUND` |
| **API-MAP-05** | `PATCH` | `/api/projects/{id}/sitemap/node` | `?route=/...`<br>`{excluded?, note?(≤500자), version}` | `200`: `{routeKey, excluded, note, version}` | `404`, `409 VERSION_CONFLICT` |
| **API-MAP-06** | `GET` | `/api/sitemap/running` | 인증 사용자 소유 프로젝트 필터 | `200`: `[{projectId, analysisRunId, processedCount, screenCount, progressAt, etaSeconds?}]` | `401` |
| **API-JOB-01** | `POST` | `/api/projects/{id}/ai-jobs/template-generate` | Header: `Idempotency-Key`<br>`{routeKeys(1~100), instruction(1~10000), targetSpecPath?(tests/**)}` | `202`: `{jobId, jobType:"TEMPLATE_GENERATE", status:"PENDING"}` | `404 ROUTE_NOT_FOUND`, `409 ROUTE_EXCLUDED`, `429 AI_BUDGET_EXCEEDED` |
| **API-JOB-02** | `POST` | `/api/projects/{id}/ai-jobs` | Header: `Idempotency-Key`<br>`{jobType:"CODE_FIX", failedExecutionId, instruction?, targetSpecPath?}` | `202`: `{jobId, status:"PENDING"}` | `404`, `409 EXECUTION_NOT_FAILED`, `400 PATH_NOT_ALLOWED` |
| **API-JOB-03** | `GET` | `/api/ai-jobs/{jobId}`<br>`/api/ai-jobs/{jobId}/diff` | Path: `jobId` | `200`: 작업 상태·`riskFlags`·`changedFiles`·검증 상태<br>`/diff 200`: `{files:[{path,before,after,patch}]}` | `404`, `409 DIFF_NOT_READY` |
| **API-JOB-04** | `POST` | `/api/ai-jobs/{jobId}/approve`<br>`/api/ai-jobs/{jobId}/reject` | `approve`: `{expectedVersion, baseCommitSha, riskAcknowledged}`<br>`reject`: `{reason(1~500자)}` | `200`: `{jobId, status, reviewedBy, appliedCommitSha?}` | `403 SELF_APPROVAL_FORBIDDEN`, `409 STATE_CONFLICT` / `BASE_COMMIT_CHANGED` |
| **API-JOB-05** | `POST` | `/internal/ai-jobs/{jobId}/llm` | Job 범위 서명 토큰(`aud=llm-proxy`, `exp≤15m`)<br>`{messages[], model?, maxOutputTokens, requestId}` | `200`: `{content, model, usage:{inputTokens,outputTokens}, latencyMs}` | `401`, `403 JOB_SCOPE_MISMATCH`, `429 AI_BUDGET_EXCEEDED`, `502`/`504` |
| **API-AI-01** | `POST` | `/api/ai/chat` | `{projectId, message(1~10000), conversationId?}` | `200`: `{conversationId, message, toolResults[], jobIds[], usage}` | `403`, `429` (분당 10회), `502`/`504` |
| **API-AI-02** | `GET`/`PUT` | `/api/admin/ai-provider-settings` | `PUT`: `{provider, transport, model, apiKey?, region?, inputUnitPrice, outputUnitPrice, version}` | `200`: 설정 목록/단건 (`apiKey` 대신 `configured:boolean`) | `403 ADMIN_REQUIRED`, `400 MODEL_CONFIG_INVALID`, `409 VERSION_CONFLICT` |
| **API-AI-03** | `GET` | `/api/ai/usage` | `projectId?, from, to(UTC), page, size` | `200`: `{summary:{inputTokens,outputTokens,costUsd,budgetUsd,reservedUsd}, items:[]}` | `400 DATE_RANGE_INVALID`, `403` |
| **API-HLTH-01** | `GET` | `/actuator/health` | 없음 (상세 구성요소는 내부망만 허용) | `200`: `{status:"UP"}` / DB 실패 시 `503`: `{status:"DOWN"}` | `503` |
| **API-SCHED-01** *(보완)* | `GET`/`POST` | `/api/projects/{id}/execution-schedules` | `POST`: `{suiteId? \| specPath?, cronExpression? \| runAt?, timezone, misfirePolicy}` | `GET 200` 목록 / `POST 201` 생성 | `400`, `403`, `404` |
| **API-SCHED-02** *(보완)* | `PUT`/`DELETE` | `/api/projects/{id}/execution-schedules/{scheduleId}` | `PUT`: `{..., version}` (변경 시 `nextRunAt` 재계산) | `PUT 200` / `DELETE 204` | `404`, `409 VERSION_CONFLICT` |
| **API-ADMIN-01** *(보완)* | `GET`/`POST` | `/api/admin/users` | `POST`: `{username, password(≥10자, ≤72B), role, enabled}` | `GET 200` / `POST 201` (`password` 제외) | `403 ADMIN_REQUIRED`, `409` |
| **API-ADMIN-02** *(보완)* | `PATCH` | `/api/admin/users/{userId}` | `{role?, enabled?, password?}` | `200` (마지막 활성 `ADMIN` 비활성화/강등 차단, 변경 시 기존 세션 전체 폐기) | `403`, `409` |
| **API-BOARD-01** *(보완)* | `GET`/`POST`/`PUT`/`DELETE` | `/api/board/posts`<br>`/api/board/posts/{postId}` | `{category:"NOTICE"\|"INQUIRY", title, content}` | `200` / `201` / `204` (`NOTICE`는 `ADMIN`만 생성, `INQUIRY`는 작성자 범위) | `403`, `404` |
| **API-BOARD-02** *(보완)* | `GET`/`POST`/`DELETE` | `/api/board/posts/{postId}/comments`<br>`.../comments/{commentId}` | `{content(1~10000)}` | `200` / `201` / `204` | `403`, `404` |
| **API-OPS-01** *(보완)* | `GET`/`POST` | `/api/admin/runner-containers`<br>`.../{projectId}/start` \| `/stop` | `stop`: `{force?: boolean}` (실행 중 강제 중지는 명시 승인 필요) | `200` / `202` | `403 ADMIN_REQUIRED`, `409` |
| **API-TPL-01** *(보완)* | `GET`/`POST`/`PUT`/`DELETE` | `/api/admin/templates`<br>`.../{templateId}` | Git 버전 관리 파일 저장소 기반 템플릿 CRUD (경로 allowlist·감사 적용) | `200` / `201` / `204` | `400`, `403`, `404` |
| **API-BUDGET-01** *(보완)* | `PUT` | `/api/admin/projects/{id}/ai-budget` | `{monthlyBudgetUsd(≥0), version}` | `200`: 예산 변경 및 감사 로그 기록 | `403 ADMIN_REQUIRED`, `409 VERSION_CONFLICT` |
| **API-TASK-01** *(예정)* | `GET` | `/api/ai-tasks/stream` | `Last-Event-ID` | `200 SSE`: `task{jobId,projectId,status,updatedAt}` | `401`, `429` |
| **API-GRAPH-01** *(예정)* | `POST` | `/graphql` | `{query, variables:{projectId,from,to}}` (조회 전용, depth≤5, cost≤100) | `200`: `{data:{dashboard:{executionSummary,failureTrend,fixHistory}}}` | `401`, `403`, `QUERY_LIMIT_EXCEEDED` |

---

## 6. 프론트엔드 화면 및 컴포넌트 설계 (`apps/web`)

| 화면 ID | 화면 및 컴포넌트 파일 | 주요 기능 및 UI 요구사항 | 연동 API |
| :--- | :--- | :--- | :--- |
| **SCR-LOGIN-01** | `LoginPage.tsx` | 로그인, 서비스 상태 확인. **인증 토큰은 브라우저 메모리에만 보관**(`localStorage`·URL 쿼리 저장 금지). | `API-AUTH-01` |
| **SCR-PROJ-01** | `ProjectsPage.tsx` · `ProjectCard.tsx` | 프로젝트 목록, 실시간 코드 분석 진행 배지(`processedCount/screenCount`)와 남은 시간(`etaSeconds`) 표시. | `API-PROJ-01`, `API-MAP-06` |
| **SCR-PROJ-02** | `ProjectFormDialog.tsx` | 프로젝트 등록·수정, 앱 소스 저장소(URL·브랜치·토큰) 입력, 대상 사이트 연결 확인. | `API-PROJ-02`, `API-PROJ-04` |
| **SCR-PROJ-03** | `ProjectDetailPage.tsx` | 프로젝트 작업 탭(대시보드 · 소스 · 구조 · 시나리오 · 실행 · 설정) 컨테이너. | `API-PROJ-03` |
| **TAB-MAP-01** | `StructureTab.tsx` · `AnalysisProgress.tsx` | **구조 탭**: 소스 저장소 연결, 분석 시작·진행률, 화면 목록(`stale` 표시), 요소와 셀렉터(`Verification` 상태 배지), 공용 메뉴, 화면 제외/메모 편집, 화면 선택 후 AI 테스트 생성 요청. | `API-MAP-01~05`, `API-JOB-01` |
| **TAB-MAP-02** *(예정)* | `StructureGraph.tsx` | 화면·전환 그래프(React Flow). 경로 선택, 확인 상태 색상, 상세 패널. | `API-MAP-01`, `API-MAP-04`, `API-JOB-01` |
| **TAB-DASH-01** | `ProjectDashboardTab.tsx` | 실행 요약·추이·최근 실행 이력. | `API-EXEC-02` |
| **TAB-SRC-01** | `SourceExplorerTab.tsx` | 파일 트리, Monaco 에디터, AI 편집 도움. | `API-JOB-02` |
| **TAB-SCEN-01** | `ScenarioTab.tsx` | spec 분석, 케이스 목록, 스위트 구성/실행, AI 테스트 생성. | `API-SUITE-01`, `API-JOB-01` |
| **TAB-EXEC-01** | `ExecutionsTab.tsx` · `ResultsTab.tsx` | 실행 이력, 실시간 로그(SSE `Last-Event-ID` 재연결), 케이스별 결과·리포트. | `API-EXEC-01~03` |
| **SCR-AI-01** | `AiJobsPage.tsx` | AI 검토: 작업 변경 차이(diff) 확인, 위험 플래그(`riskFlags`) 확인 체크, 사람 승인·거부. | `API-JOB-03`, `API-JOB-04` |
| **SCR-AI-02** | `AiSettingsPage.tsx` | AI 공급자(Claude·GPT·Bedrock)·모델·단가 설정 및 프로젝트/기간별 사용량·예산 조회. | `API-AI-02`, `API-AI-03`, `API-BUDGET-01` |
| **CMP-AI-01** | `AiPanel.tsx` (`AiChatPanel`) | 상시 열려 있는 AI 채팅 패널, 도구 호출(`get_sitemap`, `generate_scenario`), 작업 카드 상태 추적 및 패널 내 승인. | `API-AI-01`, `API-JOB-04` |
| **SCR-ADMIN-01** | `RunnerContainersPage.tsx` · `UsersPage.tsx` · `TemplatesPage.tsx` · `BoardPage.tsx` | 러너 컨테이너 제어, 사용자/권한 관리, 템플릿 관리, 공지·문의 게시판. | `API-ADMIN-01/02`, `API-BOARD-01/02`, `API-OPS-01`, `API-TPL-01` |

---

## 7. 보안 요구사항 상세 (SEC-01 ~ SEC-07)

1. **인증 및 세션 관리 (`SEC-01`, `SEC-07`, `ADR-10`)**
   - 로그인 토큰은 **CSPRNG 32바이트** 불투명(Opaque) Bearer 토큰으로 생성한다.
   - 서버 DB(`user_sessions`)에는 원문 대신 **SHA-256 해시(`token_hash`)**만 저장한다.
   - 클라이언트는 토큰을 **메모리에만 보관**하며 `localStorage`, `sessionStorage`, URL 쿼리 파라미터, 로그에 남기지 않는다.
   - 세션 수명은 **절대 만료 8시간**, **유휴 만료 30분**(`last_seen_at` 기준)이며, 자동 갱신 대신 만료 시 재로그인한다.
   - 비밀번호 변경, 역할 변경, 계정 비활성화 시 해당 사용자의 기존 세션을 모두 폐기(`revoked_at` 기록)한다.
   - 비밀번호는 **bcrypt (cost 12)**로 해시하며, 입력 길이는 **최소 10자 ~ UTF-8 최대 72바이트**(72바이트 초과 시 자르지 않고 `400` 거절)로 검증한다. 로그인 실패 응답은 계정 존재 여부를 노출하지 않는다.
2. **인가, 소유권 및 4-Eyes 승인 원칙 (`SEC-01`, `SEC-04`)**
   - 일반 사용자(`USER`)는 `projects.owner_user_id == 인증 사용자 ID`인 소유 프로젝트 및 그 하위 리소스(실행, 분석, 스위트, 예약, AI 작업)만 접근할 수 있다. 타인 프로젝트 리소스 접근 시 `403` 또는 `404`를 반환하고 감사 로그(`DENIED`)를 남긴다.
   - **작성자 자기 승인 금지**: `USER`는 본인이 요청한 AI 작업(`ai_jobs.created_by == reviewed_by`)을 스스로 승인할 수 없다(`403 SELF_APPROVAL_FORBIDDEN`). 소규모 팀 예외로 `ADMIN`이 승인하는 경우 관리 행위로 감사 로그에 기록한다.
   - AI 반영 시 `expectedVersion`(낙관 잠금), `baseCommitSha`(승인 시점 베이스 커밋 일치 여부), `riskAcknowledged`(위험 플래그 확인 여부)를 함께 검증한다.
3. **Rate Limiting (`SEC-07`)**
   - 로그인 실패: 계정·IP별 **분당 5회 실패 시 15분 차단**
   - 일반 API: 사용자별 **분당 120회**
   - AI 채팅(`API-AI-01`): 사용자별 **분당 10회**
   - SSE 스트림: 사용자별 **동시 3연결**
   - 상한 도달 시 `429 RATE_LIMITED`와 `Retry-After` 헤더를 반환한다.
4. **SSRF, 경로 탈출 및 프롬프트 인젝션 방어 (`SEC-03`, `SEC-05`)**
   - 사이트 체크(`API-PROJ-04`) 및 Git 저장소 복제는 **HTTPS**와 허용된 Git 호스트만 허용한다.
   - DNS 해석 결과에 대해 **loopback(`127.0.0.0/8`, `::1`), 사설 IP(`10/8`, `172.16/12`, `192.168/16`), link-local(`169.254/16`), 클라우드 metadata 주소**를 차단하고 모든 HTTP 리디렉션마다 재검증한다(사내 테스트 대상은 `ADMIN` 명시적 allowlist + 분리 네트워크만 허용).
   - 파일 입출력 및 AI 반영 경로는 `realpath`로 정규화하여 저장소 루트 밖 경로 및 심볼릭 링크 탈출을 차단하며, `ai_allowed_path_globs`(기본 `tests/**`) 범위만 수정 허용한다.
5. **러너 컨테이너 격리 및 내부 LLM 프록시 (`SEC-02`, `SEC-03`)**
   - 러너 컨테이너는 **비특권 사용자(non-root)**, **read-only 루트 파일시스템**, 작업별 전용 볼륨으로 실행하며 **러너 내부에 Docker socket(`/var/run/docker.sock`)을 절대 마운트하지 않는다**.
   - 러너의 외부 통신은 Git 호스트, 테스트 대상 사이트, 내부 LLM 프록시(`/internal/ai-jobs/{jobId}/llm`) allowlist로 제한한다.
   - 내부 LLM 프록시 호출 시 `aud=llm-proxy`, `jobId`, `exp ≤ 15분`이 서명된 임시 토큰을 검증하며, 다른 `jobId` 요청은 `403 JOB_SCOPE_MISMATCH`로 차단한다.
6. **암호화 및 감사 로그 (`SEC-02`, `SEC-06`)**
   - 저장소 토큰, 공급자 API 키, Slack Webhook URL은 **AES-GCM envelope 암호화**(`key_version` 관리)로 저장하고 마스터 키는 외부 시크릿 저장소/환경변수로 주입한다.
   - Amazon Bedrock은 장기 Access Key 대신 클라우드 워크로드 IAM Role을 사용한다.
   - 계정/권한 변경, 공급자 설정, 예산 변경, AI 작업 승인/거부, 권한 거부(`DENIED`) 이벤트는 모두 `user_audit_logs`에 기록한다.

---

## 8. 예약 실행 · 배포 · 백업 · 데이터 보존 정책

### 8.1 예약 실행 스케줄러 (`ADR-11`, `ADR-13`)
- 다중 스케줄러 인스턴스 환경에서 행 잠금(`SELECT ... FOR UPDATE SKIP LOCKED`)으로 도래한(`next_run_at <= now()`) 예약을 점유하고, `executions`의 `UNIQUE(schedule_id, scheduled_for)` 제약 안에서 실행을 1건만 생성한다.
- **Misfire 정책**: 서버 중단으로 놓친 예약은 기본 `FIRE_ONCE`로 **마지막 누락 회차 1건만 생성**하고 나머지는 감사 로그로 남긴다(`SKIP` 설정 시 재가동 이후 회차부터 처리). 일회성 예약(`run_at`)은 실행 생성 직후 `enabled=false`로 전환한다.
- 예약 실행 **접수 실패**만 30초·120초 간격으로 최대 2회 재시도하며, Playwright 테스트 실패(`FAILED`)는 자동 재실행하지 않는다.

### 8.2 배포 파이프라인 및 롤백
- **배포 순서**: 변경 검증(빌드·단위 테스트·컨테이너 이미지 스캔) → DB 백업 확인 → Flyway 확장(Expand) 마이그레이션 → 컨테이너 이미지 교체 → `/actuator/health` Readiness 확인 → 스모크 테스트(로그인·프로젝트 조회·Mock LLM·샘플 실행) → 트래픽 전환.
- **롤백 원칙**: 직전 이미지 digest로 즉시 롤백한다. DB 파괴적 down migration은 자동 수행하지 않으며, 최소 1개 릴리스 동안 구·신 API가 호환되는 **Expand/Contract** 패턴을 적용한다.

### 8.3 데이터 보존·백업 및 관측 경보 정책

| 대상 데이터 | 보존 기간 및 정리 주기 | 보안 및 복구 기준 |
| :--- | :--- | :--- |
| **실행·AI 작업 메타데이터** | **90일** (일별 배치 정리) | 프로젝트 소유자·`ADMIN` 접근. FK 참조 관계 확인 후 정리. |
| **실행 로그·HTML 리포트** | **30일** (다운로드는 10분 유효 서명 URL) | 수집·저장 전 저장소 토큰·API 키·개인정보 마스킹. |
| **Trace·영상 아티팩트** | **14일** | 민감 화면 포함 가능하므로 프로젝트별 권한 검사 및 암호화 저장. |
| **코드 분석 데이터** | 최신 상태는 프로젝트 삭제 전까지 유지 / 분석 이력(`site_analysis_run`) **90일** | `site_node_edit`(사용자 편집)는 재분석이나 이력 정리로 삭제하지 않음. |
| **세션·감사 로그** | 만료 세션 **30일**, 감사 로그(`user_audit_logs`) **180일** | 토큰 원문 저장 금지. 감사 로그는 보존 배치만 만료 정리 가능. |
| **LLM 사용량 (`ai_usage`)** | **13개월** (비용 정산 근거) | 원문 프롬프트·응답 저장 금지. |
| **임시 Clone·러너 볼륨** | 작업 완료 후 **24시간 이내** (실패 시 매시간 재시도) | 실행 중인 리소스 제외, 프로젝트 경로 매칭 확인 후 삭제. |
| **DB 백업** | 일일 전체 백업 **14일**, 연속 WAL 아카이브 **7일** | 암호화 별도 저장소 보관. **RPO 15분 · RTO 4시간** 목표, 월 1회 복구 훈련(복원 후 만료 자료 재정리). |

- **운영 경보(Alert) 임계치**: ① 5분간 HTTP 5xx 비율 > 5%, ② 5분간 실행 대기열(`PENDING`) ≥ 20건, ③ 최근 성공 백업 후 26시간 초과.
- **Slack 알림**: 실행 `FAILED`/`ERROR`, 분석 `FAILED`, AI 작업 `ERROR`/`TIMEOUT`, 월 예산 차단 발생 시 `notification_outbox`에 기록 후 발송. `(이벤트 종류, 리소스 ID, 최종 상태)`로 중복을 억제하고 1초·5초·30초 간격 재시도 후 실패 시 `DEAD_LETTER` 보관(`ADMIN` 수동 재전송 지원).

---

## 9. 테스트 케이스 (TC-01 ~ TC-22) 및 완료 기준 (DoD)

### 9.1 전체 검증 시나리오 (Acceptance Test Cases)

| TC-ID | 관련 요구사항 | 테스트 시나리오 | 기대 결과 (Pass 기준) | 구분 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-01** | `FR-01` | 사용자 로그인 | 인증 후 토큰이 발급되고 `user_sessions`에 기록된다. | 원문 |
| **TC-02** | `FR-02`, `FR-05` | 소스 저장소가 있는 프로젝트 등록 | 프로젝트가 저장되고 코드베이스 분석(`site_analysis_run`)이 자동 시작된다. | 원문 |
| **TC-03** | `FR-03` | 전체·spec·케이스 단위 실행 | 요청 범위가 격리 러너에서 실행되고 케이스별 결과와 아티팩트가 수집된다. | 원문 |
| **TC-04** | `FR-04` | 스위트 저장 및 실행 | 지정한 spec·케이스 묶음으로 실행된다. | 원문 |
| **TC-05** | `FR-05`, `NFR-02` | 변경 없는 화면 재분석 | 동일한 `content_hash` 화면은 LLM을 다시 호출하지 않는다(`llm_calls` 미증가). | 원문 |
| **TC-06** | `FR-07` | 메모·제외 저장 후 재분석 | `site_node_edit` 편집 내용이 유지되고 제외(`excluded=true`) 화면은 생성 프롬프트에서 빠진다. | 원문 |
| **TC-07** | `FR-08`, `NFR-03` | 화면 기반 테스트 생성 및 실행 | `scenario_origin`에 화면·셀렉터 출처가 저장되고 실행 결과로 요소 `verification` 상태가 갱신된다. | 원문 |
| **TC-08** | `FR-09`, `FR-10` | AI 수정 검토·승인·거부 | diff가 조회되며 승인 전에는 파일에 반영되지 않고, 승인 후 `applied_commit_sha`가 기록된다. | 원문 |
| **TC-09** | `FR-12`, `NFR-02` | LLM 공급자 호출 및 예산 초과 | 설정된 공급자로 호출되고 사용량이 기록되며 월 예산 초과 시 차단된다. | 원문 |
| **TC-10** | `NFR-04` | 실행 로그 SSE 및 헬스 체크 | 실행 로그가 SSE 스트림으로 전달되고 `/actuator/health`로 API·DB 상태가 확인된다. | 원문 |
| **TC-11** | `SEC-01`, `FR-01` | 유휴 30분·절대 8시간 만료, 로그아웃 후 재요청 | `401 SESSION_EXPIRED` 반환; DB·로그 어디에도 세션 원문 토큰이 존재하지 않는다(`token_hash`만 존재). | 보완 |
| **TC-12** | `SEC-02`, `FR-02` | 타인 프로젝트 ID 및 하위 실행 ID 조회/변경 요청 | 타 프로젝트 자료 미노출, `403` 또는 `404` 반환 및 `user_audit_logs`에 `DENIED` 기록. | 보완 |
| **TC-13** | `FR-10`, `SEC-04` | 동일 AI 작업 동시 승인 요청 및 작성자 자기 승인 시도 | 반영은 정확히 1회만 성공; 동시 경쟁 요청은 `409 STATE_CONFLICT`, 자기 승인은 `403 SELF_APPROVAL_FORBIDDEN`. | 보완 |
| **TC-14** | `NFR-02` | 잔여 예산보다 큰 AI 요청 2건을 동시에 접수 | DB 잠금 기반 원자적 선예약으로 예산 초과 외부 호출 방지; 잔액 부족 요청은 `429 AI_BUDGET_EXCEEDED`. | 보완 |
| **TC-15** | `NFR-03` | 부분 분석 중 수치 상한 도달 및 시간(15분) 초과 | 상한 도달은 `partial=true`+경고, 시간 초과는 `FAILED` 기록; 사용자 편집 보존 및 미처리 화면 `stale` 오판 없음. | 보완 |
| **TC-16** | `FR-13` | 동일 예약을 2개 스케줄러가 동시 처리 및 서버 재시작 | `UNIQUE(schedule_id, scheduled_for)`로 실행 1건만 생성; `misfire_policy`(`FIRE_ONCE`/`SKIP`) 동작 일치. | 보완 |
| **TC-17** | `NFR-04` | Slack 일시 오류·중복 이벤트·서버 재시작 | `notification_outbox` 재시도(1s/5s/30s), 중복 발송 억제, 재시도 소진 시 `DEAD_LETTER` 전환. | 보완 |
| **TC-18** | `NFR-05` | 기준 데이터·동시 사용자 20명·기준 환경 15분 부하 테스트 | 메타 조회 `p95 ≤ 1초`, 비동기 접수 `p95 ≤ 2초`, 서버 `5xx < 1%`. | 보완 |
| **TC-19** | `SEC-03` | 내부 IP/메타데이터 URL·경로 탈출(`..`/symlink)·타 job 프록시 요청 | SSRF 대상 차단(`403 TARGET_BLOCKED`), 저장소 외부 경로 차단(`400`), 타 job 프록시 `403 JOB_SCOPE_MISMATCH`. | 보완 |
| **TC-20** | 운영 / DB | DB 백업 복원 훈련 및 보존 기간 초과 파일 정리 배치 | RPO(15분)/RTO(4시간) 검증; 참조 무결성 정상, 복원 후 만료 자료 재정리 동작 확인. | 보완 |
| **TC-21** | `FR-03`, `NFR-04` | SSE 연결 끊김 후 `Last-Event-ID`로 재연결 | 누락 로그 버퍼(최대 1,000건) 재전송 및 15초 heartbeat 확인, 만료 토큰은 `401` 재인증 요구. | 보완 |
| **TC-22** | API 계약 | 동일 `Idempotency-Key`로 동일 본문 / 상이한 본문 재요청 (재시작 포함) | 동일 본문은 기존 작업 ID 반환, 상이한 본문은 `409 IDEMPOTENCY_CONFLICT`; 서버 재시작 후에도 동일 동작. | 보완 |

### 9.2 완료 정의 (Definition of Done)
- 요구사항과 연결된 API·UI·데이터 저장 동작이 모두 구현되었다.
- 정상·실패 흐름과 `TC-01 ~ TC-22` 테스트 케이스를 수행하고 결과를 기록했다.
- AI 변경의 사람 승인(`created_by != reviewed_by`), 수정 허용 경로(`tests/**`)와 LLM 키 격리를 확인했다.
- 재분석 시 사용자 편집(`site_node_edit`) 보존과 실행 결과의 요소 확인 상태(`verification`) 반영을 확인했다.
- 기능 작성자가 아닌 리뷰어 1명 이상이 승인하고, QA 담당자가 정상·오류·권한·동시성 테스트 결과와 배포 스모크 결과를 확인했다.

---

## 10. 의사결정 확정 사항 및 단계별 개발 로드맵 (Implementation Plan)

### 10.1 설계 확정 사항 (2026-10-27 합의)
1. **코드베이스 분석 브랜치 통합**: `origin/feat/codebase-analysis-layout` 브랜치를 먼저 병합하여 원문 TRD v1.0 + PR #45 기준선(`ScreenFinder`, `ScreenExtractor`, `SelectorBuilder`, `SiteAnalysisService`, `SiteMapPromptService`, `StructureTab.tsx` 등)을 확보한다.
2. **공통 API 계약 적용 방식**: 기존 프론트엔드(`apps/web/src/api/client.ts`)와의 하위 호환성을 위해 기존 API의 성공 응답 구조는 유지하고, **신규/보완 엔드포인트 및 표준 오류 응답(`{error:{code,message,details}, requestId}`)**부터 점진적으로 적용한다.
3. **보안·인증·승인 정책**: TRD v1.2 원문 기준을 엄격히 적용한다.
   - 클라이언트 인증 토큰은 **브라우저 메모리에만 보관**(`localStorage` 미사용)하고, 서버 DB(`user_sessions`)에는 **SHA-256 `token_hash`**만 저장하며 **절대 8시간 / 유휴 30분 만료**를 적용한다.
   - AI 작업 승인은 **작성자 본인 승인 차단(`created_by != reviewed_by`, `403 SELF_APPROVAL_FORBIDDEN`)** 원칙을 적용한다(단, `ADMIN`의 예외 승인은 감사 로그 기록 후 허용).

### 10.2 단계별 개발 순서
실제 코드베이스(`apps/api`, `apps/web`)에 본 설계서를 반영하기 위한 개발 순서는 다음과 같다.

1. **Phase 1: 코드베이스 분석 브랜치 통합 (원문 기준선 확보)**
   - `origin/feat/codebase-analysis-layout` 브랜치를 작업 브랜치에 병합하여 `ScreenFinder`, `ScreenExtractor`, `SelectorBuilder`, `SiteAnalysisService`, `SiteMapPromptService`, 6개 엔티티(`Site*`, `ScenarioOrigin`), `StructureTab.tsx`를 통합하고 기존 테스트 통과 여부를 확인한다.
2. **Phase 2: DB 마이그레이션(Flyway) 및 보완 스키마 적용**
   - `apps/api/build.gradle`에 `flyway-core`, `flyway-database-postgresql` 의존성을 추가한다.
   - 현행 스키마 Baseline(`V1__init_schema.sql`)과 TRD v1.2 보완 스키마(`V2__trd_v1_2_schema.sql` — `owner_user_id`, `monthly_ai_budget_usd`, `version`, 부분 유일 인덱스, `idempotency_records`, `notification_outbox`, `user_sessions.token_hash` 등)를 작성한다.
3. **Phase 3: 보안·인증·세션 및 권한(Ownership / 4-Eyes) 강화**
   - `LoginSessionService` / `UserSession`: 32바이트 CSPRNG 토큰 발급 + SHA-256 `token_hash` 저장 + 8시간 절대 만료 / 30분 유휴 만료 적용, `POST /api/auth/logout` 구현, 프론트엔드 메모리 토큰 저장 전환.
   - `Project` 소유권(`owner_user_id`) 검사 인터셉터/서비스 적용, `AiJob` 승인 시 `created_by != reviewed_by`, `expectedVersion`, `baseCommitSha`, `riskAcknowledged` 검증 및 `user_audit_logs` 확장.
   - Rate Limiting 필터 및 SSRF/경로 탈출(`realpath`) 검증 강화.
4. **Phase 4: LLM 게이트웨이 확장 (Bedrock + 월 예산 선예약/정산 + 내부 프록시 토큰)**
   - `BedrockTransport` 구현 및 `AiProviderSettings` 공급자별 설정/단가 구조 반영.
   - `LlmGatewayService`에 프로젝트 월 예산 선예약(`RESERVED`) → 정산(`SUCCEEDED`/`FAILED`) 원자적 트랜잭션 및 타임아웃(90s)/재시도(1s, 3s) 적용.
   - `/internal/ai-jobs/{jobId}/llm`용 15분 만료 서명 토큰 검증 적용.
5. **Phase 5: 공통 API 계약, 멱등성(`Idempotency-Key`), 스케줄러·알림 Outbox·보존 배치**
   - 표준 오류 응답 래퍼(`{error, requestId}`), `Idempotency-Key` 영속 처리, SSE `Last-Event-ID` 1,000건 버퍼링 구현.
   - `ExecutionScheduleService`의 `UNIQUE(schedule_id, scheduled_for)` 중복 방지 및 `misfire_policy` 적용.
   - Slack `notification_outbox` 재시도 워커 및 데이터 보존 기간 정리 스케줄러 구현.

