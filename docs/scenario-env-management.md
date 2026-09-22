# Scenario and Environment Management

이 문서는 AI-TestOps에서 시나리오/케이스를 어떻게 관리할지, 프로젝트별 로그인/환경 변수를 어떻게 운영할지에 대한 To-Be 설계 방향을 정리한다.

## 결론

시나리오/케이스는 Playwright 소스에서 자동 파싱하되, 운영 관리는 DB에서 한다.

권장 구조:

```text
소스 코드 = 테스트 구현의 source of truth
DB = 운영 메타데이터, 실행 정책, skip/owner/tag/history 관리
```

즉, 실시간 소스 파싱만으로 모든 것을 처리하지 않고, 파싱 결과를 DB에 동기화한 뒤 관리 화면에서는 DB 기준으로 보여준다. 필요할 때 소스와 다시 sync한다.

## 실시간 파싱만 사용하는 방식

현재 방식은 프로젝트 파일을 읽고 spec을 파싱해 `describe/test` 트리를 만든다.

장점:

- DB 모델이 단순하다.
- 소스 변경이 즉시 화면에 반영된다.
- 초기 PoC와 데모에 빠르게 적합하다.
- 별도 동기화 작업이 필요 없다.

단점:

- 파일 수가 많아질수록 매 조회 비용이 커진다.
- regex 파서는 실제 Playwright 문법을 완벽히 따라가기 어렵다.
- 시나리오/케이스별 관리 상태를 저장하기 어렵다.
- 사용자가 케이스를 skip, owner 지정, tag 관리, 설명 편집하기 어렵다.
- 실행 당시의 케이스 구조와 현재 소스 구조가 달라질 수 있다.

따라서 실시간 파싱 only는 PoC 또는 소규모 데모에는 괜찮지만, 운영 관리 도구로는 부족하다.

## 사용자가 직접 시나리오/케이스를 생성하는 방식

사용자가 UI에서 시나리오와 케이스를 직접 만들고 DB로만 관리하는 방식도 가능하다.

장점:

- 운영 메타데이터 관리가 쉽다.
- skip, owner, priority, description, tag를 자연스럽게 관리할 수 있다.
- 테스트 명세 관리 도구처럼 사용할 수 있다.

단점:

- 실제 Playwright 소스와 DB 정의가 어긋날 수 있다.
- 개발자가 spec명을 바꾸거나 test title을 바꾸면 수동 정리가 필요하다.
- 자동화 실행과 명세 관리 사이에 중복 관리가 생긴다.

순수 DB 관리 방식은 테스트 케이스 관리 시스템에는 어울리지만, Playwright 기반 실행 플랫폼에는 소스와의 연결이 약해질 위험이 있다.

## 권장: 파싱 + DB 동기화 하이브리드

권장 방식은 다음과 같다.

1. Playwright 소스를 파싱한다.
2. spec/test마다 stable key를 만든다.
3. DB의 scenario/case 테이블과 동기화한다.
4. 관리 화면은 DB 기준으로 보여준다.
5. 소스 변경 감지 또는 수동 sync로 최신화한다.

```text
Playwright source
  -> parser/list command
  -> scenario_case_snapshot
  -> scenario/case DB metadata
  -> Web UI
```

## Stable Key

케이스 식별자는 파일 경로와 title 조합을 기본으로 만든다.

예:

```text
caseKey = hash(projectId + specPath + describePath + testTitle)
```

초기에는 아래 값으로 충분하다.

| 필드 | 예 |
|------|----|
| projectId | `naver.com` |
| specPath | `tests/search.spec.ts` |
| describeTitle | `Naver Search Scenario` |
| testTitle | `Case: submit a demo query` |
| grep | `Naver Search Scenario Case: submit a demo query` |

나중에는 test title 변경 추적을 위해 이전 key와 매칭하거나, 소스에 명시적 annotation/tag를 넣는 방법을 검토한다.

## DB 모델 제안

### scenario_specs

| 필드 | 설명 |
|------|------|
| id | PK |
| projectId | 프로젝트 ID |
| specPath | spec 파일 경로 |
| title | spec 표시명 |
| caseCount | 케이스 수 |
| sourceHash | 파일 내용 hash |
| syncedAt | 마지막 동기화 시간 |
| active | 현재 소스에 존재하는지 여부 |

### scenario_cases

| 필드 | 설명 |
|------|------|
| id | PK |
| projectId | 프로젝트 ID |
| specPath | spec 파일 경로 |
| caseKey | 안정 식별자 |
| type | `DESCRIBE`, `TEST` |
| title | 케이스명 |
| describePath | 상위 describe 경로 |
| grep | 실행 필터 |
| line | 소스 라인 |
| active | 현재 소스에 존재하는지 여부 |
| skipMode | `NONE`, `MANUAL`, `UNTIL_FIXED`, `ENV_ONLY` |
| skipReason | skip 사유 |
| owner | 담당자 |
| tags | smoke, regression 등 |
| priority | 우선순위 |
| lastStatus | 마지막 실행 상태 |
| lastExecutionId | 마지막 실행 ID |

## Skip 처리

운영 도구에서는 skip 처리가 매우 중요하다. 소스의 `test.skip()`만으로는 운영 상황을 모두 감당하기 어렵다.

권장 skip 레벨:

| 레벨 | 설명 |
|------|------|
| Source skip | 코드에 `test.skip()`으로 명시된 skip |
| Manual skip | 관리자가 UI에서 특정 케이스 skip |
| Environment skip | 특정 환경에서만 skip |
| Temporary skip | 특정 날짜 또는 이슈 해결 전까지 skip |

실행 시에는 DB skip 정책을 읽고 실행 대상에서 제외한다.

초기 구현 방식:

```text
실행 요청 생성
-> active case 목록 조회
-> skipMode != NONE 제외
-> 실행 대상 spec/grep 목록 생성
```

Playwright 명령에서 제외하려면 초기에는 grep 조합으로 include만 실행하고, 고도화 단계에서는 generated grep file 또는 test list 기반 실행을 검토한다.

## 실행 이력과 케이스 연결

Execution은 실행 요청 단위이고, Case Result는 케이스 결과 단위다.

권장 추가 모델:

### execution_case_results

| 필드 | 설명 |
|------|------|
| executionId | 실행 ID |
| caseKey | 케이스 key |
| projectId | 프로젝트 ID |
| specPath | spec 파일 |
| title | 실행 당시 title |
| status | passed, failed, skipped |
| durationMs | 실행 시간 |
| errorMessage | 실패 메시지 |
| retry | retry 횟수 |

이 테이블이 있어야 “최근 실패 케이스”, “계속 실패하는 케이스”, “skip 필요한 케이스”를 관리할 수 있다.

## 프로젝트 관리 속성

프로젝트가 늘어나면 실행 설정만으로는 관리가 어렵다. 프로젝트 목록과 상세 화면에는 운영 식별용 메타데이터를 함께 둔다.

1차 권장 필드:

| 필드 | 설명 |
|------|------|
| displayOrder | 목록 표시 순번. 운영자가 원하는 정렬 기준으로 사용한다. |
| serverType | `DEV`, `TEST`, `PROD` 서버 구분. 화면에서는 개발/테스트/운영으로 표시한다. |
| description | 프로젝트 설명. 대상 시스템이나 업무 범위를 적는다. |
| testPurpose | 테스트 목적. 스모크, 회귀, 배포 검증 등 목적을 적는다. |
| managerName | 프로젝트 관리자 또는 담당자명. |
| managerContact | 담당자 연락처. 이메일, 메신저, 내선 등을 적는다. |

추가로 검토할 만한 필드:

| 필드 | 활용 |
|------|------|
| businessDomain | 업무 도메인. 예: 회원, 주문, 정산, 포털. |
| criticality | 중요도. 장애 영향도나 실행 우선순위 산정에 사용한다. |
| projectStatus | 운영 상태. active, paused, archived 등. |
| notificationChannel | 실패 알림 채널. Slack, Teams, email 등. |
| defaultEnvironment | 기본 실행 환경. dev/test/prod 중 하나. |
| scheduleEnabled | 정기 실행 사용 여부. |

초기에는 1차 권장 필드만 화면에 노출하고, 실행 정책과 알림이 들어가는 시점에 추가 필드를 확장한다.

## 환경 변수와 로그인 관리

프로젝트별 환경 정보는 DB에서 관리하고, 실행 컨테이너에는 환경 변수로 주입한다.

필요한 정보:

| 항목 | 예 |
|------|----|
| baseUrl | `https://stg.example.com` |
| username | 로그인 ID |
| password | 로그인 비밀번호 |
| tenant | 고객사/조직 코드 |
| featureFlag | 테스트 환경 플래그 |
| apiBaseUrl | API endpoint |
| storageState | 로그인 세션 파일 경로 |

## 환경 모델 제안

### project_environments

| 필드 | 설명 |
|------|------|
| id | PK |
| projectId | 프로젝트 ID |
| envKey | `local`, `dev`, `stg`, `prod` |
| displayName | 화면 표시명 |
| baseUrl | 대상 URL |
| enabled | 사용 여부 |
| isDefault | 기본 환경 여부 |
| createdAt | 생성 시간 |
| updatedAt | 수정 시간 |

### project_environment_variables

| 필드 | 설명 |
|------|------|
| id | PK |
| environmentId | 환경 ID |
| key | 변수명 |
| value | 값 |
| secret | 비밀값 여부 |
| required | 필수 여부 |
| description | 설명 |

secret 값은 평문으로 화면에 다시 보여주지 않는다. 저장 시 암호화하고, 화면에는 `설정됨`/`미설정` 상태만 표시한다.

## 화면 요구사항

프로젝트 설정 화면에 환경 탭을 둔다.

표시 항목:

- 환경 목록: local/dev/stg/prod 등
- baseUrl
- 필수 변수 설정 여부
- secret 설정 여부
- 마지막 수정자/수정일
- 기본 환경 여부

변수 화면:

| 변수 | 상태 | 설명 | 동작 |
|------|------|------|------|
| `BASE_URL` | 설정됨 | 접속 URL | 수정 |
| `LOGIN_ID` | 설정됨 | 로그인 ID | 수정 |
| `LOGIN_PASSWORD` | 설정됨, secret | 로그인 비밀번호 | 재설정 |
| `TENANT_CODE` | 미설정 | 조직 코드 | 등록 유도 |

필수값이 없으면 실행 버튼 근처에서 등록을 유도한다.

```text
STG 환경에 LOGIN_PASSWORD가 없습니다. 실행 전 환경 값을 등록하세요.
```

## 실행 시 환경 주입

실행 요청에는 environment key를 포함한다.

```json
{
  "environment": "stg",
  "specPath": "tests/login.spec.ts",
  "grep": "Login Scenario Case: login success"
}
```

API/Worker는 해당 환경의 변수를 읽어 Docker 컨테이너에 `-e KEY=VALUE`로 주입한다.

```text
docker run
  -e BASE_URL=https://stg.example.com
  -e LOGIN_ID=...
  -e LOGIN_PASSWORD=...
```

## 로그인 세션 관리

반복 로그인을 줄이려면 Playwright `storageState`를 사용할 수 있다.

단계:

1. 환경별 로그인 setup spec 실행
2. `storageState` 파일 생성
3. 이후 테스트에서 해당 storageState 사용
4. 만료 시 재생성

보관 경로 예:

```text
/storage/auth/{projectId}/{envKey}/storage-state.json
```

주의:

- storageState는 민감 정보로 취급한다.
- 환경별로 분리한다.
- 만료/재로그인 기능이 필요하다.

## 추천 구현 순서

### Phase 1

- scenario/spec/case DB 테이블 추가
- 현재 파서 결과를 DB에 sync하는 API 추가
- 관리 화면은 DB 기준으로 시나리오 표시
- sourceHash로 변경 여부 표시

### Phase 2

- 케이스별 skipMode, skipReason, owner, tags 추가
- execution 결과를 caseKey와 연결
- 실패/skip 케이스 필터 제공

### Phase 3

- project_environments 추가
- 환경 변수 CRUD
- secret 변수 암호화/마스킹
- 실행 요청에 environment 선택 추가

### Phase 4

- 로그인 storageState 관리
- 환경별 필수값 validation
- 실행 전 누락 변수 등록 유도

## 최종 의견

사용자가 시나리오/케이스를 관리하고 싶다면 실시간 파싱 only는 비추다. 다만 사용자가 모든 케이스를 직접 등록하는 방식도 소스와 어긋날 가능성이 크다.

가장 좋은 방향은 소스 파싱으로 케이스를 발견하고, DB에서 운영 상태를 관리하는 하이브리드다.

이 방식이면 다음을 모두 만족할 수 있다.

- 개발자는 Playwright 소스를 계속 관리한다.
- AI-TestOps는 시나리오/케이스 목록을 자동 제공한다.
- 운영자는 skip, owner, tag, priority, 설명을 관리한다.
- 실행 이력은 케이스 단위로 누적된다.
- 로그인/환경 변수는 프로젝트/환경별로 안전하게 주입된다.
