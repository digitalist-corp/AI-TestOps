# AI-TestOps AI 연동 아키텍처 (To-Be)

> **2026-09-22 업데이트** — 이 문서는 현재 구현된 AI 작업(일회용 AI 러너 · CODE_FIX) 기준 설계다. 다음 단계로 중앙 `ai-service`(Python · LangGraph)가 api 도구와 LLM 프록시만 호출해 작성 · 실행 · 분류 · 수정 · 승인 · PR을 하나의 루프로 잇는 방향을 [AI 개선안](./ai-improvement-plan.md)에 정리했다. 실행 격리 · 키 보관 · 사람 승인 원칙은 이 문서와 같다.

AI 기반 기능(자동 코드 생성/수정, Sandbox 자율 수정 루프, 자연어 시나리오 기반 템플릿 생성, 예약 실행)을 AI-TestOps에 통합하기 위한 설계다. 최우선 원칙은 **보안**과 **프로젝트별 독립성**이며, 실행 컨테이너 lifecycle은 [tobe-architecture.md](./tobe-architecture.md)의 one-off Worker/Runner 패턴을 그대로 확장한다.

## 검토한 옵션과 결정

AI 연동 방식으로 다음 네 가지를 검토했다.

| 옵션 | 설명 | 채택 여부 |
|------|------|-----------|
| API 방식 (프로젝트 1개씩) | 중앙 API가 프로젝트 하나에 대해 단발성으로 AI 호출 | 부분 채택 (job 단위 처리로 흡수) |
| 컨테이너별 상시 VS/API 서버 | 프로젝트마다 항상 떠 있는 AI 실행 서버 | **기각** |
| API 방식 (프로젝트 여러 개) | 중앙 서비스가 여러 프로젝트 요청을 큐로 처리 | 채택 |
| 볼륨에 저장 | 소스/결과를 Docker 볼륨에 저장 | 채택 (프로젝트별 분리 전제) |

**컨테이너별 상시 서버를 기각한 이유**: 프로젝트 수만큼 상시 노출 엔드포인트가 생겨 공격 표면이 선형으로 늘어나고, 현재 `AuthInterceptor`/`UserRole`/`ProjectRepository`에 있는 권한 검증 로직을 N개 컨테이너에 복제해야 한다. 특히 Sandbox 자율 수정 루프와 결합하면, 프롬프트 인젝션 한 번으로 상시 세션이 계속 컨테이너를 조작하는 최악의 시나리오가 가능해진다.

**채택 방향**: **Ephemeral Scoped AI Runner** — job 하나당 컨테이너 하나를 만들고 끝나면 즉시 폐기하는 방식. `RunnerCapacityService`가 이미 Playwright 실행 러너에 대해 구현한 lifecycle(생성 → 실행 → 정리)을 AI job 타입으로 확장한다.

## 현재 구조에서 확인된 문제

1. **볼륨 격리 부재**: `api`/`worker`가 `playwright-projects` 트리 전체를 마운트해 어떤 컨테이너든 모든 프로젝트 소스를 볼 수 있다.
2. **docker.sock 노출 범위**: 현재는 `api`에만 있어 안전하지만, AI 실행 컨테이너를 추가하면서 실수로 전파될 위험이 있다.
3. **자격증명 분산**: GitHub 연동이 아직 없어 git 자격증명 보관 위치가 정해지지 않았다 — 신규 설계 시점에 바로잡아야 한다.
4. **Egress 제한 부재**: 컨테이너 네트워크 정책이 없어, 실행 중인 코드가 임의로 외부/내부 자원에 접근할 수 있다.

## 목표 아키텍처

### 컴포넌트

```text
Web UI
  |
  v
API (control plane, 항상 실행)
  - 인증/권한 (AuthInterceptor, UserRole, ProjectRepository)
  - job 생성/상태 관리
  - Scheduler (내부 모듈)
  - git-sync / git commit·push (자격증명 보유)
  - docker.sock 제어 (유일한 소유자)
  |
  |-- Scheduler: 예약 시각 도달 시 job 생성 요청 (코드/AI 권한/docker.sock 불필요)
  |
  v
AI Runner (job 단위 ephemeral 컨테이너)
  - git 자격증명 없음, docker.sock 없음
  - 프로젝트 전용 볼륨 1개만 마운트
  - egress 화이트리스트 네트워크에 배치
  v
Storage
  - /playwright-projects/{projectId}   (프로젝트 전용 볼륨, 공유 tree mount 아님)
  - /storage/reports/{projectId}/{executionId}
```

### Job 흐름

1. **트리거**: 사용자가 수동 실행하거나, Scheduler가 예약 시각 도달을 감지 — 두 경우 모두 `api`가 job 레코드를 생성하는 동일한 경로를 탄다.
2. **소스 동기화**: `api`(또는 `api`가 관리하는 짧은 수명의 git-sync 스텝)가 해당 프로젝트 전용 볼륨에 git 소스를 최신화한다. 자격증명은 이 단계에서만 사용되고 컨테이너로 넘어가지 않는다.
3. **컨테이너 실행**: `api`가 docker.sock으로 ephemeral AI runner를 생성한다. 마운트는 그 프로젝트 볼륨 하나뿐이고, egress가 `api` 엔드포인트(콜백 + AI 프록시) 하나로만 제한된 네트워크에 배치한다. AI 공급자(Claude/GPT/Gemini) API로 직접 나가지 않는다 — [AI 공급자 API 키 정책](#ai-공급자-api-키-정책) 참고.
4. **작업 수행**: 컨테이너 내부에서 AI 작업(자율 수정 루프 포함)을 수행하고, 결과/diff를 프로젝트 볼륨에 기록하며 진행 상황은 `api` 콜백으로 보고한다.
5. **폐기**: 작업 종료 즉시 컨테이너를 삭제한다 (`docker run --rm`과 동일한 원칙).
6. **반영**: `api`가 diff를 검증한 뒤 git commit/push를 수행한다 (자격증명은 `api`만 보유).
7. **이력/알림**: 기존 `Execution` 계열과 동일한 패턴으로 이력을 저장하고, 실패 시 Slack 알림을 발송한다.

### 자율 수정 루프 안전장치

- 최대 반복 횟수, 타임아웃, 리소스 한도를 job 생성 시점에 `api`가 강제한다 (`WORKER_CONCURRENCY`류의 기존 동시성 제어 패턴 재사용).
- 컨테이너 내부 로직이 스스로 멈추는 판단에 의존하지 않는다 — 항상 외부(`api`)가 kill할 수 있어야 한다.
- egress 제한 덕분에 프롬프트 인젝션이 발생해도 피해 범위가 해당 프로젝트 볼륨 내부로 한정된다.

### 스케줄러

- `api` 프로세스 내부의 경량 모듈(Spring `@Scheduled` 또는 Quartz)로 둔다. 별도 인프라 불필요.
- 하는 일은 "지금이 예약 시간인가 → job 생성 요청"뿐이며, 코드 접근·AI 권한·docker.sock이 필요 없다.
- 리눅스 서버가 항상 켜져 있으므로 사용자의 로컬 PC/VS Code 상태와 무관하게 동작한다.
- 여러 `api` 인스턴스로 스케일 아웃할 경우 중복 트리거 방지(락 또는 leader election)가 필요 — [열린 질문](#열린-질문--다음-설계-단계) 참고.

### 볼륨/자격증명 정책

- 프로젝트당 전용 볼륨 1개. 기존처럼 `playwright-projects` 전체를 공유 마운트하지 않는다.
- git PAT/SSH 키는 `api`(또는 `api`가 관리하는 짧은 수명 git-sync 컨테이너)에만 존재한다.
- AI runner 컨테이너는 이미 체크아웃된 코드만 받고 자격증명을 절대 보유하지 않는다.

### 네트워크 정책

- AI runner 전용 Docker 네트워크를 두고 egress를 **`api` 하나로만** 화이트리스트한다. AI 공급자 API 도메인은 화이트리스트에 넣지 않는다 — AI 공급자 호출도 `api`를 거치는 프록시 방식으로 바꿨기 때문이다 ([AI 공급자 API 키 정책](#ai-공급자-api-키-정책)).
- Postgres, 다른 프로젝트 볼륨, 임의 외부 사이트로는 접근할 수 없다.
- 리눅스 서버 환경이라 native Docker 네트워크 정책(iptables 기반)으로 구현 가능하다 — Docker Desktop 환경에서는 신뢰성 있게 구현하기 어렵다.

### AI 공급자 API 키 정책

AI-TestOps는 회원가입이 없는 단일 조직 내부 툴이다(`User.role`은 `ADMIN`/`USER` 둘뿐, 공유 로그인 방식). 따라서 "프로젝트 생성 시 키 입력"이나 "계정별 개인 키 등록"은 이 구조와 맞지 않는다 — 예약 실행처럼 사람이 없는 트리거에서는 애초에 귀속시킬 개인 계정이 없고, 팀 전체 AI 비용을 한 곳에서 통제한다는 보안 우선순위와도 어긋난다.

**결정: 관리자가 등록하는 플랫폼 공용 키.**

- 실제 API 키(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`)는 `api` 서비스의 환경변수로만 존재한다 — 지금 `LOGIN_USERNAME`/`LOGIN_PASSWORD`가 관리되는 방식과 동일한 급이다. DB에 저장하지 않는다 (지금 필요한 수준을 넘는 과설계 — 관리 화면에서 키를 바꿀 수 있게 하려는 요구가 실제로 생기면 그때 암호화 컬럼으로 옮긴다).
- AI Runner 컨테이너는 이 키를 절대 받지 않는다. git 자격증명과 동일한 원칙이다.
- AI Runner가 LLM을 호출해야 하면, 공급자 API로 직접 나가지 않고 **`api`가 제공하는 내부 프록시 엔드포인트**(`http://api:8080/internal/ai-jobs/{jobId}/llm`)를 호출한다. `api`가 요청을 받아 실제 키를 붙여 공급자 API로 중계(relay)하고 응답을 그대로 돌려준다.
- 인증은 새로 만들지 않고 [ai-job-spec.md](./ai-job-spec.md)의 `callback.token`(job-scoped 단기 JWT)을 그대로 재사용한다 — 이 프록시 엔드포인트도 콜백 엔드포인트와 같은 `api` 표면이므로 별도 토큰 체계를 둘 이유가 없다.
- 부수 효과: 모든 LLM 호출이 `api`를 거치므로 job/프로젝트별 토큰 사용량을 한 곳에서 집계할 수 있고, 공급자 도메인이 바뀌거나 여러 개(Claude+GPT+Gemini)로 늘어나도 컨테이너의 egress 화이트리스트는 손댈 필요가 없다.
- 프로젝트별로 정할 수 있는 건 "어떤 공급자/모델을 쓸지"뿐이다 (`Project.aiModelProvider`, [ai-job-spec.md](./ai-job-spec.md) 참고) — 키 자체는 프로젝트 설정 화면에 절대 노출하지 않는다.

## 로드맵 항목과의 관계

| 로드맵 항목 | 이 아키텍처와의 관계 |
|-------------|----------------------|
| AI 연동 | 본 문서의 핵심 대상. 상시 서버 방식 대신 ephemeral runner로 구현 |
| Test Suite / Sandbox 자율 수정 루프 | AI runner 안에서 동작, `api`가 반복/타임아웃 상한을 강제 |
| 자연어 시나리오 기반 템플릿 생성 | AI runner job의 한 종류로 처리 가능 (프로젝트 볼륨 불필요, 저위험) |
| 실패 알림 (Slack) | job 실패/완료 시 `api`가 발송. `TODO.md`의 "알림 기능 추가"와 동일 항목 |
| GitHub 레포 연동 | 본 문서의 git-sync/commit 단계로 구현. `TODO.md`의 "프로젝트 소스 git 연결 생성"과 동일 항목 |
| 선행 시나리오 실행 구조 개선 | 본 문서와 직접 관련 없음, `tobe-architecture.md` 실행 큐 설계 범위 |
| 리눅스 서버 구현 | egress 정책·네트워크 격리의 전제 조건 |
| 사용자 관리 기능 개선 | AI job 생성 권한도 기존 `UserRole` 체계로 검증 (신규 권한 분기 없음) |
| 기타 UI/UX 개선 | 본 문서와 무관 |

## 열린 질문 / 다음 설계 단계

- **Job spec**: 확정. [ai-job-spec.md](./ai-job-spec.md) 참고 (요청/결과 JSON, 상태 모델, 검증 규칙).
- **자격증명 저장 방식**: git PAT/SSH 키를 DB 암호화 컬럼으로 둘지, 별도 secret store(Vault 등)를 둘지 결정.
- **콜드스타트 완화**: job마다 새 컨테이너를 띄우는 지연을 줄이기 위한 웜풀/이미지 프리페치 여부 — `tobe-architecture.md`의 "Playwright Docker image 재사용" 원칙과 동일하게 적용 가능.
- **볼륨 네이밍/정리 정책**: 프로젝트별 볼륨 생성·삭제 주기를 `TODO.md`의 러너 정리 정책과 통합.
- **스케줄러 다중화**: `api`를 2개 이상 띄울 때 예약 job이 중복 생성되지 않도록 락/leader election 방식 결정.
