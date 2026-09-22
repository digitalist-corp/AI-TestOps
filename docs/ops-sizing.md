# AI-TestOps Runtime Sizing

이 문서는 AI-TestOps를 개발 모드와 운영 모드로 실행할 때 필요한 예상 CPU, RAM, Disk, 동시 실행 기준을 정리한다.

AI-TestOps의 리소스 사용량은 API/Web/PostgreSQL 자체보다 Playwright 실행 컨테이너가 대부분을 차지한다. 따라서 스펙 산정의 기준은 `동시 실행 수`, `브라우저 worker 수`, `trace/video/screenshot 저장 정책`, `npm install/cache 전략`이다.

## 기본 가정

- 실행 방식: Docker Compose 기반
- API: Spring Boot
- Web: Vite/React
- DB: PostgreSQL
- 실행: Playwright Docker image 기반 one-off container
- 결과 저장: `/storage/reports/{projectId}/{executionId}`
- 프로젝트 소스: `/playwright-projects/{projectId}`
- 기본 브라우저: Chromium
- 기본 실행 단위: 프로젝트 전체, spec, case

## 리소스 구성 요소

| 구성 요소 | 주요 사용 리소스 | 설명 |
|-----------|------------------|------|
| Web | CPU/RAM 낮음 | React dev server 또는 정적 프론트 서버 |
| API | CPU/RAM 중간 | 실행 요청, 파일 관리, 로그/결과 조회 |
| PostgreSQL | RAM/Disk 중간 | 프로젝트/실행 이력 저장 |
| Worker | CPU/RAM 낮음~중간 | 큐 polling, Docker 실행 제어 |
| Playwright 실행 컨테이너 | CPU/RAM 높음 | 브라우저 실행, 테스트 병렬 처리 |
| Storage | Disk 높음 | report, trace, video, screenshot, node_modules |

## 모드별 권장 스펙

### 개발 모드

개발 노트북 또는 개인 PC에서 기능 개발과 단일 프로젝트 검증을 위한 모드다.

| 항목 | 권장값 |
|------|--------|
| CPU | 4 core 이상 |
| RAM | 16 GB 권장, 최소 8 GB |
| Disk 여유 공간 | 20~50 GB |
| 전역 동시 실행 | 1 |
| 프로젝트별 동시 실행 | 1 |
| Playwright workers | 1 |
| trace | `on-first-retry` 또는 `on-failure` |
| video | `retain-on-failure` 또는 off |
| report 보존 기간 | 3~7일 |

개발 모드에서는 Docker Desktop에 최소 4 CPU, 8 GB RAM 정도를 할당하는 것을 권장한다. 노트북에서 실행 후 점점 느려지는 경우는 대개 Docker Desktop 메모리 압박, `node_modules`, trace/video/report 누적, 브라우저 프로세스 동시 실행이 원인이다.

권장 `.env`:

```text
WORKER_CONCURRENCY=1
PLAYOPS_MAX_GLOBAL_EXECUTIONS=1
PLAYOPS_DEFAULT_PROJECT_PARALLEL_LIMIT=1
PLAYOPS_REPORT_RETAIN_DAYS=7
```

### 단일 서버 운영 모드

소규모 팀이 공용 서버 1대에서 여러 프로젝트를 관리하는 모드다.

| 항목 | 권장값 |
|------|--------|
| CPU | 8 core 이상 |
| RAM | 32 GB 이상 |
| Disk 여유 공간 | 200 GB 이상 |
| 전역 동시 실행 | 2~4 |
| 프로젝트별 동시 실행 | 1~2 |
| Playwright workers | 실행당 1~2 |
| trace | failure/retry 중심 |
| video | failure 중심 |
| report 보존 기간 | 14~30일 |

단일 서버에서는 Playwright 실행 컨테이너가 서버 리소스를 빠르게 점유하므로, 처음에는 전역 동시 실행 2부터 시작해 CPU/RAM/Disk 사용량을 보고 늘리는 것이 안전하다.

권장 `.env`:

```text
WORKER_CONCURRENCY=2
PLAYOPS_MAX_GLOBAL_EXECUTIONS=2
PLAYOPS_DEFAULT_PROJECT_PARALLEL_LIMIT=1
PLAYOPS_REPORT_RETAIN_DAYS=30
```

### 운영 확장 모드

여러 팀 또는 다수 프로젝트를 대상으로 Worker를 scale-out하는 모드다.

| 항목 | 권장값 |
|------|--------|
| API 서버 CPU | 4~8 core |
| API 서버 RAM | 8~16 GB |
| DB 서버 CPU | 4~8 core |
| DB 서버 RAM | 16~32 GB |
| Worker 노드 CPU | 노드당 8~16 core |
| Worker 노드 RAM | 노드당 32~64 GB |
| Disk 여유 공간 | 500 GB~2 TB |
| 전역 동시 실행 | Worker 노드 수와 테스트 특성에 따라 산정 |
| 프로젝트별 동시 실행 | 기본 1, 안정화 후 2 이상 |
| report 보존 기간 | 30~90일 또는 외부 스토리지 이관 |

운영 확장 모드에서는 API, DB, Worker를 분리하는 것이 좋다. Playwright 실행은 Worker 노드에서만 수행하고, API는 실행 요청과 상태 조회에 집중한다.

## 실행 단위별 예상 리소스

아래 수치는 Chromium 기준의 보수적인 추정치다. 실제 사용량은 테스트 대상 페이지의 무게, 로그인/업로드/다운로드 여부, trace/video 설정, 병렬 worker 수에 따라 달라진다.

| 실행 단위 | CPU | RAM | Disk 증가량 |
|-----------|-----|-----|-------------|
| 단일 case | 0.5~1 core | 500 MB~1.5 GB | 1~20 MB |
| 단일 spec | 1~2 core | 1~3 GB | 5~100 MB |
| 프로젝트 전체 소규모 | 2~4 core | 2~6 GB | 50 MB~1 GB |
| 프로젝트 전체 대규모 | 4~8 core | 6~16 GB | 1~10 GB |

trace/video가 켜진 실패 테스트가 많으면 Disk 증가량이 급격히 늘어난다.

## 동시 실행 산정식

간단한 산정식:

```text
필요 CPU core ~= 기본 서비스 2 core + (동시 실행 수 * 실행당 Playwright workers * 1~2 core)
필요 RAM ~= 기본 서비스 4~8 GB + (동시 실행 수 * 실행당 1.5~4 GB)
필요 Disk ~= 프로젝트 소스 + node_modules/cache + report 보존량
```

예: 단일 서버에서 동시 실행 2, 실행당 worker 1 기준:

```text
CPU: 2 + (2 * 1 * 2) = 6 core 이상
RAM: 8 GB + (2 * 4 GB) = 16 GB 이상
권장: 8 core / 32 GB
```

## Disk 산정 기준

Disk는 다음 항목으로 나뉜다.

| 경로 | 용도 | 증가 요인 |
|------|------|-----------|
| `/playwright-projects/{projectId}` | 프로젝트 소스 | 소스, `node_modules`, `package-lock.json` |
| `/storage/reports/{projectId}/{executionId}` | 실행 결과 | logs, JSON, HTML report, trace, video, screenshot |
| `/storage/cache/npm` | npm cache | 패키지 다운로드 캐시 |
| Docker image/cache | 이미지/레이어 | Playwright version, API/Worker image |
| PostgreSQL volume | 메타데이터 | 실행 이력, 사용자, 프로젝트 정보 |

Windows + Docker Desktop 환경에서는 특히 주의한다.

```text
프로젝트 소스, node_modules, report, npm cache, PostgreSQL bind volume
-> D:\git\ui-test-automation 아래로 둘 수 있음

Docker image/layer, container writable layer, build cache
-> 기본값은 Docker Desktop/WSL 저장소이며 보통 C 드라이브를 사용함
```

AI-TestOps 설정으로 D 드라이브에 둘 수 있는 항목:

| 항목 | 권장 경로 |
|------|-----------|
| 프로젝트 소스 | `./playwright-projects/{projectId}` |
| node_modules | `./playwright-projects/{projectId}/node_modules` |
| 실행 report | `./storage/reports/{projectId}/{executionId}` |
| npm cache | `./storage/cache/npm/{projectId}` |
| npm global cache | `./storage/cache/npm-global/{projectId}` |
| Node version cache | `./storage/cache/node/{projectId}/{nodeVersion}` |
| PostgreSQL data | `./storage/postgres` |

Docker image/layer 저장소 자체를 D 드라이브로 옮기려면 Docker Desktop의 disk image location 또는 WSL distro 저장 위치를 별도로 이동해야 한다.

권장 보존 정책:

| 환경 | report 보존 | trace/video |
|------|-------------|-------------|
| 개발 | 3~7일 | 실패/재시도만 |
| 단일 서버 | 14~30일 | 실패 중심 |
| 운영 | 30~90일 | 실패 중심, 장기 보관은 외부 스토리지 |

## 프로젝트 실행 기준

### 개발 모드 기준

- 한 번에 하나의 프로젝트만 실행한다.
- 한 프로젝트 안에서도 한 번에 하나의 execution만 허용한다.
- 케이스/spec 단위 실행을 우선 사용한다.
- 프로젝트 전체 실행은 필요한 경우에만 수행한다.
- trace/video는 실패 또는 retry에만 남긴다.

### 운영 모드 기준

- 프로젝트별 동시 실행 기본값은 1로 시작한다.
- 서로 다른 프로젝트는 전역 제한 안에서 병렬 실행할 수 있다.
- 같은 프로젝트의 동시 실행을 허용하려면 `node_modules`, `test-results`, report 경합을 피해야 한다.
- 안정적인 구조는 execution별 workspace copy 또는 프로젝트별 execution lock이다.

## 이미지와 의존성 재사용 기준

Playwright Docker 이미지는 같은 버전이면 재사용된다.

```text
mcr.microsoft.com/playwright:v1.53.0-noble
```

다만 `npm install` 결과는 이미지에 저장되지 않는다. 프로젝트 디렉터리를 볼륨으로 마운트하면 `node_modules`가 프로젝트별로 남아 다음 실행에서 재사용될 수 있다.

권장 원칙:

- Playwright Docker image: 버전 기준 공통 재사용
- 프로젝트 소스: 프로젝트별 분리
- `node_modules`: 프로젝트별 재사용, 동시 실행 시 주의
- npm cache: 프로젝트별 또는 전역 cache volume 사용
- 결과: execution ID별 분리 저장

## 느려지는 경우 점검 항목

개발 노트북에서 한 번 실행 후 점점 느려지는 경우 다음을 확인한다.

- Docker Desktop 메모리 제한
- 실행 컨테이너가 남아 있는지 여부
- report/trace/video 누적량
- 프로젝트별 `node_modules` 크기
- Playwright workers가 과도하게 잡혔는지 여부
- 동시에 실행 중인 execution 수
- PostgreSQL/Docker volume 사용량
- Docker Desktop disk image가 C 드라이브에 남아 있는지 여부

기본 점검 명령:

```bash
docker compose ps
docker stats
docker system df
```

## 권장 시작값

처음에는 아래 값으로 시작하고, 실행 시간과 리소스 사용량을 관찰한 뒤 늘린다.

| 환경 | CPU | RAM | 전역 동시 실행 | 프로젝트별 동시 실행 | Disk |
|------|-----|-----|----------------|----------------------|------|
| 개발 노트북 | 4 core | 16 GB | 1 | 1 | 20~50 GB |
| 소규모 공용 서버 | 8 core | 32 GB | 2 | 1 | 200 GB |
| 중간 규모 운영 | 16 core | 64 GB | 4~8 | 1~2 | 500 GB 이상 |

## 결론

AI-TestOps의 스펙은 등록 프로젝트 수보다 동시에 실행하는 Playwright 컨테이너 수에 더 크게 좌우된다. 안정적인 시작점은 개발 모드 `동시 실행 1`, 단일 서버 운영 모드 `동시 실행 2`이며, trace/video 저장 정책과 report 보존 기간을 반드시 함께 관리해야 한다.
