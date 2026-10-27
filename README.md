# AI-TestOps

### 🔗 바로 써 보기: https://southampton-classifieds-conscious-charms.trycloudflare.com

> 테스트 서버의 임시 주소(Cloudflare 터널)입니다. 서버가 재시작되면 주소가 바뀔 수 있습니다. 계정은 팀에 문의해 주세요.

**저장소를 연결하면 AI가 코드를 읽어 화면과 버튼을 찾아 두고, 말로 요청한 테스트를 실제로 동작하는 Playwright 코드로 만들어 실행하는 테스트 운영 플랫폼입니다.** 실패하면 AI가 원인을 분석하고 수정안을 제안하며, 모든 변경은 사람이 승인해야 반영됩니다.

전담 QA 인력이 없는 개발팀이 자기가 개발 중인 서비스를 스스로 검증할 수 있게 하는 것이 목표입니다.

## 사용법

| 순서 | 하는 일 | 어디서 |
|---|---|---|
| 1 | **프로젝트 등록** — 테스트할 사이트 주소와 이름을 넣습니다. 앱 소스 저장소(GitHub)를 함께 넣으면 등록 직후 코드베이스 분석이 자동으로 시작됩니다 | 프로젝트 목록 → [프로젝트 등록] |
| 2 | **분석 결과 확인** — 저장소 코드에서 찾은 화면, 버튼 · 입력 · 링크와 셀렉터를 봅니다 | 프로젝트 → 코드 → 구조 |
| 3 | **테스트 만들기** — 화면을 골라 "무엇을 확인할지" 적거나, 왼쪽 AI 패널에 말로 요청합니다. AI는 분석에서 찾은 셀렉터만 써서 코드를 만듭니다 | 구조 탭 · AI 패널 · 테스트 탭 |
| 4 | **승인** — AI가 만든 코드의 차이를 보고 승인하면 파일에 반영됩니다 | AI 검토 |
| 5 | **실행 · 결과 확인** — 수동 · 예약 · 배포 후 실행. 리포트, 영상, 실패 로그를 보고, 실패하면 AI 분석을 요청합니다 | 실행 · 결과 · AI 분석 |

2번과 1번의 자동 분석은 코드베이스 분석 PR(#45)이 병합되면 배포 사이트에 나타납니다. 그전에는 3번의 AI 패널 · 테스트 탭으로 바로 테스트를 만들 수 있습니다.

AI 공급자(Claude · GPT)와 API 키는 관리자가 [AI 설정 · 사용량]에서 고릅니다. 모든 AI 기능이 여기서 고른 기본 공급자를 씁니다.

---

## 프로젝트 차터

| 항목 | 내용 |
|---|---|
| 프로젝트 | **AI-TestOps** — Playwright 기반 AI 테스트 자동화 운영 플랫폼 |
| 팀 · 과정 | aQm · 한성대학교 기업연계 캡스톤디자인 |
| 기간 | 2026-08-28 ~ 2026-12-11 (최종발표) |
| 기준 문서 | PRD v2.2 · 차터 v2.0 · WBS v2.1 (2026-10-27) |

### 문제

- 테스트 케이스를 코드로 직접 써야 해서 도입이 느리다.
- 기존 AI 도구는 대상 서비스를 보지 않고 설명만으로 셀렉터를 추측해서, 처음 만든 테스트가 자주 실패한다. 분석 없이 만든 테스트는 같은 요청 6건 중 1건만 손대지 않고 통과했다.
- 실패가 나면 테스트 문제인지 앱 버그인지 가리느라 로그를 하나씩 열어 봐야 한다.

### 목표

| 목표 | 기준 |
|---|---|
| 코드를 읽고 만든 테스트가 바로 동작 | 화면을 지정해 만든 테스트 10건 중 6건 이상 무수정 통과 (1차 측정: 6건 중 5건) |
| 화면을 빠짐없이 찾음 | 대상 2종에서 화면 90% 이상 발견 (1차 측정: 9개 중 9개) |
| 실패 원인 자동 분류 | 원인을 아는 결함 20건 분류 정확도 70% 이상 |
| 안전한 AI 변경 | 사람 승인 없는 AI 반영 0건, main 직접 반영 0건 |
| 플랫폼 자체 회귀 방지 | 배포마다 자체 회귀 테스트 통과를 배포 조건으로 |

### 개발 범위와 현황

| 기능 | 내용 | 상태 |
|---|---|---|
| 코드베이스 분석 | 저장소 코드에서 화면 · 요소 · 전환을 찾아 지식 그래프로 저장, 셀렉터는 코드가 조립 | ✅ 구현 (병합 대기) |
| 구조 화면 | 분석 결과를 목록 · 그래프로 보고, 화면 · 경로를 골라 테스트 생성 | 🔨 목록 완료, 그래프 개발 중 |
| 컨테이너 내 AI 에이전트 | 격리 컨테이너 안에서 여러 턴 · 도구 호출로 작업 (API 키는 서버만 보유) | 📋 11월 |
| LangGraph AI 루프 | 분류 → 수정안 → 격리 검증 → 승인 → PR → 재실행을 하나의 흐름으로 | 📋 11월 |
| AI Task | 실패 · 새 커밋을 계기로 AI가 먼저 할 일을 만들어 알림 | 📋 11월 |
| 대시보드 · 모바일 | 실패 추이 · 오류 유형 · 에이전트 진행 단계, 모바일 웹에서 확인 · 승인 | 📋 11월 |
| 사이트 탐색 | 저장소 없이 URL 만으로 화면 찾기 | ⏸ 후속 단계 |

**범위 밖** — Playwright 외 테스트 프레임워크, 모바일 네이티브 앱, 부하 테스트, 외부 고객 대상 상용 운영

### 팀

| 담당 | 역할 |
|---|---|
| **장준호** ([@Junho73](https://github.com/Junho73)) | PM · FE — 일정 · 산출물, 코드베이스 분석, 구조 화면, 대시보드, AI Task 화면 |
| **김윤재** ([@YoonJae00](https://github.com/YoonJae00)) | BE · Server — LangGraph ai-service, LLM 프록시, AI Task API, 테스트 서버 · CI/CD |
| **박준서** | 모바일 — 기기별 테스트 실행, 모바일 화면 · 승인 |
| **장동현** | AI — 컨테이너 내 에이전트, 실패 분류 · 수정 노드, 품질 평가셋 |
| 지도교수님 · 부장님 | 방향 지도, 산출물 검토, 테스트 서버 제공, 현업 관점 검토 |

### 마일스톤

| 기간 | 내용 | 상태 |
|---|---|---|
| 9/14 ~ 9/29 | 착수 — 제안 발표, 개선안 · 차터 · PRD v2.0 | ✅ |
| 10/5 ~ 10/9 | Sprint 1 — 코드베이스 분석 | ✅ |
| 10/12 ~ 10/23 | Sprint 2 — 산출물 개정, 배포 장애 · 화면 버그 수정 | ✅ |
| 10/26 ~ 11/6 | Sprint 3 — 구조 그래프, 컨테이너 내 AI, AI Task, **중간발표(11/6)** | 🔨 |
| 11/9 ~ 11/20 | Sprint 4 — LangGraph 루프, 대시보드, 모바일, 품질 측정 | 📋 |
| 11/23 ~ 12/11 | 시연 · 최종발표 · 회고 | 📋 |

### 지키는 원칙

1. **사람 승인 게이트** — AI가 만든 변경은 사람이 승인해야 반영된다 (`aiAutoApplyEnabled` 기본값 `false`).
2. **실행 격리** — 테스트 · AI 작업 · 저장소 복제는 일회성 컨테이너에서 하고, `docker.sock` 과 자격 증명은 `api` 만 가진다.
3. **지어낸 셀렉터 금지** — 셀렉터는 코드나 화면에 실제로 있는 속성으로만 만든다.
4. **변경 범위 제한** — AI가 고칠 수 있는 경로를 프로젝트별 허용 · 금지 목록으로 제한한다.
5. **배포 게이트** — main 은 dev 에서만 병합되고, 배포마다 자체 회귀 테스트를 통과해야 한다.

---

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

자세한 배경은 [`docs/ai-integration-architecture.md`](docs/ai-integration-architecture.md), [`docs/ai-job-spec.md`](docs/ai-job-spec.md) 참고.

## 기술 스택

| 영역 | 기술 |
|------|------|
| Web | React, Vite, TypeScript, Tailwind CSS, ag-Grid, ECharts, Monaco Editor |
| API | Spring Boot 3(Java 21), Spring Data JPA, PostgreSQL |
| Worker | Node.js, Opensource(Playwright) |
| 실행 격리 | Docker (프로젝트/AI 작업별 컨테이너) |
| AI | Claude / GPT (관리자 등록 공용 키, LLM Gateway로 단일화) |
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
- [Scenario and Environment Management](docs/scenario-env-management.md)
- [Runtime Sizing](docs/ops-sizing.md)
- [First Run Troubleshooting](docs/first-run-troubleshooting.md)

PRD(요구사항분석서)·TRD(기술설계서)·UI 화면설계서는 별도 산출물 문서로 관리됩니다.
