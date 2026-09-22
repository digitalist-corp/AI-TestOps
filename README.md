# AI-TestOps

**Opensource(Playwright) 기반 테스트 자동화 플랫폼 — 프로젝트 등록부터 시나리오 작성, 실행, 결과 분석, 팀 협업까지 하나의 웹 서비스에서 처리합니다.** AI 어시스턴트가 시나리오 생성·실패 원인 분석·자율 수정을 곳곳에서 보조합니다.

전담 QA 인력이 없는 개발팀도 스스로 신뢰할 수 있는 테스트 자동화를 운영할 수 있게 하는 것이 AI-TestOps의 목표입니다.

> **2026-2 고도화 방향** — 말로 요청하면 AI가 대상 사이트의 실제 화면을 보고 테스트를 작성 · 실행하고, 실패를 분류 · 수정해 사람 승인 후 PR로 반영하는 **LangGraph AI 루프**, 실패 추이를 보여주는 **QA 인텔리전스 대시보드**, **모바일 환경**을 개발 중입니다. 자세한 내용은 [AI 개선안](docs/ai-improvement-plan.md)을 참고하세요.

---

## 프로젝트 차터 (Project Charter)

> 기준 문서: 프로젝트 차터 **v1.6 (2026-09-22)** · PRD v1.6 · WBS v9 · 프로젝트 마일스톤 v1.02 · [AI 개선안](docs/ai-improvement-plan.md)

### 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | **AI-TestOps** — Playwright 기반 AI 테스트 자동화 플랫폼 |
| 과제명 | LangGraph 기반 AI 테스트 루프와 분석 대시보드 · 모바일 환경을 갖춘 AI-TestOps 고도화 |
| 팀 | aQm (장준호 · 김윤재 · 박준서 · 장동현) |
| 저장소 | https://github.com/digitalist-corp/AI-TestOps |
| 수행 기간 | 2026-08-28 ~ 진행 중 (캡스톤 과제: 2026-09-14 ~ 2026-12-11, 3~15주차) |
| 소속 / 과정 | 한성대학교 · 2026 상상더하기 프로젝트 · 기업연계 SW 캡스톤디자인 |
| 프로젝트 유형 | 웹 기반 사내 테스트 운영 도구 (자체 서버 배포) |
| 문서 버전 | v1.6 (2026-09-22) |

### 2. 배경 및 문제 정의

- 기존 AI-TestOps는 Playwright 테스트 코드를 사용자가 직접 작성해야 하고, AI 테스트 생성도 **실제 대상 사이트를 보지 않고 설명만으로** 코드를 만들어 셀렉터가 틀리기 쉽다.
- AI 기능(채팅 · 분석 · 생성 · 수정)이 **단계마다 끊겨 있어** 생성 · 실행 · 분석 · 수정 · 커밋마다 사람이 직접 이어 줘야 하고, AI 채팅은 프로젝트 파일 · 실행 결과에 접근할 수 없다.
- 실패가 나면 **테스트 문제인지 앱 버그인지 환경 문제인지** 판단할 근거가 없어 로그를 하나씩 열어봐야 하고, 같은 원인의 실패를 묶거나 과거에 성공한 수정을 다시 쓰지 못한다.
- 모든 테스트가 Desktop Chrome 단일 설정(`--project=chromium`)으로만 실행되어 모바일에서만 발생하는 결함을 검증하지 못한다.

> **핵심 문제** — 테스트를 만들기 어렵고, 실패의 의미를 가리기 어렵고, AI가 단계마다 끊겨 있다. 즉 자동화 테스트가 운영에 정착하지 못한다.

### 3. 목적 및 목표

**목적**

1. 사용자가 채팅으로 말하면("로그인 실패 케이스 만들고 돌려줘") AI가 대상 사이트의 **실제 화면을 보고** 시나리오 · 케이스를 계획 · 작성하고, 실행 → 실패 분류 → 수정 → 재검증을 **하나의 LangGraph 루프**로 이어 사람 승인 후 브랜치 · PR로 반영한다.
2. 실행이 실패하면 루프가 즉시 시작되어 AI가 테스트 문제 · 앱 버그 · 환경 문제로 분류하고, 과거에 성공한 수정을 참고해 수정안을 만들어 검증한다. 원인을 아는 결함을 심은 평가셋으로 AI 품질을 측정한다.
3. 실패 · 수정 이력을 집계해 루프의 우선순위와 수정 재사용에 쓰고, 실패 추이 · 오류 유형 맵 · AI 수정 지식 · 에이전트 타임라인을 대시보드로 제공하며, 모바일 기기 프로필 실행과 모바일 승인을 지원한다.

**목표 및 성공 기준**

| ID | 목표 | 성공 기준 |
|----|------|-----------|
| F-01 | 대상 사이트 · 실제 화면 관찰 | 대상 사이트 2종 등록, Playwright MCP로 주요 페이지 · 폼 · 흐름 수집 |
| F-02 | 자연어 테스트 작성 (흐름 A) | 자연어 요청 20건 중 **60% 이상** 사람 수정 없이 통과, 게이트 위반 반영 0건 |
| F-03 | 실패 즉시 AI (흐름 B) | 심은 결함 20건 분류 정확도 **70% 이상**, 실패 시 사람 클릭 없이 수정안까지 생성 |
| F-04 | 실패 · 수정 이력 분석 | 실행 · 케이스 · AI 작업 이력 100% 집계, 오류 유형별 과거 성공 수정 조회 · 전후 측정 |
| F-05 | QA 인텔리전스 대시보드 | 실패 추이 · 오류 유형 맵 · AI 수정 지식 · 커버리지 공백/불안정 4종 + 에이전트 타임라인 |
| F-06 | 모바일 기기 테스트 · 화면 | 기기 프로필 3종 실행 · 케이스 × 기기 비교, 실기기에서 결과 조회 · 재실행 · 승인 |
| F-07 | 알림 강화 | 알림 센터 · Web Push, 같은 오류 유형은 알림 1건으로 묶음, 승인 대기 알림 |
| F-08 | LangGraph AI 루프 | 실패 → 분류 → 수정 → 승인 → PR 1회전, 반복 시 실패 감소, 정지 조건 동작 |
| — | 기존 품질 유지 | 자체 회귀 테스트 전건 통과, 사람 승인 없는 AI 반영 **0건**, main 직접 반영 **0건** |

### 4. 범위

| In Scope | Out of Scope |
|----------|--------------|
| [필수] 대상 사이트 등록 · Playwright MCP 실제 화면 관찰 | 허가받지 않은 외부 사이트의 탐색 · 테스트 |
| [필수] 채팅 자연어 요청 → Test Agents 계획 · 작성 · 실행 · 보정 (흐름 A) | 결제 · 탈퇴 등 되돌릴 수 없는 실동작 (테스트 모드 제외) |
| [필수] 실행 실패 즉시 루프 시작 · 실패 분류 · 테스트 수정 (흐름 B) | 승인 없는 AI 변경 반영, main 직접 반영, 하드 게이트 완화 |
| [필수] LangGraph AI 루프 (Python ai-service, 승인 3곳 · 체크포인트 재개 · 브랜치 + PR) | LLM이 도구를 제한 없이 고르는 완전 자율 에이전트 방식 |
| [필수] 실패 · 수정 이력 분석 (오류 유형 정규화 · 집계 · 과거 수정 조회 · 경량 조회 API) | 별도 그래프 DB · 외부 BI 분석 도구 도입 |
| [필수] 대시보드 4종 + 에이전트 타임라인 | 외부 오픈소스 도구 연동 (Redmine · SonarQube 등) |
| [필수] 실행 프로필 기반 모바일 기기 테스트 · 모바일 화면 · 모바일 승인 | 네이티브 앱 테스트 (Appium · iOS 앱), 실기기 팜 |
| [필수] 알림 센터 · Web Push · 같은 오류 유형 묶음 알림 | 이메일 · SMS · 메신저 채널, 원격 셸(SSH 터미널) 기능 |
| [확장] 앱 코드 수정 에이전트(PR 제안), 알림 규칙 · 방해금지 | 자체 LLM 모델 개발 · 학습 |

### 5. 주요 요구사항

| ID | 요구사항 | 중요도 |
|----|----------|--------|
| R-01 | 대상 사이트(URL · 테스트 계정 · 허용 도메인 · 금지 동작)를 프로젝트에 등록한다 | 상 |
| R-02 | Playwright MCP로 대상 사이트의 실제 화면(접근성 트리)을 관찰해 페이지 · 요소 · 폼 · 흐름을 수집한다 | 상 |
| R-03 | 채팅 자연어 요청을 받으면 Playwright Test Agents(planner · generator)가 실제 화면을 근거로 시나리오 · 케이스를 계획 · 작성한다 | 상 |
| R-04 | 작성한 케이스를 실행하고, 실패하면 healer · 수정 노드가 보정해 격리 컨테이너에서 재검증한다 | 상 |
| R-05 | AI 결과는 게이트를 통과하고, 시나리오 확정 · 수정안 반영 · PR 생성 3곳에서 사람이 승인해야 `ai/{jobId}` 브랜치와 PR로 반영된다 | 상 |
| R-06 | 실행이 실패하면 AI 루프가 자동으로 시작되고, 실패 화면에서도 바로 AI 분석 · 수정을 요청할 수 있다 | 상 |
| R-07 | 실패를 테스트 문제 · 앱 버그 · 환경 문제로 분류하고 근거와 이슈 상태 · 우선순위를 제안한다 (healer의 `fixme`는 앱 버그 의심 신호) | 상 |
| R-08 | 실행 결과별 이슈 워크플로(검토 필요 → 조치 필요 → 조치 완료, 담당 · 기한 · 변경 이력)를 제공한다 | 중 |
| R-09 | 오류 메시지를 정규화해 오류 유형으로 묶고, 케이스 · 기기 · 시점 · 코드 버전별로 집계해 경량 조회 API(GraphQL)로 제공한다 | 상 |
| R-10 | 같은 오류 유형의 과거 성공 수정을 조회해 수정안에 쓰고(recall), 수정 전후 실패 수 · 오류 유형 수 · flaky 비율을 기록한다(measure) | 상 |
| R-11 | 대시보드에 실패 추이 · 오류 유형 맵 · AI 수정 지식 · 커버리지 공백/불안정 패널과 에이전트 타임라인을 제공한다 | 상 |
| R-12 | Python LangGraph AI 루프(ingest → cluster → prioritize → classify → recall → fix → approve → pr_and_run → measure → decide)를 구성하고, 체크포인트로 승인 대기 · 재개하며, 최대 반복 · 비용 예산 · 개선 정체 시 사람에게 넘긴다 | 상 |
| R-13 | AI 서비스는 API 키 · 파일에 직접 접근하지 않고 api 도구(`generate_scenario` · `run_tests` · `get_results` · `classify_failure` · `fix_test` · `open_pr` 등)와 LLM 프록시만 호출한다 | 상 |
| R-14 | 실행 프로필(PC · iPhone · Android)로 같은 케이스를 실행하고 케이스 × 기기 매트릭스로 모바일 전용 실패를 표시한다 | 상 |
| R-15 | 모바일 화면(폭 360px 이상)에서 결과 조회 · 실패 재실행 · AI 승인(루프 재개)을 할 수 있다 | 중 |
| R-16 | 알림 센터와 Web Push를 제공하고, 같은 오류 유형의 실패와 승인 대기를 묶어 알린다 | 중 |
| R-17 | 러너 격리를 보강한다 (외부 통신 제한 · root 금지 · CPU · 메모리 · 프로세스 수 제한 · `docker.sock` 차단) | 중 |
| R-18 | 원인을 아는 결함을 심은 평가셋과 promptfoo · Langfuse로 작성 성공률 · 수정 성공률 · 분류 정확도 · 비용을 측정한다 | 상 |

### 6. 주요 산출물

| 단계 | 산출물 |
|------|--------|
| 착수 · 요구정의 | 프로젝트 차터, PRD(요구사항정의서), [AI 개선안](docs/ai-improvement-plan.md), 대상 사이트 선정서, 수작업 기준선 측정 결과 |
| 분석 · 설계 | 분석 지표 정의서, TRD, AI 루프 설계서(노드 · 도구 · 승인 지점), UI 화면 설계서, 아키텍처 정의서, AI 평가셋 설계서 |
| 구현 · 테스트 | api 도구 계층 · ai-service(LangGraph AI 루프), 흐름 A · B, 실패 · 수정 이력 분석 모듈, 대시보드 · 에이전트 타임라인, 모바일 테스트 · 화면 · 알림 모듈, AI 품질 측정 결과, 테스트 결과서 |
| 평가 · 마무리 | 프로젝트 결과서, 최종 발표 자료, GitHub 소스 |
| 기술 문서 | [Architecture](docs/architecture.md), [To-Be Architecture](docs/tobe-architecture.md), [AI Integration Architecture](docs/ai-integration-architecture.md), [AI Job Spec](docs/ai-job-spec.md), [AI 개선안](docs/ai-improvement-plan.md) |

### 7. 이해관계자 및 역할

| 구분 | 담당 | 역할 |
|------|------|------|
| 지도 | **지도교수님** | 프로젝트 방향 지도, 산출물 검토 및 피드백 |
| 총괄 · 현업 검토 | **부장님** | 플랫폼 전체 설계 및 구현, 테스트 서버 제공, 현업 관점 사용성 검토 및 개선 의견 제시 |
| PM · FE | **장준호** ([@Junho73](https://github.com/Junho73)) | 일정 · 범위 · 문서 총괄, 분석 지표 설계(김윤재와 공동), 채팅 · 승인 화면, 에이전트 타임라인, QA 인텔리전스 대시보드 |
| BE · Server | **김윤재** ([@YoonJae00](https://github.com/YoonJae00)) | 대상 사이트 구축 · 운영, ai-service(LangGraph 루프 · 체크포인트) 뼈대, 실패 · 수정 이력 저장 · 조회 API(GraphQL), 러너 격리 보강, 서버 · CI/CD 운영 |
| 모바일 | **박준서** | 실행(기기) 프로필 · 기기별 실행 · 결과 저장, 케이스 × 기기 매트릭스 · 재실행 API, 모바일 화면 · 모바일 승인(루프 재개) · 알림 센터(PWA) |
| AI | **장동현** | api 도구 계층 · 채팅 tool calling, classify · fix · generate 노드와 프롬프트, Playwright Test Agents · MCP 연동, 평가셋 · promptfoo · Langfuse, Web Push · 묶음 알림 서버 |

### 8. 마일스톤

| 시점 | 마일스톤 | 상태 |
|------|----------|------|
| 2026-08-28 | 플랫폼 초기 구현 — Web/API/Worker 3계층, 실행 오케스트레이션 | ✅ 완료 |
| 2026-08 ~ 09 | AI 기능 통합 — 시나리오 생성, 실패 분석, 자율 수정 루프 | ✅ 완료 |
| 2026-09 초 | 테스트 서버 배포 + CI/CD 자동화 (self-hosted runner) | ✅ 완료 |
| 2026-09-06 | 현업 피드백 반영 — AI 실행 검증, 자체 회귀 테스트, CI 배포 게이트 | ✅ 완료 |
| 2026-09-11 | ERD 산출물 작성 (15개 테이블 / 17개 관계) | ✅ 완료 |
| 3~4주 (09-14 ~ 09-25) | Inception — 차터 · PRD · AI 개선안 확정, 대상 사이트 선정, Playwright 1.56+ · 기기 프로필 PoC | 🔄 진행 중 |
| 5~6주 (09-28 ~ 10-09) | Sprint #1 — api 도구화 · ai-service 뼈대 · 채팅 tool calling ("만들고 돌려줘" 한 문장 동작) | 📋 예정 |
| 7~8주 (10-12 ~ 10-23) | Sprint #2 — AI 루프 ingest ~ classify · fix 노드 · interrupt 승인 (실패 → 수정 → 승인 1회전) | 📋 예정 |
| 9~10주 (10-26 ~ 11-06) | Sprint #3 — recall · measure · 브랜치 + PR · 대시보드 · 에이전트 타임라인, **중간발표** | 📋 예정 |
| 11~12주 (11-09 ~ 11-20) | Sprint #4 — 러너 격리 보강 · 앱 코드 수정(확장) · promptfoo · Langfuse, 리허설 | 📋 예정 |
| 13주 (11-23 ~ 11-27) | Sprint #5 — SW 중심대학 페스티벌 전시 · 시연 | 📋 예정 |
| 14~15주 (11-30 ~ 12-11) | Retrospective — **최종발표**, 결과물 제출 | 📋 예정 |

### 9. 아키텍처 원칙

기능 확장 과정에서도 다음 원칙은 **타협 대상이 아니다.**

1. **실행 격리** — 모든 테스트/AI 검증 작업은 일회성(Ephemeral) 컨테이너에서 실행하고 작업 후 폐기한다.
2. **권한 최소화** — `docker.sock`, Git 자격증명, LLM API 키는 중앙 `api` 서비스만 보유한다. AI 서비스는 api 도구와 LLM 프록시만 호출한다.
3. **사람 승인 게이트** — AI가 만든 변경은 시나리오 확정 · 수정안 반영 · PR 생성 3곳에서 사람이 승인해야 반영된다(`aiAutoApplyEnabled` 기본값 `false`).
4. **브랜치 + PR** — AI 변경은 `ai/{jobId}` 브랜치와 PR로만 나가며, PR에서 자체 회귀 게이트를 실행한다. main 직접 반영은 하지 않는다.
5. **변경 범위 제한** — AI가 수정할 수 있는 경로를 프로젝트별 allow/deny 글롭으로 제한하고, 테스트 코드와 앱 코드 정책을 분리한다.
6. **결정은 코드, 판단만 LLM** — 실패 묶기 · 수치 계산은 코드로, 원인 분류 · 수정 · 요약만 LLM으로 처리한다.
7. **사후 검증** — 승인된 변경도 회귀 감지를 위해 한 번 더 검증한다.

### 10. 제약사항 및 가정

**제약사항**

- 테스트 서버는 사내 제공 단일 서버이며, 외부 인바운드는 SSH와 HTTP 포트만 개방되어 있다.
- 외부에서 GitHub 호스티드 러너가 서버에 접속할 수 없어 **self-hosted runner**를 사용한다.
- AI 기능은 외부 LLM 공급자(Claude / GPT) API에 의존하며, 사용량에 따라 비용이 발생한다.
- 동시 실행 수는 서버 RAM에 직접 제약된다(`WORKER_CONCURRENCY`).

**가정**

- 대상 프로젝트는 Playwright로 테스트 가능한 웹 애플리케이션이며, 자동 테스트가 허용된 사이트만 다룬다.
- 저장소 연동 시 사용하는 자격증명은 최소 권한으로 발급된다.
- 팀원은 GitHub 저장소에 대한 접근 권한을 보유한다.

### 11. 리스크 및 대응

| 리스크 | 가능성 | 영향 | 대응 |
|--------|--------|------|------|
| 범위 과다 | 매우 높음 | 상 | 핵심 루프(말로 요청 → 작성 → 실행 → 분류 → 수정 → 승인 → PR) 먼저 완료, 확장 기능은 10주차 중간발표에서 재조정 |
| AI 루프 무한 반복 · 비용 증가 | 중 | 상 | 최대 반복 · 비용 예산 · 개선 정체 2회 시 정지 후 사람에게, 저비용 모델 기본, Langfuse로 비용 추적 |
| AI 작성 · 수정 품질 편차 | 높음 | 상 | 실제 화면(DOM) 기준 작성, 격리 컨테이너 재검증, 게이트 · 사람 승인, 평가셋으로 개선 전후 비교 |
| AI 변경이 코드를 훼손 | 중 | 상 | 항상 `ai/{jobId}` 브랜치 + PR, 승인 3곳, 경로 정책 분리, PR에서 자체 회귀 게이트 |
| Playwright 업그레이드 호환성 | 중 | 중 | 1.53 → 1.56+ 전환을 4주차 PoC로 먼저 검증, 러너 이미지 버전 고정 |
| 대상 사이트 선정 지연 | 중 | 중 | 4주차 안에 확정, 후보 2종을 미리 설치해 두고 선택 |
| 에뮬레이션과 실제 기기 차이 | 중 | 중 | 실기기(Android · iOS) 수동 점검 병행 |
| 테스트 서버 자원 한계 | 중 | 중 | 동시 실행 · AI 작업 수 상한과 러너 대기열 정책, [Runtime Sizing](docs/ops-sizing.md) 기준 운영 |

### 12. 성공 기준

1. 대상 사이트에서 자연어 요청 20건 중 **60% 이상**이 사람 수정 없이(자동 보정 포함) 통과하는 케이스로 작성되고, 사이트 등록부터 첫 통과 케이스까지 걸리는 시간이 수작업 기준선보다 짧다.
2. 원인을 아는 결함 20건을 심은 평가셋에서 실패 분류(테스트 · 앱 버그 · 환경) 정확도가 **70% 이상**이고, 실패 → 분류 → 수정 → 승인 → PR이 한 번의 루프로 이어진다.
3. 루프를 반복할수록 열린 실패 수가 줄어드는 것이 대시보드의 실패 추이와 에이전트 타임라인으로 확인되고, 같은 케이스가 PC · iPhone · Android 프로필로 실행되며, 14주차 최종발표에서 말로 요청부터 실패 감소까지 시연한다.

**현재 기준선 (2026-09 실측)**

| 기준 | 목표 | 현재 실측 |
|------|------|-----------|
| 자체 회귀 테스트 | 전 케이스 통과 및 재현성 확보 | **5/5 통과, 3회 연속 재현** (회당 약 82.6초) |
| CI 배포 게이트 | 회귀 발생 시 배포 차단 | **동작 확인** — 실패 시 워크플로 실패 처리 |
| AI 생성 케이스 실행 검증 | 생성 즉시 통과/실패 판별 | **동작 확인** — 4건 중 2건 실패 검출(AI 추정 오류) |
| AI 변경 안전성 | 사람 승인 없는 자동 반영 0건 | **충족** — 기본값 `false` 유지 |
| 배포 자동화 | main 병합 시 무인 배포 | **충족** — 배포 → 헬스체크 → 회귀 게이트 자동 수행 |

---


## 왜 AI-TestOps인가

- **반복적인 회귀 테스트 부담** — 배포 주기는 빨라지는데 수동 QA로는 속도를 따라갈 수 없습니다.
- **테스트 코드 작성 진입장벽** — Opensource(Playwright) 문법을 몰라도 자연어로 요구사항을 적으면 AI가 시나리오를 생성합니다.
- **실패 원인 파악에 드는 인건비** — AI가 실패 로그를 분석하고, 필요하면 스스로 코드를 수정해 재검증까지 시도합니다(사람 승인 후 반영).
- **결과 가시성 부족** — 실패/AI 검토 필요/AI 자동 되돌림 시 Slack으로 즉시 알림이 갑니다.

## 핵심 기능

### 프로젝트 & 시나리오
- GitHub 저장소 연동 — 프로젝트 소유 저장소를 격리된 Docker 샌드박스에서 clone·실행
- Opensource(Playwright) 시나리오 작성/편집 — 소스 탐색기 + Monaco 에디터, 파일 트리 기반 관리
- 자연어 → 테스트 시나리오 생성 — 기존 프로젝트에 자연어 요구사항으로 새 케이스 추가 (승인 전까지는 검토 대기 상태)
- Opensource(Playwright) 템플릿 — 신규 프로젝트 등록 시 기본 소스 자동 생성(`default`, `e2e-standard`)
- 로그인/설정 선행 시나리오 — 세션(storageState)을 재사용해 매 실행마다 로그인 반복 없이 시작

### 실행 & 오케스트레이션
- 프로젝트별 Docker Runner 컨테이너에서 격리 실행 (Ephemeral Scoped Runner)
- 예약 실행(스케줄러) — 요일·시각을 지정한 자동 실행, API 프로세스 내 경량 스케줄러가 트리거만 담당
- Test Suite(테스트 묶음) — 선택한 케이스들을 이름 붙여 저장하고 한 번에 재실행
- 실행 로그 실시간 스트리밍, 케이스별 재실행 이력 조회

### AI 어시스턴트
- **AI 시나리오 생성** — 자연어 요구사항을 Opensource(Playwright) 코드로 변환
- **AI 자율 수정 루프(CODE_FIX)** — 실패한 테스트를 AI가 스스로 반복 분석·수정 시도 후 재실행으로 통과 검증. 수정 결과는 자동 반영되지 않고 **AI 검토 대기** 화면에서 사람이 승인해야 실제 파일에 적용됩니다. 승인된 변경도 사후 검증(회귀 감지)을 한 번 더 거칩니다.
- **AI 분석** — 실패 원인을 기술 수준(비전공자·주니어·시니어)에 맞춰 진단·해설
- **전역 AI 챗봇** — 로그인 후 모든 화면에서 접근 가능한 도우미, 페이지를 이동해도 대화가 유지됩니다
- 변경 허용 범위는 프로젝트별 `allowedPathGlobs` / `deniedPathGlobs`로 제한되는 안전장치가 있습니다
- **(개발 중) LangGraph AI 루프** — 채팅 한 문장("만들고 돌려줘")으로 작성 · 실행, 실행 실패 시 자동으로 분류 · 수정안 생성, 승인 3곳(시나리오 · 수정안 · PR)을 거쳐 `ai/{jobId}` 브랜치 + PR로 반영 → [AI 개선안](docs/ai-improvement-plan.md)

### 결과 & 협업
- 테스트결과(실패) UI — 실패 케이스를 제목·에러 메시지와 함께 인라인 표시
- 대시보드 — 실행 현황·추이 시각화
- Slack 알림 — 테스트 실패 / AI 검토 필요 / AI 자동 되돌림 시 Webhook으로 즉시 알림
- 공지/게시판

### 운영 & 보안
- 사용자 관리 — 계정(ADMIN/USER) 생성·수정, 비밀번호 해싱(BCrypt), 삭제/역할변경 안전장치, 감사 로그
- Runner 컨테이너 관리 — Docker 상태·정리
- AI 공급자 키(Claude/GPT) 관리자 등록 — AES-GCM으로 암호화 저장, 모든 프로젝트가 공용으로 사용
- 실행 컨테이너에는 git 자격 증명과 `docker.sock`이 전달되지 않으며, egress는 AI 공급자 API와 콜백 엔드포인트로 제한됩니다

## 아키텍처

```text
apps/
  web     # React + Vite 웹 화면
  api     # Spring Boot API 서버 (핵심 오케스트레이션, AI 게이트웨이, 스케줄러)
  worker  # Opensource(Playwright) 실행 워커(Node)
packages/
  common
  playwright-engine
  report-core
infra/
  docker
```

**설계 원칙 — Ephemeral Scoped AI Runner**

- `api`만 `docker.sock`에 접근하는 유일한 컴포넌트이며, 기존 Opensource(Playwright) Runner 패턴을 AI 작업에도 동일하게 적용합니다.
- AI/테스트 실행 컨테이너는 작업 단위로 생성되고 종료되는 일회성 컨테이너입니다. 상시 구동되는 프로젝트별 서버는 두지 않습니다.
- 프로젝트마다 독립된 Docker 볼륨을 사용해 다른 프로젝트의 코드에 접근할 수 없습니다.
- Git 자격 증명은 `api`만 보유하며, 실행 컨테이너는 이미 체크아웃된 코드만 받고 결과/diff를 볼륨에 기록하면 `api`가 커밋·푸시를 대행합니다.
- 실행 컨테이너의 네트워크는 AI 공급자 API·콜백 엔드포인트로만 제한된 격리 네트워크를 사용합니다.

**To-Be — AI 루프 서비스 (개발 중)**

- 중앙 `ai-service`(Python · LangGraph) 1개가 여러 프로젝트의 AI 작업을 처리합니다. 프로젝트별 상시 AI 서버는 두지 않습니다.
- `ai-service`는 API 키와 파일에 직접 접근하지 않고, `api`가 제공하는 도구(REST / MCP)와 LLM 프록시만 호출합니다.
- 실행 · 수정 검증은 지금처럼 일회용 컨테이너에서 하고, 승인 대기 상태는 PostgreSQL 체크포인트에 저장해 재시작 후에도 이어집니다.
- AI 변경은 사람 승인 후 `ai/{jobId}` 브랜치와 PR로만 나가며, PR에서 자체 회귀 게이트를 실행합니다.

자세한 배경은 [`docs/ai-integration-architecture.md`](docs/ai-integration-architecture.md), [`docs/ai-job-spec.md`](docs/ai-job-spec.md), [`docs/ai-improvement-plan.md`](docs/ai-improvement-plan.md) 참고.

## 기술 스택

| 영역 | 기술 |
|------|------|
| Web | React, Vite, TypeScript, Tailwind CSS, ag-Grid, ECharts, Monaco Editor |
| API | Spring Boot 3(Java 21), Spring Data JPA, PostgreSQL |
| Worker | Node.js, Opensource(Playwright) |
| 실행 격리 | Docker (프로젝트/AI 작업별 컨테이너) |
| AI | Claude / GPT (관리자 등록 공용 키, LLM Gateway로 단일화) |
| AI 루프 (개발 중) | Python LangGraph + PostgresSaver, Playwright 1.56+ Test Agents · MCP, Spring AI `@McpTool`, promptfoo · Langfuse |
| 인프라 | Docker Compose, Nginx(리버스 프록시) |

## 빠른 시작

### Docker (운영/통합 확인 모드)

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:8080/actuator/health
- PostgreSQL: localhost:5432
- 기본 로그인: `admin` / `admin`

### 개발 모드 (권장)

FE/API 코드를 수정하며 개발할 때 사용합니다. Web은 Vite HMR로 브라우저에 바로 반영되고,
API는 Gradle continuous compile + Spring DevTools restart로 변경 사항을 자동 반영합니다.
프로젝트별 Opensource(Playwright) Runner는 Docker 컨테이너로 유지됩니다.

```bash
npm run dev
# 백그라운드 실행이 필요하면:
docker compose -f docker-compose.dev.yml up -d --build
```

종료: `npm run down:dev` · 로그: `npm run logs:dev`

- Web: http://localhost:3000
- API: http://localhost:8080/actuator/health
- API Debug: localhost:5005
- PostgreSQL: localhost:5432

반영 방식:

- `apps/web/src` 수정 → Vite HMR로 브라우저에 즉시 반영
- `apps/api/src/main/java` 수정 → 컨테이너 안에서 재컴파일 후 Spring DevTools가 API 재시작
- `apps/api/src/main/resources` 수정 → DevTools 재시작 대상
- `apps/web/package.json` 또는 API Gradle 의존성 변경 → 컨테이너 재빌드 권장

### 모드 전환

개발 모드와 운영 모드는 같은 컨테이너 이름과 포트를 사용합니다. 전환할 때는 먼저 기존 모드를 내린 뒤 다른 모드를 올립니다.

```bash
docker compose down
docker compose -f docker-compose.dev.yml down

npm run dev   # 또는 npm run prod
```

### 로컬 개발 (dev 프로필 + PostgreSQL, Docker 없이)

1. PostgreSQL만 기동: `docker compose up postgres`
2. API (Java 21, Gradle):

```bash
cd apps/api
gradle bootRun
# 기본: SPRING_PROFILES_ACTIVE=dev → localhost PostgreSQL
```

Java가 PATH에 없다면 프로젝트 내 JDK 사용:

```powershell
$env:JAVA_HOME = (Resolve-Path .\utils\bin\jdk-21).Path
cd apps/api
.\gradlew.bat test
```

3. Web:

```bash
cd apps/web
$env:VITE_API_PROXY="http://localhost:8080"   # Windows PowerShell
npm run dev
```

## Opensource(Playwright) 템플릿

프로젝트 등록 시 **기본 Opensource(Playwright) 소스를 자동 생성**합니다 (권장).

| 템플릿 ID | 설명 |
|-----------|------|
| `default` | example.com 샘플 spec + `playwright.config.ts` |
| `e2e-standard` | fixtures, Page Object 샘플 포함 E2E 구조 |

- 소스 위치: `apps/api/src/main/resources/templates/{templateId}/`
- Web: **Opensource(Playwright) 템플릿** 메뉴에서 파일 트리·미리보기
- API: `GET /api/templates`, `POST /api/projects/{id}/scaffold`

등록 폼에서 템플릿 선택 및 「등록 시 기본 소스 자동 생성」 체크 가능. 기존 파일이 있으면 건너뛰며, 상세 화면에서 **덮어쓰기**로 재생성할 수 있습니다.

## 프로젝트 워크스페이스 (상세 화면)

프로젝트 상세는 탭으로 구성됩니다.

| 탭 | 기능 |
|----|------|
| **소스 탐색기** | 파일 트리, 텍스트 편집·저장, ZIP/템플릿, AI 수정 도움 |
| **시나리오** | spec 파싱 → describe/test 트리, 케이스별 실행, 자연어 케이스 생성 |
| **실행** | 전체/필터 실행, 이력 그리드 (3초 폴링) |
| **결과** | 통과/실패 요약, HTML 리포트 iframe, trace/video/screenshot 링크, 실패 케이스 인라인 표시 |
| **AI 분석** | 수준별(비전공자/주니어/시니어) 실패 원인 진단, AI 자율 수정(Sandbox 루프) 요청 |
| **예약 실행** | 반복 자동 실행 스케줄 관리 |
| **설정** | 환경변수·Docker Runner |

실행은 프로젝트별 Docker Runner 컨테이너에서 `npm install` → `playwright test` 후 `/storage/reports/{projectId}/{executionId}/`에 결과를 저장합니다. `PLAYOPS_DOCKER_ENABLED=true` 필요.

### 고급 기능

- **Monaco 에디터**: 소스 탭에서 TypeScript/JSON 등 구문 강조 편집, AI에게 수정을 요청하면 편집 중인 버퍼가 바로 갱신되고 저장/취소로 확정
- **로그 스트리밍**: 실행 탭·결과 탭에서 `stream.log` 실시간 폴링 (500ms)
- **케이스별 재실행 이력**: 시나리오 탭에서 테스트 케이스 클릭 → 동일 grep 필터 실행 이력 조회·재실행
- **AI 검토 대기**: AI가 생성/수정한 코드는 관리자가 diff를 확인하고 승인해야 실제 파일에 반영

## 운영 방향

- 프로젝트별 Opensource(Playwright) 소스는 `playwright-projects/{projectKey}` 아래 볼륨으로 관리합니다.
- 프로젝트별 Node/Opensource(Playwright) 버전 차이가 크면 워커 이미지를 프로젝트별로 분리하거나, 실행 컨테이너를 동적으로 생성하는 구조로 확장합니다.
- API DB는 dev/prod 모두 PostgreSQL을 사용합니다.
- 예약 실행은 API 프로세스 내 경량 스케줄러가 "지금이 실행 시각인가"만 판단하고, 실제 실행은 수동 실행과 동일하게 일회성 Runner를 생성해 위임합니다.

## 문서

- [Architecture](docs/architecture.md)
- [To-Be Architecture](docs/tobe-architecture.md)
- [AI Integration Architecture](docs/ai-integration-architecture.md)
- [AI Job Spec](docs/ai-job-spec.md)
- [AI 개선안 (2026-09-22)](docs/ai-improvement-plan.md)
- [Scenario and Environment Management](docs/scenario-env-management.md)
- [Runtime Sizing](docs/ops-sizing.md)
- [First Run Troubleshooting](docs/first-run-troubleshooting.md)

프로젝트 차터 · PRD(요구사항분석서) · WBS · 마일스톤 · TRD(기술설계서) · UI 화면설계서는 별도 산출물 문서로 관리되며, README의 프로젝트 차터는 차터 v1.6 기준입니다.
