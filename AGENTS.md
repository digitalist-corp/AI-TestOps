# AI-TestOps 에이전트 노트

Codex·Claude Code 공용. 기본 개발 환경은 **macOS(zsh, Apple Silicon)**이고, Windows 노트북 절차는 맨 아래에 남겨 둔다.

## 구조

- `apps/api` — Spring Boot 3.3 / Java 21 (Gradle Wrapper). 도구·승인·LLM 프록시·러너 오케스트레이션
- `apps/api/ai-runner` — AI 작업용 Node 러너 (`run.js`, `analyze.js`의 SITE_ANALYSIS 모드)
- `apps/web` — React 19 + Vite + TypeScript
- `apps/worker` — 테스트 실행 워커
- `playwright-projects/playops-self` — 플랫폼 자체 회귀 테스트
- `docs/` — 아키텍처·AI 작업 명세·계약·인수인계. 과제 산출물(PRD·TRD·차터 등 Office 파일)은 저장소 밖에서 관리한다

## 실행 (macOS)

Docker Desktop이 켜져 있어야 한다. `.env`가 없으면 `cp .env.example .env` 후 `PLAYOPS_ENCRYPTION_KEY`를 채운다 (`openssl rand -base64 32`, 한 번 정하면 변경 금지).

```bash
npm run dev        # docker compose -f docker-compose.dev.yml up --build
npm run down:dev
```

- Web http://localhost:3000, API http://localhost:8080, Postgres 호스트 포트 5433
- 초기 로그인은 `.env`의 `LOGIN_USERNAME` / `LOGIN_PASSWORD`
- 현재 Docker Desktop 메모리가 4GB다. 러너까지 돌리면 부족할 수 있어 `WORKER_CONCURRENCY=2` 유지

## 검증 (macOS)

Mac에는 JDK를 설치하지 않았다. 전역 `gradle`도 쓰지 말고, 프로젝트 래퍼를 Docker의 JDK 21 이미지로 실행한다.

```bash
# API 테스트
docker run --rm -v "$PWD/apps/api":/app -v api-gradle-cache:/home/gradle/.gradle -w /app \
  gradle:8.10.2-jdk21 ./gradlew test --no-daemon --console=plain

# Web 빌드
npm run build --workspace apps/web
```

## 규칙

- 커밋 메시지는 한국어, 제목 앞에 `feat:` `fix:` `chore:` 같은 conventional type을 붙인다.
- AI 변경은 사람 승인 후에만 반영한다 (`aiAutoApplyEnabled` 기본 false). main 직접 반영 금지.
- 현황 · 범위의 기준은 README의 프로젝트 차터다. 코드와 문서가 다르면 코드가 맞다.
- `.env`, `storage/`, `playwright-projects/*`(예외 제외)는 커밋하지 않는다.
- **개인 에이전트 설정 · 메모는 커밋하지 않는다.** `AGENTS.md` · `CLAUDE.md`는 팀 공용 규칙만 담고, 개인 설정은 `CLAUDE.local.md` · `.claude/` · `.codex/` · `.agents/` · `.superpowers/` · `graphify-out/`에 둔다(.gitignore). `git add -A` · `git add .` 대신 바꾼 파일만 골라 올린다.
- 과제 산출물 Office 파일(`docs/aQm-산출물/`)도 커밋하지 않는다.
- 문서에 `/Users/...` 같은 로컬 절대 경로를 쓰지 않는다. 저장소 기준 경로(`apps/web/...`)로 쓴다.

## Windows 노트북 (기존 절차)

PowerShell에서 한글을 출력하기 전에 UTF-8로 맞춘다.

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

```powershell
$env:JAVA_HOME = (Resolve-Path utils\bin\jdk-21).Path
Push-Location apps\api
.\gradlew.bat test
Pop-Location
```

- `utils/bin/jdk-21`은 프로젝트 로컬 JDK, `utils/bin/gradle-8.10.2`는 래퍼 재생성용 부트스트랩이다. 둘 다 gitignore 대상이라 Mac에는 없다.
- 전역 `gradle`은 일반 API 검증에 쓰지 않는다.
