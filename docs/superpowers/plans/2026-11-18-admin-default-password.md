# 관리자 기본 비밀번호 제거 (3-1 보안) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin/admin 로 들어올 길을 없애고, 배포 게이트는 전용 계정으로, 시연 데이터(상태 · 알림)를 정리한다.

**Architecture:** V21 `users.password_change_required` 칸과 `AuthInterceptor` 검사로 변경을 강제한다. 로그인은 DB 해시로만. `.env` 관리자 값은 최초 생성과 "저장된 값이 admin 일 때 한 번 교체"에만 쓴다. 셀프 회귀는 `selftest` 계정을 쓰고 비밀번호는 playops-self 실행의 프로세스 환경으로만 넘긴다.

**Tech Stack:** Spring Boot 3.3 / Java 21 / Flyway / H2 테스트, React 19 + Vitest, Playwright 1.53, GitHub Actions(셸)

**Spec:** `docs/superpowers/specs/2026-11-18-admin-default-password-design.md`

## Global Constraints

- 마이그레이션 번호 V21 (`V21__user_password_change_required.sql`)
- 기본 비밀번호 상수는 `"admin"` 하나. 비었거나 `"admin"` 이면 기본값으로 본다
- 403 응답 코드 `PASSWORD_CHANGE_REQUIRED`, 열어 두는 경로 `GET /api/auth/me` · `POST /api/auth/logout` · `POST /api/auth/password`
- 새 비밀번호 규칙은 가입과 같다 (`UserService.validatePasswordForRegistration`: 10자 이상, 72바이트 이하)
- 비밀번호 · 토큰 값은 로그 · Actions 출력 · 문서에 남기지 않는다
- 커밋은 한국어 + conventional type. 브랜치 `feat/3-1-admin-password` (dev 에서)
- API 테스트: `docker run --rm -v "$PWD/apps/api":/app -v api-gradle-cache:/home/gradle/.gradle -w /app gradle:8.10.2-jdk21 ./gradlew test --no-daemon --console=plain`

## Review Focus

1. 기존 서버 DB 의 관리자 비밀번호가 admin 이 아닌데 `.env` 가 admin → 아무것도 바꾸지 않고, admin/admin 은 401 (Task 2 테스트)
2. 관리자가 여럿 있고 `LOGIN_USERNAME` 계정은 없음 → 새 관리자를 만들지 않는다 (Task 2 테스트)
3. 비밀번호 변경 강제 상태에서 현재 비밀번호를 틀리거나 새 값이 admin/짧음 → 400, 플래그 유지 (Task 1 테스트)
4. `SELFTEST_USERNAME` 이 이미 다른 사람(표시 이름이 '셀프 회귀'가 아님) 계정 → 건드리지 않음 (Task 2 테스트)
5. 프로젝트 없는 알림(공지)은 여전히 모두에게 (Task 4 테스트)

---

### Task 1: 로그인은 DB 해시로만 + 변경 강제 + 본인 비밀번호 변경

**Files:**
- Create: `apps/api/src/main/resources/db/migration/V21__user_password_change_required.sql`
- Modify: `entity/User.java`, `service/AuthService.java`, `dto/LoginResponse.java`, `controller/AuthController.java`, `config/AuthInterceptor.java`
- Test: `apps/api/src/test/java/com/playops/api/config/PasswordChangeIntegrationTest.java` (새, H2 · `LOGIN_PASSWORD=` 빈 값), `RolePermissionIntegrationTest` · `SignupTest` 의 관리자 비밀번호를 `admin-test-pass-1` 로

**Interfaces:**
- Produces: `User.isPasswordChangeRequired()/setPasswordChangeRequired(boolean)`; `AuthService.DEFAULT_PASSWORD = "admin"`; `static boolean AuthService.isDefaultPassword(String)` (null · 빈 값 · "admin" → true); `LoginResponse.passwordChangeRequired` (boolean, 마지막 필드); `AuthController.Me.passwordChangeRequired`; `POST /api/auth/password {currentPassword, newPassword}` → `LoginResponse`(새 토큰); `AuthService.changeOwnPassword(User, String current, String next, String userAgent)`

- [ ] **Step 1: 실패 테스트** `PasswordChangeIntegrationTest`
  - `defaultAdminMustChangePasswordBeforeAnythingElse`: admin/admin 로그인 200 · `passwordChangeRequired=true`; `GET /api/projects` 403 · `error.code=PASSWORD_CHANGE_REQUIRED`; `GET /api/auth/me` 200 · `passwordChangeRequired=true`
  - `changingPasswordRevokesOldTokensAndClearsFlag`: `POST /api/auth/password {"currentPassword":"admin","newPassword":"new-pass-1234"}` 200 · 새 토큰; 옛 토큰으로 `GET /api/auth/me` 401; 새 토큰으로 `GET /api/projects` 200; admin/admin 로그인 401
  - `rejectsWrongCurrentOrWeakNewPassword`: 현재 비밀번호 틀림 400, 새 값 `"admin"` 400, `"short"` 400 — 플래그 유지
  - `envPasswordNoLongerBypassesDb`: DB 비밀번호를 바꾼 뒤 `.env` 값(테스트 속성)으로 로그인 401
- [ ] **Step 2: 실행해 실패 확인** (`--tests '*PasswordChangeIntegrationTest'`)
- [ ] **Step 3: 구현**
  - V21: `ALTER TABLE users ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT FALSE;`
  - `authenticate`: `.env` 비교 분기와 그 안의 관리자 생성 삭제. DB 해시(평문 호환 포함)만
  - `issueSession` 이 `user.isPasswordChangeRequired()` 를 응답에 싣는다
  - `changeOwnPassword`: 현재 비밀번호 확인 → `UserService` 와 같은 규칙 + `isDefaultPassword(next)` 거절 → 저장 · 플래그 false → `revokeAllSessions` → `issueSession`. 규칙 함수는 `UserService.validatePasswordForRegistration` 을 `static` 으로 열어 재사용
  - 인터셉터: 사용자 확인 뒤 플래그가 켜져 있고 열어 둔 세 경로가 아니면 403 JSON (`writeRateLimitResponse` 와 같은 모양, code `PASSWORD_CHANGE_REQUIRED`, 메시지 "비밀번호를 바꾼 뒤 사용할 수 있습니다.")
- [ ] **Step 4: 전체 API 테스트 통과**
- [ ] **Step 5: 커밋** `feat: 관리자 기본 비밀번호면 먼저 바꾸게 하고 로그인은 DB 비밀번호로만 확인`

### Task 2: DataLoader — 최초 생성 · 기본값 교체 · selftest 계정

**Files:**
- Modify: `config/DataLoader.java`, `repository/UserRepository.java`
- Test: `apps/api/src/test/java/com/playops/api/config/DataLoaderAdminTest.java` (H2 `@DataJpaTest` 또는 리포지토리 목)

**Interfaces:**
- Consumes: Task 1 `isDefaultPassword`, `setPasswordChangeRequired`, `AuthService.revokeAllSessions`
- Produces: `UserRepository.existsByRole(UserRole)`; `.env` `SELFTEST_USERNAME`(기본 `selftest`) · `SELFTEST_PASSWORD`(기본 빈 값); `DataLoader.SELFTEST_NAME = "셀프 회귀"`

- [ ] **Step 1: 실패 테스트**
  - `createsAdminOnlyWhenNoAdminExists`: 관리자 없음 + `.env` 빈 값 → `admin` 생성, 비밀번호 admin, 플래그 true; `.env` `strong-pass-1234` → 플래그 false
  - `doesNotCreateWhenAnotherAdminExists`: 다른 이름의 관리자 존재 → `LOGIN_USERNAME` 계정 안 만듦
  - `replacesStoredDefaultWithEnvOnceAndRevokesSessions`: 저장값 admin + `.env` 강한 값 → 저장값 교체, 플래그 false, `revokeAllSessions` 호출
  - `leavesCustomPasswordAlone`: 저장값이 다른 값 + `.env` admin → 그대로, 플래그 그대로
  - `storedDefaultWithDefaultEnvSetsFlag`: 저장값 admin + `.env` admin → 플래그 true
  - `seedsSelftestAdminFromEnv`: 비밀번호 있으면 ADMIN · 표시 이름 '셀프 회귀'; 값이 바뀌면 다음 기동에 반영; 비면 안 만듦; 같은 아이디의 다른 사람 계정은 건드리지 않음
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 관리자 생성 · 교체는 `seedAdmin()`, selftest 는 `seedSelftest()` (`DemoDataSeeder.seedDemoPm` 과 같은 모양). `seedMembers` 의 PM 지정은 지금처럼 `LOGIN_USERNAME` 계정
- [ ] **Step 4: 전체 API 테스트 통과**
- [ ] **Step 5: 커밋** `feat: .env 관리자 값은 최초 생성에만 쓰고 셀프 회귀 전용 계정을 둠`

### Task 3: 셀프 회귀가 selftest 로 로그인하고 비밀번호가 리포트에 남지 않음

**Files:**
- Modify: `service/TestExecutionService.java` (명령 조립부 360~400행), `playwright-projects/playops-self/tests/regression.spec.ts`, `playwright-projects/playops-self/playwright.config.ts`
- Test: `apps/api/src/test/java/com/playops/api/service/SelfTestCredentialsTest.java`

**Interfaces:**
- Produces: `static void TestExecutionService.addSelfTestCredentials(String projectId, List<String> command, Map<String,String> processEnv, String username, String password)` — `playops-self` 일 때만 `-e SELFTEST_USERNAME=<username>` 와 값 없는 `-e SELFTEST_PASSWORD` 를 붙이고 `processEnv.put("SELFTEST_PASSWORD", password)`; 비밀번호가 비면 아무것도 안 함

- [ ] **Step 1: 실패 테스트** — playops-self: 명령에 `SELFTEST_PASSWORD` 가 값 없이 있고 비밀번호 문자열은 명령 어디에도 없음, `processEnv` 에는 있음; `example.com`: 명령 · 환경 변화 없음; 빈 비밀번호: 변화 없음
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — `pb.environment()` 를 넘긴다. 값은 `@Value("${SELFTEST_USERNAME:selftest}")` · `@Value("${SELFTEST_PASSWORD:}")`
- [ ] **Step 4: spec · config** — spec 은 `process.env.SELFTEST_USERNAME` · `SELFTEST_PASSWORD` (없으면 "SELFTEST_PASSWORD 가 없습니다" 로 실패). config 는 `trace: 'off'`, `video: 'off'` (스크린샷은 유지)
- [ ] **Step 5: 실제 Playwright 1.53 으로 확인** — `mcr.microsoft.com/playwright:v1.53.0-noble` 에서 로그인 칸에 비밀번호를 넣는 작은 spec 을 html · json · steps 리포터로 돌리고 `grep -r <값>` 이 0건. `fill` 단계 제목에 값이 남으면 spec 의 비밀번호 입력을 `locator.evaluate`(네이티브 setter + input 이벤트)로 바꾸고 다시 확인
- [ ] **Step 6: 커밋** `fix: 셀프 회귀는 전용 계정으로 로그인하고 비밀번호를 실행 인자 · 리포트에 남기지 않음 (#157)`

### Task 4: 프로젝트 알림은 멤버와 관리자에게만

**Files:** Modify `service/NotificationService.java`; Test `NotificationServiceTest.java`

**Interfaces:** 생성자에 `ProjectMemberRepository` 추가

- [ ] **Step 1: 실패 테스트** — `projectNotificationsGoToMembersAndAdminsOnly`(멤버 · 관리자 받음, 비멤버 팀원 안 받음, 비활성 안 받음), `noticesStillGoToEveryone`
- [ ] **Step 2: 실패 확인 → Step 3: 구현**(`projectId != null` 이면 `findByProjectId` 의 사용자 + `role == ADMIN`) **→ Step 4: 통과 → Step 5: 커밋** `fix: 프로젝트 알림은 그 프로젝트 멤버와 관리자에게만 보냄`

### Task 5: AI 키 설정 403 테스트

**Files:** Modify `RolePermissionIntegrationTest.java`

- [ ] **Step 1:** `aiProviderSettingsAreAdminOnly` — 팀원 · PM(example.com PM 으로 지정한 가입자) 의 `GET`/`PUT /api/admin/ai-provider-settings` 모두 403, 관리자 `GET` 200
- [ ] **Step 2:** 통과 확인(이미 막혀 있으면 바로 통과 — 회귀 방지용) **→ 커밋** `test: AI 제공자 설정은 PM · 팀원이 403 인지 확인`

### Task 6: 웹 — 비밀번호 변경 화면 · autocomplete 고정

**Files:**
- Create: `apps/web/src/pages/ChangePasswordPage.tsx`, `ChangePasswordPage.test.tsx`
- Modify: `api/client.ts`(403 `PASSWORD_CHANGE_REQUIRED` → `/change-password`, `changePassword(current, next)`, `LoginResponse.passwordChangeRequired`), `pages/LoginPage.tsx`(플래그면 `/change-password`), `App.tsx`(로그인 필요 · Layout 밖 라우트), `LoginPage.test.tsx`

- [ ] **Step 1: 실패 테스트** — LoginPage: 아이디 칸 `autocomplete="username"`, 비밀번호 칸 `"current-password"`, 두 칸 처음 값 `''`; 로그인 응답 플래그면 `/change-password` 로 이동. ChangePasswordPage: 새 비밀번호 칸 `autocomplete="new-password"`, 확인 불일치 시 안내 · 요청 안 함, 성공 시 새 토큰 저장 후 `/home`
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: `npm run test --workspace apps/web` · `npm run build --workspace apps/web` 통과**
- [ ] **Step 5: 커밋** `feat: 기본 비밀번호면 로그인 뒤 비밀번호 변경 화면으로 보냄`

### Task 7: 시연 데이터 — 상태 '실행' · 게스트 알림 비우기

**Files:** Modify `config/DemoDataSeeder.java`(새로 채울 때 `ProjectStatus.RUNNING`), `scripts/demo-reset.sh`; Test `DemoDataSeederTest.java`

- [ ] **Step 1:** `DemoDataSeederTest` 에 새로 채운 시연 프로젝트 상태 `RUNNING` 단언 → 실패 확인 → 구현 → 통과
- [ ] **Step 2:** `demo-reset.sh` — 1/4 앞에 프로젝트 상태를 RUNNING 으로(PM 이 쓰는 기존 상태 변경 API, `pmSetsProjectPeriodAndStatusButTeamMemberCannot` 이 쓰는 것과 같은 요청), 끝에 `POST /api/auth/guest` 토큰으로 `DELETE /api/notifications`. `bash -n scripts/demo-reset.sh` 통과
- [ ] **Step 3: 커밋** `fix: 시연 프로젝트 상태를 실행으로 두고 리허설 뒤 게스트 알림을 비움`

### Task 8: 배포 워크플로 · .env.example

**Files:** Modify `.github/workflows/deploy-test.yml`, `.env.example`, `docs/handoff/2026-11-18-시연-전-동결-상태.md`(관리자 · selftest 확인 명령 한 줄)

- [ ] **Step 1:** `.env.example`: `LOGIN_PASSWORD=`(빈 값, "비면 admin 으로 만들고 첫 로그인에 변경 강제" 주석), `SELFTEST_USERNAME=selftest`, `SELFTEST_PASSWORD=`
- [ ] **Step 2:** deploy: 시연 PM 블록 옆에 — `LOGIN_PASSWORD` 가 없거나 비었거나 `admin` 일 때만 `openssl rand -hex 16` 으로 교체(`::notice::` 만, 값 출력 없음), `SELFTEST_USERNAME`/`SELFTEST_PASSWORD` 는 없거나 빌 때만. 셀프 회귀 게이트 로그인은 `SELFTEST_*`, 시연 데이터 단계 로그인은 `DEMO_PM_*`. `${LOGIN_PASS:-admin}` 기본값 제거
- [ ] **Step 3:** `.env` 가 바뀌면 api 가 새 값을 읽도록 기존 `restart api` 가 뒤에 오는지 확인 (compose `env_file` 이면 `restart` 로는 안 읽힘 → `up -d --force-recreate api`). 확인 결과대로 고친다
- [ ] **Step 4:** `actionlint` 가 없으면 `bash -n` 으로 run 블록만 점검 **→ 커밋** `chore: 배포가 기본 관리자 비밀번호와 셀프 회귀 계정 비밀번호를 서버 .env 에 한 번만 만듦`

### Task 9: 검증 · 리뷰 · 배포

- [ ] API 테스트 · 웹 테스트 · `tsc`(build) 통과 출력 확보
- [ ] requesting-code-review 로 브랜치 리뷰 → 반영
- [ ] PR(dev) 에 인수인계 문서 · spec · plan 포함 → 머지 → dev→main PR → 배포 Actions 성공
- [ ] 배포 뒤: 배포 주소 admin/admin 401, 셀프 회귀 게이트 통과(실행 번호), `gh workflow run demo-rehearsal.yml` 통과, 미해결 결함 1건
- [ ] 서버 관리자 안내 한 단락
