# 관리자 기본 비밀번호 제거 · 셀프 회귀 전용 계정 · 시연 데이터 정리 (3-1 보안)

2026-11-18. 인수인계 `docs/handoff/2026-11-18-LangGraph-개선-인수인계.md` 3-1, 준호 승인.

## 왜

- 테스트 서버가 admin/admin 으로 열려 있을 수 있다. 시연(11/24) 전에 기본 비밀번호로 들어올 길을 없앤다.
- `AuthService.authenticate` 가 `.env` 의 `LOGIN_PASSWORD` 와 같으면 DB 와 상관없이 로그인시킨다. 화면에서 바꿔도 admin/admin 이 계속 통한다.
- 배포 게이트(셀프 회귀 spec)가 admin/admin 을 코드에 박아 쓴다. 진짜 관리자 계정을 테스트가 쓰면 안 된다.
- `NotificationService.notifyAll` 이 프로젝트와 상관없이 모든 사용자에게 보내 게스트 알림이 9+ 로 쌓이고, 권한 없는 프로젝트의 알림이 샌다.

## 목표

1. 로그인은 항상 DB 해시로만 판단한다. `.env` 의 `LOGIN_USERNAME` · `LOGIN_PASSWORD` 는 **관리자가 한 명도 없을 때** 최초 생성에만 쓴다.
2. 값이 비었거나 `admin` 이면 관리자를 `admin` 으로 만들되 `users.password_change_required = true` (V21). 이 상태의 토큰은 `GET /api/auth/me` · `POST /api/auth/logout` · `POST /api/auth/password` 외 모두 403 `PASSWORD_CHANGE_REQUIRED`. 웹은 비밀번호 변경 화면으로 보낸다.
3. 이미 있는 부트스트랩 관리자(`LOGIN_USERNAME`)의 저장된 비밀번호가 `admin` 이고 `.env` 값이 기본값이 아니면, 기동할 때 `.env` 값으로 바꾸고 모든 세션을 끊는다. (기본값을 없애는 한 번뿐인 교체. 그 밖의 경우 `.env` 는 기존 계정을 건드리지 않는다.)
4. 비밀번호를 바꾸면(본인 변경 · 관리자 수정 · 3의 교체) 그 사용자의 기존 토큰을 모두 무효화한다. 본인 변경은 새 토큰을 돌려준다.
5. 셀프 회귀 전용 계정 `selftest`(관리자 역할 — spec 이 프로젝트 생성 · 삭제를 한다). `.env` `SELFTEST_USERNAME` · `SELFTEST_PASSWORD`, 비밀번호가 비면 만들지 않는다. 값이 바뀌면 다음 기동에 반영(시연 PM 과 같은 방식, 표시 이름으로 다른 사람 계정 보호).
6. playops-self 실행에만 `SELFTEST_USERNAME` · `SELFTEST_PASSWORD` 를 넘긴다. 비밀번호 값은 `docker exec` 인자에 넣지 않고 프로세스 환경으로 넘긴다(`-e SELFTEST_PASSWORD`). playops-self 의 trace · video 는 끈다. 리포트(HTML · JSON · 단계 기록 · run.log)에 비밀번호가 남지 않는지 실제 Playwright 1.53 으로 확인한다.
7. `deploy-test.yml`: 서버 `.env` 의 `LOGIN_PASSWORD` 가 **없거나 비었거나 `admin` 일 때만** 무작위 값으로 바꾼다. 다른 값이면 건드리지 않는다. `SELFTEST_PASSWORD` 는 없거나 비었을 때만 만든다. 값은 출력하지 않는다. 셀프 회귀 게이트 · 시연 데이터 단계는 관리자 대신 `selftest` · 시연 PM 으로 로그인한다.
8. 프로젝트 알림은 그 프로젝트 멤버와 전역 관리자에게만. 공지 등 프로젝트 없는 알림은 지금처럼 모두에게.
9. `demo-reset.sh`: 게스트로 들어가 게스트 알림을 비우고, 시연 프로젝트 상태를 '실행'으로. `DemoDataSeeder` 가 새로 채울 때도 '실행'.
10. AI 제공자 설정 조회 · 수정은 PM · 팀원 403 (통합 테스트). 로그인 칸 `autocomplete="username"` / `"current-password"` 와 앱이 넣는 기본값 없음을 테스트로 고정.

## 비목표

- 헤더 AI 스위치는 그대로 둔다 (브라우저 localStorage 의 화면 설정일 뿐, 서버 · 키를 바꾸지 않는다).
- 비밀번호 정책 강화, 비밀번호 찾기.

## 접근

| 안 | 내용 | 판정 |
|---|---|---|
| A | `users.password_change_required` 칸 (V21) + 인터셉터 검사 | **채택**. 단순 · 재시작에도 유지 |
| B | 요청마다 저장 해시가 `admin` 인지 bcrypt 비교 | 탈락. 요청마다 수십 ms |
| C | 세션(메모리)에 제한 표시 | 탈락. 재시작하면 제한이 풀린다 |

배포 서버 비밀번호는 배포가 자동으로 바꾼다 (준호 결정, 비었거나 admin 일 때 한 번만).

## 배포 뒤 확인

- 배포 주소에서 admin/admin 로그인 실패 (401)
- 셀프 회귀 게이트 통과, `gh workflow run demo-rehearsal.yml` 통과, 미해결 결함 1건
- 서버 관리자에게 보낼 안내 한 단락 (새 비밀번호 확인 명령만, 값 없음)
