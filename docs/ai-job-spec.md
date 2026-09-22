# AI-TestOps AI Job Spec (초안)

> **2026-09-22 업데이트** — 이 문서는 현재 구현된 AI 작업(일회용 AI 러너 · CODE_FIX) 기준 설계다. 다음 단계로 중앙 `ai-service`(Python · LangGraph)가 api 도구와 LLM 프록시만 호출해 작성 · 실행 · 분류 · 수정 · 승인 · PR을 하나의 루프로 잇는 방향을 [AI 개선안](./ai-improvement-plan.md)에 정리했다. 실행 격리 · 키 보관 · 사람 승인 원칙은 이 문서와 같다.

[ai-integration-architecture.md](./ai-integration-architecture.md)에서 정의한 Ephemeral Scoped AI Runner가 `api`와 주고받는 계약을 구체화한다. 기존 `Execution` 실행 흐름([tobe-architecture.md](./tobe-architecture.md))의 요청/상태/결과 패턴을 그대로 따르되, AI 작업에 필요한 필드만 확장한다.

## Job 종류 (aiJobType)

| 타입 | 설명 | 프로젝트 볼륨 필요 여부 |
|------|------|--------------------------|
| `CODE_FIX` | 실패한 실행을 근거로 테스트/코드를 자율 수정 (Sandbox 자율 수정 루프) | 필요 |
| `TEMPLATE_GENERATE` | 자연어 시나리오 설명으로 Playwright 템플릿 생성 | 필요 (아래 [TEMPLATE_GENERATE 대상 경로](#template_generate-대상-경로) 참고) |
| `TEST_ANALYSIS` | 실패 로그/trace를 분석해 원인 요약만 생성, 코드 변경 없음 | 필요 (읽기 전용) |

## 상태 모델

기존 `ExecutionStatus`(`PENDING`, `RUNNING`, `PASSED`, `FAILED`, `ERROR`, `CANCELED`, `TIMEOUT`)에 AI 작업 특유의 "결과 검증 대기" 단계를 추가한다.

| 상태 | 의미 |
|------|------|
| `PENDING` | job 생성됨, 컨테이너 미생성 |
| `RUNNING` | AI Runner 컨테이너 실행 중 |
| `DIFF_READY` | 컨테이너가 작업을 마치고 결과를 볼륨에 기록, `api` 위험도 평가 대기 |
| `NEEDS_REVIEW` | `api`가 위험도 평가 결과 자동 적용 기준 미달로 판단, 사람 검토 대기 |
| `APPLIED` | `api`가 diff를 적용하고 git commit/push까지 완료 (자동 또는 사람 승인 후) |
| `REJECTED` | diff 미반영 (allowedPathGlobs 위반, 회귀 발생, 사람이 거부 등) |
| `FAILED` | AI 작업 자체 실패 (반복 상한 도달, 모델 오류 등 결과물 없음) |
| `ERROR` | 인프라 오류 (컨테이너 기동 실패, heartbeat 유실 등) |
| `CANCELED` | 사용자 취소 |
| `TIMEOUT` | `constraints.timeoutSeconds` 초과 |

`DIFF_READY` 이후의 모든 전환(`NEEDS_REVIEW`, `APPLIED`, `REJECTED`)은 컨테이너가 아니라 `api`만 수행한다. 컨테이너는 `DIFF_READY`까지만 보고할 수 있고, 자신이 "안전하다"고 자체 판단한 값은 참고용일 뿐 위험도 평가에 반영하지 않는다 — 위험도는 항상 `api`가 diff/검증 결과에서 객관적으로 재계산한다 (컨테이너가 손상됐을 경우 자기 신고를 신뢰할 수 없기 때문).

## 컨테이너 내부 파일 레이아웃

```text
/job/job.json         (api가 마운트, read-only)
/workspace             (프로젝트 전용 볼륨, read-write, git 자격증명 없음)
/result/result.json   (컨테이너가 작성, api가 읽음)
/result/diff.patch
/result/run.log
```

`/job`과 `/result`는 프로젝트 소스 볼륨(`/workspace`)과 분리한다. job 정의가 실행 중 변조되지 않도록 `/job`은 read-only로 마운트한다.

## 요청: `job.json` (`api` → AI Runner)

```json
{
  "jobId": "b3f5...-uuid",
  "jobType": "CODE_FIX",
  "projectId": "npims-stg-skax-co-kr",
  "instruction": "실패한 login.spec.ts의 셀렉터 타임아웃 원인을 분석하고 수정하라",
  "context": {
    "failedExecutionId": "1042",
    "targetSpecPath": "tests/login.spec.ts",
    "baseCommit": "a1b2c3d"
  },
  "constraints": {
    "maxIterations": 5,
    "timeoutSeconds": 900,
    "allowedPathGlobs": ["tests/**", "src/**"],
    "deniedPathGlobs": ["package.json", "playwright.config.ts", ".env*"],
    "model": "claude-sonnet-5"
  },
  "callback": {
    "baseUrl": "http://api:8080/internal/ai-jobs/b3f5...-uuid",
    "token": "job-scoped 단기 토큰"
  },
  "llmProxy": {
    "baseUrl": "http://api:8080/internal/ai-jobs/b3f5...-uuid/llm"
  }
}
```

- `context.baseCommit`은 참조용 커밋 해시만 전달한다. git 자격증명은 포함하지 않는다.
- `constraints.allowedPathGlobs`/`deniedPathGlobs`는 [ai-integration-architecture.md](./ai-integration-architecture.md)의 자율 수정 루프 안전장치를 job 단위로 구체화한 것이다.
- `constraints.model`은 어떤 모델을 쓸지 지정하는 값일 뿐, 여기에도 다른 어디에도 실제 AI 공급자 API 키는 절대 담기지 않는다. 이 값은 job 생성 시 `Project.aiModelProvider`(아래 참고)에서 그대로 채워진다.
- `llmProxy.baseUrl`: AI Runner가 LLM을 호출할 때 두드리는 곳. 공급자 API(`api.anthropic.com` 등)로 직접 나가지 않고 이 `api` 내부 엔드포인트를 거친다 — `api`가 실제 키를 붙여 중계한다. 자세한 이유는 [ai-integration-architecture.md의 AI 공급자 API 키 정책](./ai-integration-architecture.md#ai-공급자-api-키-정책) 참고.
- `callback.token`: **job 생성 시 `api`가 발급하는 단기 유효기간 JWT**로 확정. 클레임은 `jobId`, `projectId`, `exp`(예: `constraints.timeoutSeconds` + 여유시간 정도의 짧은 만료)만 담는다. `api`는 콜백(heartbeat, `DIFF_READY` 보고)뿐 아니라 `llmProxy` 호출에도 같은 토큰을 검증에 사용한다 — 둘 다 같은 `api` 표면이라 토큰 체계를 따로 둘 이유가 없다. 이 job 전용 토큰이므로 컨테이너가 뚫려도 다른 job이나 프로젝트를 향한 요청을 위조할 수 없고, job이 끝나면(만료 시각 경과) 자동으로 무효화되어 별도 폐기(revoke) 로직이 필요 없다.

## 결과: `result.json` (AI Runner → `api`)

```json
{
  "jobId": "b3f5...-uuid",
  "status": "DIFF_READY",
  "iterationsUsed": 3,
  "changedFiles": ["tests/login.spec.ts"],
  "diffPath": "/result/diff.patch",
  "summary": "로그인 버튼 셀렉터가 변경되어 data-testid 기준으로 수정함",
  "logPath": "/result/run.log",
  "verification": {
    "targetSpecPath": "tests/login.spec.ts",
    "targetCaseFixed": true,
    "resultsJsonPath": "/result/verify-results.json",
    "regressedCases": []
  },
  "error": null
}
```

`verification`은 컨테이너가 diff 적용 후 **같은 spec 파일**을 자체적으로 재실행한 결과다. `targetCaseFixed`는 애초에 고치려던 케이스가 통과로 전환됐는지, `regressedCases`는 같은 spec 파일 안에서 그 사이 새로 실패하게 된 케이스 목록이다. 이 값 자체는 컨테이너의 자기 보고이므로 `api`는 `verifyResultsJsonPath`(Playwright JSON reporter 원본 출력)를 직접 파싱해서 재검증하고, `result.json`의 요약 필드는 참고용으로만 취급한다.

`api`는 `result.json`과 `diff.patch`, `verify-results.json`을 읽어 아래 위험도 평가를 수행한 뒤 `NEEDS_REVIEW`, `APPLIED`(자동), `REJECTED` 중 하나로 전이한다.

## Diff 위험도 평가 (`api` 측, `DIFF_READY` 처리 시)

AI가 작성한 diff를 곧바로 커밋하는 것은 이 플랫폼의 존재 이유(테스트 신뢰성 검증)와 정면으로 상충할 수 있다. 특히 "실패하는 테스트를 통과시키기 위해 assertion을 느슨하게 만드는" 패턴은 diff 크기와 무관하게 위험하므로, 크기 기반 임계값과 별개로 **하드 게이트**를 둔다.

### 1단계 — 하드 게이트 (하나라도 해당하면 크기와 무관하게 `NEEDS_REVIEW`, 자동 적용 불가)

| 신호 | 설명 |
|------|------|
| Assertion 개수 감소 | 삭제된 줄의 `expect(` 개수가 추가된 줄보다 많음 |
| Skip/fixme 추가 | 추가된 줄에 `.skip(`, `test.fixme(` 신규 등장 |
| 범위 축소(`.only`) | 추가된 줄에 `.only(` 신규 등장 — 같은 파일의 다른 케이스를 사실상 무력화 |
| 임의 sleep 추가 | 추가된 줄에 `waitForTimeout(` 신규 등장 — 타이밍 이슈를 근본 수정 대신 대기시간으로 덮는 전형적인 패턴 |
| 케이스 삭제 | 이전 버전에 있던 `caseKey`가 수정 후 사라짐 (아래 [Assertion 약화 탐지](#assertion-약화-탐지-구현) 참고) |
| 회귀 발생 | `verification.regressedCases`가 1건이라도 있으면 하드 게이트를 넘어 곧바로 `REJECTED` (사람 검토조차 대기하지 않음 — 이미 확인된 회귀는 재검토 대상이 아니라 반려 대상) |
| 목표 케이스 미해결 | `verification.targetCaseFixed == false` — 애초에 고치려던 케이스가 여전히 실패 → `REJECTED` |
| 반복 상한 도달 | `iterationsUsed >= constraints.maxIterations` — 수렴하지 못했다는 신호이므로 결과가 있어도 검토 필요 |
| 공유 리소스 변경 | `tests/support/**`처럼 여러 spec이 참조하는 파일을 건드림 — 영향 범위가 해당 spec 하나로 한정되지 않음 |
| 구조적 변경 | 파일 rename/delete가 diff에 포함 (순수 내용 수정이 아님) |

정규식 기반 탐지는 오탐이 나더라도 항상 "더 검토하는 쪽"으로 실패해야 한다 — 놓치는 것(false negative)이 과탐(false positive)보다 훨씬 위험하기 때문이다. 구체적인 패턴/구현은 [Assertion 약화 탐지 구현](#assertion-약화-탐지-구현) 참고.

### 2단계 — 정량 임계값 (하드 게이트를 통과한 diff에 한해 적용)

| 신호 | 기본 임계값 | 초과 시 |
|------|-------------|---------|
| `changedLines` (추가+삭제 합) | 30줄 | `NEEDS_REVIEW` |
| `changedFiles` | 2개 | `NEEDS_REVIEW` |
| timeout 값 증가 (soft) | 발견 시 `changedLines`에 건당 +10 가산 | (위 임계값에 합산) |

timeout 값을 늘리는 수정은 실제로 정당한 픽스인 경우가 많아(느리게 뜨는 요소를 더 기다려주는 등) 하드 게이트로 두지 않는다. 대신 `changedLines`를 부풀리는 가산점으로 반영해, 다른 변경과 겹치면 자연스럽게 검토 대상이 되게 한다.

두 조건을 모두 만족(임계값 이하)하고, 하드 게이트도 없고, `verification.targetCaseFixed == true`이고 `regressedCases`가 비어 있으면 자동 적용 **후보**가 된다.

### 3단계 — 프로젝트별 자동 적용 스위치

자동 적용 후보라도 `Project.aiAutoApplyEnabled`가 꺼져 있으면 무조건 `NEEDS_REVIEW`로 보낸다. **기본값은 `false`(전부 사람 검토)로 시작**하는 것을 권장한다 — AI가 코드를 직접 커밋하는 기능은 이번에 처음 도입되므로, 프로젝트별로 신뢰가 쌓인 뒤에만 담당자가 명시적으로 켜는 옵트인 방식이 맞다.

### 저장 위치: `Project` 엔티티 확장 (별도 정책 테이블 아님)

기존 `Project` 엔티티를 보면 `timeout`, `parallelLimit`, `dockerEnabled`, `runnerLifecycle`처럼 "프로젝트 1개당 값 1개"인 실행 정책은 전부 `projects` 테이블에 플랫 컬럼으로 있다. 반대로 별도 테이블(`scenario_case_settings`)로 분리한 건 프로젝트 1개당 여러 행이 생기는 데이터(spec/grep 조합별 설정)뿐이다 — "설정이라서" 분리한 게 아니라 카디널리티가 달라서 분리한 것이다.

`allowedPathGlobs`/`deniedPathGlobs`도 이미 있는 `envVariables` 컬럼(TEXT에 JSON 문자열로 저장)과 구조가 같다. `envVariables`를 나중에 별도 테이블(`project_environment_variables`)로 빼는 계획(`scenario-env-management.md` Phase 3)이 있긴 하지만, 그 이유는 "값이 secret이라 키별 마스킹이 필요해서"다. glob 패턴은 secret이 아니므로 그 분리 압력이 처음부터 적용되지 않는다.

따라서 아래 5개 필드는 전부 `Project`에 컬럼으로 추가한다.

```java
@Column(name = "ai_auto_apply_enabled")
private Boolean aiAutoApplyEnabled = false;

@Column(name = "ai_auto_apply_max_changed_lines")
private Integer aiAutoApplyMaxChangedLines = 30;

@Column(name = "ai_auto_apply_max_changed_files")
private Integer aiAutoApplyMaxChangedFiles = 2;

@Column(name = "ai_allowed_path_globs", columnDefinition = "TEXT")
private String aiAllowedPathGlobs = "[\"tests/**\"]";

@Column(name = "ai_denied_path_globs", columnDefinition = "TEXT")
private String aiDeniedPathGlobs = "[\"package.json\",\"playwright.config.ts\",\".env*\"]";

@Enumerated(EnumType.STRING)
@Column(name = "ai_model_provider", length = 20)
private AiModelProvider aiModelProvider = AiModelProvider.CLAUDE;
```

| Project 필드 | 설명 | 기본값 |
|---------------|------|--------|
| `aiAutoApplyEnabled` | 자동 적용 후보를 실제로 자동 커밋할지 | `false` |
| `aiAutoApplyMaxChangedLines` | 2단계 `changedLines` 임계값 프로젝트별 override | `30` |
| `aiAutoApplyMaxChangedFiles` | 2단계 `changedFiles` 임계값 프로젝트별 override | `2` |
| `aiAllowedPathGlobs` | job에 내려줄 수 있는 경로 범위의 **상한** | `["tests/**"]` |
| `aiDeniedPathGlobs` | 항상 제외할 경로 | `["package.json", "playwright.config.ts", ".env*"]` |
| `aiModelProvider` | 이 프로젝트의 AI 작업에 쓸 공급자/모델 (`CLAUDE`/`GPT`/`GEMINI`) | `CLAUDE` |

`aiModelProvider`는 **키가 아니라 선택값**이다. 실제 API 키는 `api` 환경변수에만 있고 ([ai-integration-architecture.md의 AI 공급자 API 키 정책](./ai-integration-architecture.md#ai-공급자-api-키-정책)), 프로젝트 설정 화면에는 이 드롭다운만 노출한다 — 키 입력 필드 자체를 두지 않는다. AI-TestOps는 회원가입 없는 단일 조직 내부 툴이라는 전제(공유 로그인, `User.role`은 `ADMIN`/`USER`뿐)를 이 결정의 근거로 삼는다. 여러 고객사에 별도 배포하는 셀프호스팅으로 방향이 바뀌면 고객사별 관리자가 자기 배포에 자기 키를 넣는 것으로 그대로 확장되지만, 하나의 배포를 여러 고객이 공유하며 AI 비용을 이 팀이 대신 부담·과금하는 모델로 간다면 이 결정 전체를 다시 검토해야 한다(조직/tenant 개념과 사용량 계측·과금 시스템이 없기 때문).

`job.json`의 `constraints.allowedPathGlobs`/`deniedPathGlobs`는 매 job마다 새로 입력받는 값이 아니라, job 생성 시 `api`가 이 `Project` 컬럼 값을 그대로 채워 넣는다. 만약 향후 job 생성 요청에서 더 좁은 범위를 지정할 수 있게 하더라도, `Project`에 저장된 값보다 **넓은** 범위는 절대 허용하지 않는다 — Project 컬럼이 이 프로젝트에서 AI가 건드릴 수 있는 파일의 상한선이다.

### `NEEDS_REVIEW` 처리

- 기존 "실패 알림 (Slack)" 채널을 재사용해 리뷰 대상이 생겼음을 알린다 (알림 내용에 `summary`, `diffPath`, 위험도 평가 사유를 포함).
- 담당자가 승인하면 `APPLIED`(적용자=사용자 ID로 기록), 거부하면 `REJECTED`로 전이한다. 이 전이는 [사용자 관리 기능 개선] 로드맵의 프로젝트별 권한 모델과 동일한 `UserRole` 체크를 거친다.

### 사후 안전망

`APPLIED` 시점의 `verification`은 같은 spec 파일 안에서의 회귀만 확인한 상태다. 다른 spec에 미치는 영향은 전체 프로젝트를 돌려봐야 드러난다. 상세 설계는 [사후 안전망: 자동 Revert](#사후-안전망-자동-revert) 참고.

## Assertion 약화 탐지 구현

1단계 하드 게이트 중 "Assertion 개수 감소 / Skip·fixme 추가 / `.only` 추가 / 임의 sleep 추가 / 케이스 삭제"를 실제로 어떻게 판정하는지 정의한다. `api`는 `diff.patch`(unified diff)와, `baseCommit`/현재 시점 두 버전의 전체 파일 내용을 갖고 있으므로 둘 다 활용한다.

**정규식 우선, AST는 나중**: `PlaywrightScenarioService`가 이미 `test.describe`/`test`/`.skip`/`.only`를 정규식으로 파싱하고 있다 (`tobe-architecture.md`의 시나리오 분석 전략과 동일 노선). 새로 AST 파서를 도입하지 않고 같은 정규식 스타일을 diff 판정에도 재사용한다. 전환 기준은 감으로 정하지 않는다 — **`NEEDS_REVIEW`로 넘어간 항목 중 담당자가 그대로 승인(=오탐)한 비율이 4주 이동평균으로 90%를 넘으면** AST 기반(예: TypeScript Compiler API/ts-morph) 전환을 검토한다.

### 판정 대상과 패턴

| 카테고리 | 판정 방식 | 패턴 |
|----------|-----------|------|
| Assertion 개수 감소 | diff hunk의 삭제(`-`)/추가(`+`) 줄에서 각각 매치 수 카운트, 삭제 쪽이 더 많으면 플래그 | `expect\s*\(` |
| Skip/fixme 추가 | 추가(`+`) 줄에서만 검사 (삭제 줄에도 있던 건 "이동"으로 보고 제외) | `\.(skip\|fixme)\s*\(` |
| `.only` 추가 | 추가(`+`) 줄에서만 검사 | `\.only\s*\(` |
| 임의 sleep 추가 | 추가(`+`) 줄에서만 검사 | `waitForTimeout\s*\(` |
| timeout 값 증가 (soft) | `{ timeout: N }` 형태를 삭제/추가 줄에서 각각 추출, 같은 hunk 안에서 추가된 값이 삭제된 값보다 크면 플래그. 대응하는 삭제 값이 없으면(신규 timeout 지정) 무조건 플래그 | `timeout\s*:\s*(\d+)` |
| 케이스 삭제 | `PlaywrightScenarioService`의 `DESCRIBE_PATTERN`/`TEST_PATTERN`으로 `baseCommit` 버전과 현재 버전을 각각 파싱해 `caseKey`(= `scenario-env-management.md`의 stable key) 집합을 만들고, 이전에는 있었는데 현재 집합에 없는 key가 있으면 플래그 | 기존 파서 재사용, 신규 정규식 없음 |

### 처리 원칙

- 이 판정은 전부 `api`에서 수행한다. AI Runner가 스스로 "약화 없음"이라고 `result.json`에 적어도 신뢰하지 않는다 (컨테이너 자기 신고 불신 원칙, [상태 모델](#상태-모델) 참고).
- 판정 결과(`riskFlags: string[]`)는 `AiJob`에 저장해 감사 이력으로 남기고, `NEEDS_REVIEW` Slack 알림에 그대로 노출한다. 예: `"⚠ assertion 2건 감소, waitForTimeout 1건 추가"`.
- 정규식은 줄 단위로 동작하므로 여러 줄에 걸친 `expect(...)` 체이닝 등은 놓칠 수 있다. 이는 감수할 오탐/누락이며, 놓친 사례가 실제 사고로 이어지면 그 패턴을 카탈로그에 추가하는 방식으로 점진적으로 보강한다.

## 사후 안전망: 자동 Revert

### 트리거 시점과 검증 대상 커밋

`APPLIED` 직후(자동이든 사람 승인이든 동일하게 적용) `api`가 곧바로 **해당 커밋 SHA를 대상으로** 전체 프로젝트 Execution을 하나 더 만든다. 다음 스케줄/수동 실행을 기다리지 않고 즉시 트리거하는 이유는, 그 사이에 다른 커밋이 얹히면 "누구 책임인 회귀인지" 특정할 수 없기 때문이다. 이 Execution은 기존 큐/러너 인프라를 그대로 쓰는 일반 프로젝트 실행이며, 트리거 소스만 `AI_POST_APPLY`로 구분한다.

### 판정 로직

```text
검증 Execution 완료
  -> execution_case_results를 직전 "마지막으로 성공한 전체 실행" baseline과 caseKey 기준 비교
  -> 비교 대상에서 원래 목표 케이스(job.context.targetSpecPath 관련 case)는 제외
     (그 케이스는 FAIL -> PASS가 이 작업의 목적이므로 회귀가 아니라 의도된 변화)
  -> 새로 FAIL로 전환된 case가 없으면: postApplyVerificationStatus = PASSED, 종료
  -> 있으면: 동일 케이스만 1회 더 재실행(retry)
     -> 재실행도 실패: REGRESSED 확정 (플레이키 테스트와 구분하기 위한 최소 확인)
     -> 재실행은 통과: PASSED로 종료, 플레이키 케이스로 기록만 남김 (자동 revert 안 함)
```

### REGRESSED 확정 시 처리

1. `api`가 해당 커밋을 `git revert {commitSha}`로 되돌리고 push한다 (`git reset`이 아니라 `revert`를 쓰는 이유: 히스토리를 지우지 않아 이미 이 커밋을 pull한 사람이 있어도 안전하게 정리된다).
2. `AiJob.postApplyVerificationStatus = REGRESSED`, `revertedAt`, `revertCommit`을 기록한다.
3. Slack으로 알린다 — 원래 diff 요약, 회귀 발견된 케이스 목록, revert 커밋 링크를 포함한다.
4. **자동으로 새 AI job을 재트리거하지 않는다.** 사람이 상황을 보고 다시 시도할지 결정한다 — 그렇지 않으면 "고침 → 다른 걸 깨뜨림 → 되돌림 → 다시 고침" 루프에 빠질 수 있다.

### 데이터 모델 추가 (`AiJob`)

| 필드 | 설명 |
|------|------|
| `postApplyVerificationStatus` | `PENDING`, `PASSED`, `REGRESSED`, `SKIPPED` |
| `postApplyVerificationExecutionId` | 검증용 Execution 참조 |
| `revertedAt` | 자동 revert 수행 시각 |
| `revertCommit` | revert 커밋 SHA |

### 적용 범위

이 안전망은 `AUTO_APPLIED`뿐 아니라 사람이 `NEEDS_REVIEW`를 승인해 `APPLIED`된 경우에도 동일하게 적용한다. 리뷰어도 diff만 보고는 다른 spec에 미치는 영향까지 알기 어렵기 때문이다.

## TEMPLATE_GENERATE 대상 경로

기존 `ProjectService.scaffold(...)` → `PlaywrightTemplateService.scaffold(projectPath, project, templateId, overwrite)` 흐름을 보면, `projectPath`는 이미 `Path.of(properties.projectsRoot(), projectId)` — 즉 다른 모든 job과 동일한 `/playwright-projects/{projectId}` 볼륨이다. 다만 이 함수는 `Project project`를 인자로 받으므로, **호출 시점에 이미 `Project` DB row가 존재해야 한다**는 전제가 깔려 있다. `TEMPLATE_GENERATE`가 "프로젝트 볼륨이 아직 없다"고 느껴졌던 건 이 전제가 채워지기 전에 job을 실행하려고 했기 때문이다.

**결론: 별도 스테이징 경로를 만들지 않는다. `api`가 AI Runner를 띄우기 전에 이 전제를 먼저 충족시킨다.**

```text
1. 사용자가 자연어 시나리오 설명 + 프로젝트명을 제출
2. api가 Project row를 먼저 생성한다 (projectId 채번, 기존 "새 프로젝트 만들기"와 동일 절차)
   -> 이 시점에 /playwright-projects/{projectId} 경로가 확정된다
3. api가 기존 PlaywrightTemplateService.scaffold(...)를 그대로 호출해
   기본 템플릿(package.json, playwright.config.ts, 기본 폴더 구조)을 결정론적으로 먼저 깐다
   -> AI가 매번 보일러플레이트를 새로 만들 필요가 없고, 틀리게 만들 위험도 없앤다
4. api가 TEMPLATE_GENERATE job을 생성한다
   -> job.json.projectId = 위에서 만든 projectId
   -> constraints.allowedPathGlobs = Project.aiAllowedPathGlobs (기본값 "tests/**")
   -> AI Runner는 이미 존재하는 /playwright-projects/{projectId}를 마운트받아
      자연어 설명에 맞는 spec 파일만 추가한다
5. 이후 DIFF_READY -> 위험도 평가 -> NEEDS_REVIEW/APPLIED는 CODE_FIX와 동일한 파이프라인을 탄다
```

기존 프로젝트에 "자연어로 새 시나리오 하나만 추가"하는 경우(신규 프로젝트가 아닌 경우)는 2~3단계가 생략되고 그냥 4번부터 시작한다 — `projectId`가 이미 있으므로 완전히 동일한 경로를 재사용한다.

`verification`의 의미는 `CODE_FIX`와 다르다: 고치려던 기존 실패 케이스가 없으므로 `targetCaseFixed`는 "새로 생성된 케이스가 실행되어 통과했는가"로 해석한다. 신규 프로젝트라 비교할 기존 baseline이 없는 경우 `regressedCases` 비교는 건너뛴다(항상 빈 배열 취급).

## 진행 상황 콜백

```text
POST {callback.baseUrl}/heartbeat
{ "iteration": 2, "message": "셀렉터 후보 3개 시도 중" }
```

`tobe-architecture.md`의 Worker heartbeat 패턴과 동일하게, 일정 시간 콜백이 끊기면 `api`가 해당 job을 `ERROR`(사유: heartbeat 유실)로 전환하고 컨테이너를 정리한다.

`allowedPathGlobs` 밖의 파일이 diff에 포함되면 위 위험도 평가와 별개로 항상 자동 `REJECTED`다. `maxIterations` 도달 시 부분 결과가 있어도 `FAILED`로 종료하고, 부분 diff는 참고용으로만 보관한다 (자동 적용하지 않음).

## Execution 데이터 모델과의 관계

기존 `Execution` 엔티티를 그대로 확장하기보다, 별도 `AiJob` 엔티티를 두고 `Execution`과 필요 시 1:1로 연결하는 방식을 권장한다. AI 작업 고유 필드(`jobType`, `iterationsUsed`, `diffPath`, `constraints`)가 `Execution`의 테스트 실행 스키마를 오염시키지 않기 때문이다.

## 결정 현황

Job spec의 열린 질문은 모두 확정되었다.

| 항목 | 결정 |
|------|------|
| Diff 위험도 임계값 | [Diff 위험도 평가](#diff-위험도-평가-api-측-diff_ready-처리-시) |
| Assertion 약화 탐지 방식 | [Assertion 약화 탐지 구현](#assertion-약화-탐지-구현) — 정규식 우선, 오탐률 기준 도달 시 AST 전환 |
| 사후 안전망(자동 revert) | [사후 안전망: 자동 Revert](#사후-안전망-자동-revert) |
| `allowedPathGlobs`/`deniedPathGlobs` 저장 위치 | [저장 위치](#저장-위치-project-엔티티-확장-별도-정책-테이블-아님) — `Project` 엔티티 확장 |
| `callback.token` 발급/검증 방식 | [요청 job.json](#요청-jobjson-api--ai-runner) — job 생성 시 발급하는 단기 JWT |
| `TEMPLATE_GENERATE` 대상 경로 | [TEMPLATE_GENERATE 대상 경로](#template_generate-대상-경로) — 기존 scaffold 흐름 재사용, `/playwright-projects/{projectId}` |
| AI 공급자 API 키 보관/과금 | [ai-integration-architecture.md의 AI 공급자 API 키 정책](./ai-integration-architecture.md#ai-공급자-api-키-정책) — 관리자가 등록하는 플랫폼 공용 키, `api` 프록시로 컨테이너에 노출 안 함 (단일 조직 내부 툴 전제) |

다음 단계는 이 문서의 설계를 [ai-integration-architecture.md](./ai-integration-architecture.md)의 아키텍처와 함께 실제 구현(엔티티/서비스/컨트롤러)으로 옮기는 것이다.
