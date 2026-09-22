# AI-TestOps To-Be Architecture

AI-TestOps는 Playwright 기반 UI 테스트를 프로젝트 단위로 등록하고, 시나리오/spec/케이스 단위로 실행하며, 실행 결과와 산출물을 이력으로 관리하는 자동화 운영 플랫폼이다.

현재 PoC 구조는 API가 실행 요청을 만들고 `@Async` 스레드에서 Docker one-off 컨테이너를 직접 실행한다. To-Be 구조에서는 실행 책임을 Worker로 분리하고, API는 실행 요청/상태/결과를 관리하는 control plane 역할에 집중한다.

## 목표

- 프로젝트별 Playwright 소스와 실행 설정을 중앙에서 관리한다.
- 프로젝트 전체, spec 파일, 시나리오, 케이스 단위 실행을 지원한다.
- 여러 사용자가 동시에 실행해도 작업이 유실되거나 결과가 덮이지 않도록 한다.
- 실행 상태, 로그, 결과, trace/video/screenshot 산출물을 이력으로 남긴다.
- 개발 노트북, 단일 서버, 운영 서버로 자연스럽게 확장 가능한 구조를 유지한다.

## 핵심 도메인

| 개념 | 설명 |
|------|------|
| Project | 테스트 대상 시스템 또는 서비스 단위. Playwright 소스, 환경 변수, Node/Playwright 버전, 실행 정책을 가진다. |
| Scenario | 사용자가 관리 화면에서 인식하는 테스트 묶음. 초기에는 spec 파일 또는 describe 그룹으로 본다. |
| Spec | Playwright spec 파일. 예: `tests/login.spec.ts`. |
| Case | Playwright `test()` 단위. 케이스별 재실행과 이력 조회의 기준이다. |
| Execution | 사용자의 실행 요청 1건. 항상 고유 ID를 가지며 결과 저장 경로의 기준이 된다. |
| Worker | 큐에서 실행 요청을 가져와 Docker 컨테이너에서 Playwright를 실행하는 프로세스. |
| Report | 실행 결과 JSON, HTML report, trace, video, screenshot, 로그 파일 묶음. |

## 전체 구조

```text
Web UI
  |
  | REST/SSE
  v
API Server
  |  - project/scenario/execution 관리
  |  - 실행 요청 생성
  |  - 상태/결과 조회
  v
PostgreSQL
  |  - executions queue
  |  - execution history
  |  - project metadata
  ^
  |
Worker
  |  - pending execution claim
  |  - Docker run
  |  - heartbeat/status update
  v
Docker Runner Container
  |  - npm ci/install
  |  - npx playwright test
  v
Storage
  - /playwright-projects/{projectId}
  - /storage/reports/{projectId}/{executionId}
```

## 컴포넌트 역할

### Web

- 프로젝트 등록/수정/삭제
- Playwright 소스 탐색 및 편집
- 시나리오/spec/케이스 트리 조회
- 프로젝트 전체/spec/케이스 실행 요청
- 실행 목록, 진행 상태, 로그 스트리밍, 결과 조회
- 실패 케이스 재실행

### API

- 인증/권한 처리
- 프로젝트 메타데이터 관리
- 프로젝트 파일 관리
- 시나리오 분석 결과 제공
- 실행 요청 생성
- 실행 상태 및 결과 조회
- 로그/산출물 제공
- 실행 취소 요청 접수

API는 Docker 실행을 직접 담당하지 않는 것을 To-Be 기준으로 한다. 단, 로컬 PoC 편의를 위해 API 직접 실행 모드는 옵션으로 남길 수 있다.

### Worker

- 실행 가능한 `PENDING` 작업을 조회한다.
- DB lock 또는 claim API를 통해 작업 소유권을 획득한다.
- 프로젝트 소스와 실행 설정을 읽는다.
- Docker one-off 컨테이너를 생성해 Playwright를 실행한다.
- 실행 로그를 `stream.log`에 기록하고 상태를 주기적으로 갱신한다.
- 결과 JSON을 파싱해 passed/failed/skipped 수를 저장한다.
- 종료 시 컨테이너와 임시 리소스를 정리한다.

### Storage

- 프로젝트 소스: `/playwright-projects/{projectId}`
- 실행 결과: `/storage/reports/{projectId}/{executionId}`
- 실행 결과는 execution ID 기준으로 저장하므로 덮어쓰지 않는다.
- 최신 결과는 DB 조회나 별도 latest pointer로 표현한다.

## 실행 흐름

### 1. 실행 요청

```text
User -> Web -> API
API -> executions row 생성
status = PENDING
```

요청 타입은 다음을 지원한다.

| 타입 | 실행 예 |
|------|---------|
| Project 전체 | `npx playwright test` |
| Spec 파일 | `npx playwright test tests/login.spec.ts` |
| Scenario/describe | `npx playwright test tests/login.spec.ts --grep "...describe title..."` |
| Case | `npx playwright test tests/login.spec.ts --grep "...case title..."` |

### 2. 작업 획득

Worker는 주기적으로 실행 가능한 작업을 가져온다.

```text
PENDING -> RUNNING
workerId 저장
startedAt 저장
heartbeatAt 갱신 시작
```

동시에 여러 Worker가 같은 작업을 가져가지 않도록 DB row lock을 사용한다.

권장 방식:

```sql
SELECT *
FROM executions
WHERE status = 'PENDING'
ORDER BY priority DESC, created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Spring/JPA에서 바로 구현하기 어렵다면 claim 전용 API를 만들고, 내부에서 트랜잭션과 pessimistic lock을 사용한다.

### 3. 실행

Worker는 execution 정보를 기준으로 Docker 컨테이너를 실행한다.

```text
docker run --rm
  -v /playwright-projects/{projectId}:/project
  -v /storage/reports/{projectId}/{executionId}:/report
  -w /project
  -e BASE_URL=...
  mcr.microsoft.com/playwright:v{version}-noble
  bash -lc "{install} && {test}"
```

실행 중에는 다음을 기록한다.

- `stream.log`: 실시간 로그
- `install.log`: 의존성 설치 로그
- `run.log`: Playwright 실행 로그
- `results.json`: Playwright JSON reporter 결과
- `playwright-report/`: HTML report
- `test-results/`: trace/video/screenshot

### 4. 종료

정상 종료:

```text
RUNNING -> PASSED 또는 FAILED
finishedAt 저장
durationMs 저장
통계 저장
```

비정상 종료:

```text
RUNNING -> ERROR
errorMessage 저장
finishedAt 저장
```

취소:

```text
CANCEL_REQUESTED -> CANCELED
컨테이너 stop/kill
finishedAt 저장
```

## 실행 상태 모델

| 상태 | 의미 |
|------|------|
| PENDING | 실행 요청이 생성되었고 아직 Worker가 가져가지 않았다. |
| RUNNING | Worker가 작업을 획득했고 컨테이너 실행 중이다. |
| PASSED | Playwright 실행이 성공 종료되었다. |
| FAILED | Playwright 테스트 실패가 있었다. |
| ERROR | 인프라/설정/타임아웃 등으로 정상 실행하지 못했다. |
| CANCEL_REQUESTED | 사용자가 취소를 요청했고 Worker가 처리 대기 중이다. |
| CANCELED | 실행이 취소되었다. |
| TIMEOUT | 설정된 제한 시간을 초과했다. |

초기 구현에서는 `PENDING`, `RUNNING`, `PASSED`, `FAILED`, `ERROR`, `CANCELED`만 적용하고 `TIMEOUT`은 `ERROR`의 상세 사유로 처리해도 된다.

## Execution 데이터 모델 확장

현재 필드에 더해 다음 필드를 권장한다.

| 필드 | 설명 |
|------|------|
| requestedBy | 실행 요청 사용자 ID |
| runType | `PROJECT`, `SPEC`, `SCENARIO`, `CASE` |
| priority | 큐 우선순위 |
| workerId | 실행을 소유한 Worker ID |
| containerId | 실행 중인 Docker 컨테이너 ID |
| queuedAt | 큐에 들어간 시간 |
| heartbeatAt | Worker 생존 신호 |
| cancelRequestedAt | 취소 요청 시간 |
| timeoutSeconds | 실행 제한 시간 |
| artifactRoot | 결과 저장 경로 |

프로젝트별 동시 실행 제한을 위해 Project에도 다음 설정을 둘 수 있다.

| 필드 | 설명 |
|------|------|
| maxParallelExecutions | 해당 프로젝트의 최대 동시 실행 수 |
| defaultTimeoutSeconds | 기본 실행 타임아웃 |
| retainDays | 결과 보존 기간 |
| traceMode | `ON`, `OFF`, `ON_FAILURE` |
| videoMode | `ON`, `OFF`, `ON_FAILURE` |

## 여러 사용자 실행 정책

여러 사용자가 동시에 실행할 때 기본 원칙은 다음과 같다.

- 실행 요청은 모두 이력으로 저장한다.
- 결과 디렉터리는 execution ID 기준이므로 덮어쓰지 않는다.
- 프로젝트별 동시 실행 수를 제한한다.
- 전역 동시 실행 수를 제한한다.
- 큐 대기 순서는 기본적으로 요청 시간순이다.
- 관리자는 실행 취소 권한을 가진다.

권장 기본값:

| 환경 | 전역 동시 실행 | 프로젝트별 동시 실행 |
|------|----------------|----------------------|
| 개발 노트북 | 1 | 1 |
| 단일 서버 | 2~4 | 1~2 |
| 운영 서버 | Worker 수와 서버 리소스에 맞춰 조정 | 프로젝트 중요도에 따라 조정 |

## 큐 구현 전략

### 1단계: DB polling

초기 To-Be 구현은 PostgreSQL 기반 DB polling을 권장한다.

장점:

- 추가 인프라가 필요 없다.
- 실행 이력과 큐 상태가 같은 DB에 있어 운영이 단순하다.
- 현재 Spring Boot/JPA 구조와 잘 맞는다.

주의점:

- row lock을 제대로 사용해야 중복 실행을 막을 수 있다.
- Worker heartbeat와 stale execution 복구가 필요하다.

### 2단계: Redis 또는 메시지 큐

실행량이 많아지면 Redis Queue, RabbitMQ, Kafka 등을 검토한다.

단, AI-TestOps의 실행 작업은 수 초~수 분 이상 걸리는 long-running job이므로 메시지 큐만으로 끝내지 말고 DB의 execution 상태를 source of truth로 유지한다.

## 실행 중 상태 관리

실행 중 상태 관리는 DB 상태와 파일 로그를 함께 사용한다.

- DB: 상태, 시작/종료 시간, 통계, worker/container 정보
- 파일: 실시간 로그와 산출물
- SSE 또는 polling: Web UI에 진행 로그 표시

Worker는 실행 중 `heartbeatAt`을 주기적으로 갱신한다. API 또는 별도 scheduler는 `RUNNING` 상태인데 heartbeat가 오래 갱신되지 않은 execution을 `ERROR`로 전환할 수 있다.

예:

```text
RUNNING + heartbeatAt 5분 이상 지연
-> ERROR
-> errorMessage = "Worker heartbeat lost"
```

## 취소 설계

취소는 API가 직접 컨테이너를 죽이는 방식보다 Worker가 처리하는 방식을 기본으로 한다.

흐름:

```text
User -> API cancel
API: status = CANCEL_REQUESTED
Worker: cancel 감지
Worker: docker stop {containerId}
Worker: status = CANCELED
```

Worker가 죽어 취소 처리를 못 하는 경우를 대비해 관리자용 강제 정리 기능을 별도로 둘 수 있다.

## Docker 리소스 정책

개발 노트북에서는 매 실행마다 `npm install`과 컨테이너 생성 비용이 크게 느껴질 수 있다. To-Be에서는 다음 정책을 적용한다.

### 실행 환경 재사용 기준

Playwright 실행 환경은 이미지와 프로젝트 소스를 분리해서 본다.

| 영역 | 재사용 기준 | 설명 |
|------|-------------|------|
| Playwright Docker image | Playwright 버전 기준 재사용 | 같은 `mcr.microsoft.com/playwright:v{version}-noble` 이미지는 Docker가 재사용한다. |
| Project source | 프로젝트별 볼륨 | `/playwright-projects/{projectId}`를 컨테이너에 마운트한다. |
| Spec/Case 선택 | 실행 요청별 필터 | 같은 프로젝트 소스에서 `specPath`, `grep`만 달리 적용한다. |
| npm cache | 프로젝트별 또는 전역 cache volume | 패키지 다운로드 비용을 줄인다. |
| node_modules | 프로젝트별 선택 재사용 | 프로젝트 디렉터리에 남기면 다음 실행에서 재사용된다. 동시 실행 시 lock이 필요하다. |
| Report | execution ID별 저장 | `/storage/reports/{projectId}/{executionId}`에 저장해 덮어쓰지 않는다. |

중요한 원칙:

```text
공통 환경 = Docker image + OS/browser dependency
프로젝트 환경 = package.json + playwright.config.ts + tests + env
실행 범위 = specPath + grep
결과 = executionId 기준 이력
```

따라서 같은 Playwright 버전을 사용하는 여러 프로젝트는 같은 이미지를 재사용하되, 컨테이너 실행 시 각 프로젝트의 소스 디렉터리만 마운트해서 실행한다.

예:

```text
Project A -> image v1.53.0 + /playwright-projects/project-a + tests/login.spec.ts
Project B -> image v1.53.0 + /playwright-projects/project-b + tests/order.spec.ts
```

이 구조에서는 이미지가 같아도 프로젝트별 `package.json`, `playwright.config.ts`, spec, 환경 변수는 서로 분리된다.

### 기본 정책

- 실행 컨테이너는 one-off로 생성하고 종료 후 제거한다.
- 결과와 로그는 host volume에 남긴다.
- trace/video/screenshot은 기본적으로 실패 시에만 저장한다.
- 동시 실행 수는 개발 환경에서 1로 제한한다.

### 의존성 설치 최적화

우선순위:

1. `package-lock.json`이 있으면 `npm ci` 사용
2. 프로젝트별 npm cache volume 사용
3. `node_modules` 재사용은 선택적으로 지원
4. 프로젝트별 prebuilt runner image는 운영 최적화 단계에서 검토

권장 볼륨 예:

```text
/storage/cache/npm/{projectId}
/storage/cache/ms-playwright/{playwrightVersion}
```

### 정리 정책

- `docker run --rm` 유지
- dangling container는 scheduler에서 정리
- 오래된 report는 `retainDays` 기준으로 삭제
- 대용량 artifact는 trace/video/screenshot 순으로 보존 정책 적용

## 시나리오 분석 전략

초기에는 spec 파일을 정규식으로 분석해 describe/test 트리를 만든다. 다만 실제 Playwright 문법은 다음처럼 다양하다.

- `test.describe.configure`
- `test.step`
- 동적 title
- fixture 기반 test alias
- nested describe
- multiline test title

따라서 To-Be에서는 아래 순서로 안정성을 높인다.

1. 현재 regex parser 유지
2. `specPath + grep` 실행 정확도 개선
3. Playwright의 list/report 기능 활용 검토
4. 필요 시 TypeScript AST 기반 parser 도입

케이스 실행 정확도를 위해 가능한 한 spec 파일 경로와 grep을 함께 사용한다.

운영 관리 관점에서는 실시간 파싱만으로 시나리오/케이스를 관리하지 않고, 파싱 결과를 DB에 동기화한 뒤 skip/owner/tag/history 같은 운영 메타데이터를 DB에서 관리한다. 상세 설계는 [scenario-env-management.md](./scenario-env-management.md)를 참고한다.

## 결과 및 이력 관리

결과는 항상 execution ID 기준으로 저장한다.

```text
/storage/reports/{projectId}/{executionId}/
  stream.log
  install.log
  run.log
  docker.log
  results.json
  playwright-report/
  test-results/
```

관리 화면에서는 다음 뷰를 제공한다.

- 프로젝트별 실행 이력
- 시나리오/spec별 실행 이력
- 케이스별 실행 이력
- 최신 실행 결과
- 실패 실행만 보기
- 같은 케이스 재실행

## 배포 단계

### Phase 1: DB queue 기반 Worker

- Worker가 실제 pending execution을 claim
- API 직접 실행 모드는 비활성화 또는 dev 옵션화
- 프로젝트별/spec별/case별 실행 명령 정리
- 상태/heartbeat/containerId 저장

### Phase 2: 운영 기능 보강

- 실행 취소
- stale execution 복구
- 프로젝트별 동시 실행 제한
- 결과 보존 기간
- trace/video 저장 정책
- npm/cache volume 적용

### Phase 3: 확장성 보강

- Worker scale-out
- Worker label 또는 capability 매칭
- 프로젝트별 runner image
- Redis/RabbitMQ 도입 검토
- 스케줄 실행
- 알림 연동

## 권장 기본 설정

개발 노트북:

```text
WORKER_CONCURRENCY=1
PROJECT_MAX_PARALLEL_EXECUTIONS=1
TRACE_MODE=ON_FAILURE
VIDEO_MODE=ON_FAILURE
RETAIN_DAYS=7
```

단일 서버:

```text
WORKER_CONCURRENCY=2
PROJECT_MAX_PARALLEL_EXECUTIONS=1
TRACE_MODE=ON_FAILURE
VIDEO_MODE=ON_FAILURE
RETAIN_DAYS=30
```

CPU, RAM, Disk, 동시 실행 수에 대한 상세 기준은 [ops-sizing.md](./ops-sizing.md)를 참고한다.

## 결론

AI-TestOps의 To-Be 아키텍처는 API가 실행을 직접 수행하는 구조에서 벗어나, DB queue와 Worker 중심의 실행 구조로 이동하는 것이 핵심이다. 이렇게 하면 여러 사용자의 실행 요청을 안정적으로 처리하고, 결과 덮어쓰기 없이 이력을 보존하며, 실행 중 상태/로그/취소/리소스 정리까지 운영 기능으로 확장할 수 있다.
