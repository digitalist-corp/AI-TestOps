# First Run Troubleshooting

이 문서는 AI-TestOps 저장소를 처음 받은 뒤 Docker Compose로 실행하면서 확인한 내용과 장애 처리 기록이다.

## 실행 기준

루트 디렉터리에서 실행한다.

```bash
docker compose up --build
```

접속 URL:

- Web: http://localhost:3000
- API health: http://localhost:8080/actuator/health
- PostgreSQL: localhost:5432

## 실행 모드 구분

### 개발모드

개발 중에는 `docker-compose.dev.yml`을 사용한다.

```bash
docker compose -f docker-compose.dev.yml up --build
```

개발모드 특징:

- `web`: Vite dev server로 실행된다. 소스 변경 시 HMR이 동작한다.
- `api`: `Dockerfile.dev`와 `gradle bootRun`으로 실행된다.
- `api`: `gradle classes --continuous`가 같이 실행되어 Java 변경을 감지한다.
- `api`: 디버그 포트 `5005`가 열린다.
- `postgres`: `./storage/postgres`에 데이터를 저장한다.
- `worker`: 개발모드 compose에는 포함되지 않는다.
- 초기 시스템 부팅 시 기본 관리자 계정 `admin / admin`이 자동 등록된다.

주의:

- Web 화면은 빠르게 뜨지만 API 부팅은 더 오래 걸릴 수 있다.
- 실제 확인 시 API 부팅에 약 140초가 걸린 사례가 있었다.
- API가 완전히 뜨기 전에 `admin / admin` 로그인을 시도하면 로그인 실패처럼 보일 수 있다.
- 로그인 전 `http://localhost:8080/actuator/health`가 `UP`인지 확인한다.

### 운영모드

운영 형태 확인에는 기본 `docker-compose.yml`을 사용한다.

```bash
docker compose up --build
```

운영모드 특징:

- `web`: 운영용 이미지로 실행된다.
- `api`: 운영용 Dockerfile로 빌드되어 실행된다.
- `worker`: 함께 실행된다.
- `postgres`: 개발모드와 동일하게 `./storage/postgres`에 데이터를 저장한다.
- 초기 시스템 부팅 시 기본 관리자 계정 `admin / admin`이 자동 등록된다.

주의:

- 개발모드와 운영모드가 같은 `./storage/postgres`를 사용하므로, 기존 DB 데이터가 그대로 남는다.
- DB 상태를 완전히 초기화해야 할 때만 `docker compose down` 후 `./storage/postgres` 삭제를 검토한다.
- 데이터 삭제는 프로젝트/사용자/실행 이력을 모두 지울 수 있으므로 필요한 경우에만 수행한다.

## 로그인 트러블슈팅

기본 로그인 계정은 다음과 같다.

```text
username: admin
password: admin
```

코드 기준으로 기본 계정은 다음 두 경로에서 보장된다.

- `DataLoader`: 서버 시작 시 `admin` 사용자가 없으면 생성한다.
- `AuthService`: `admin / admin` 로그인 요청 시 `admin` 사용자가 없으면 생성한다.

따라서 `admin / admin` 로그인이 안 될 때는 먼저 계정 자체보다 API 상태와 Web 프록시를 확인한다.

1. 컨테이너 상태 확인

```bash
docker compose -f docker-compose.dev.yml ps
```

운영모드라면 다음 명령을 사용한다.

```bash
docker compose ps
```

2. API health 확인

```bash
curl http://localhost:8080/actuator/health
```

정상 응답 예:

```json
{"status":"UP"}
```

3. API에 직접 로그인 요청

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri http://localhost:8080/api/auth/login `
  -Method POST `
  -ContentType 'application/json' `
  -Body '{"username":"admin","password":"admin"}'
```

4. Web 프록시 경유 로그인 요청

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri http://localhost:3000/api/auth/login `
  -Method POST `
  -ContentType 'application/json' `
  -Body '{"username":"admin","password":"admin"}'
```

정상 응답 예:

```json
{"token":"...","username":"admin","role":"ADMIN"}
```

API 직접 호출과 Web 프록시 호출이 모두 성공하면 백엔드와 프록시는 정상이다. 이 경우 브라우저에서 다음을 확인한다.

- `http://localhost:3000`으로 접속했는지 확인한다.
- API가 완전히 뜬 뒤 다시 로그인한다.
- 브라우저 localStorage의 `playops_token`, `playops_user`를 지우거나 시크릿 창에서 다시 시도한다.

## 한글 인코딩 트러블슈팅

소스와 문서는 UTF-8로 저장한다.

- HTML에는 `<meta charset="UTF-8" />`가 있어야 한다.
- 에디터는 `.editorconfig`의 `charset = utf-8` 설정을 따른다.
- PowerShell에서 파일을 확인할 때 한글이 깨져 보이면 `-Encoding UTF8`을 명시한다.

```powershell
Get-Content -Encoding UTF8 docs/first-run-troubleshooting.md
Get-Content -Encoding UTF8 apps/web/src/pages/LoginPage.tsx
```

콘솔 출력 자체가 깨질 때는 현재 세션의 출력 인코딩을 UTF-8로 맞춘다.

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
```

## 최초 실행 결과

2026-06-08 기준 최초 실행 확인 결과:

- `postgres`: 정상 기동, health `healthy`
- `api`: 정상 기동, `/actuator/health` 응답 `UP`
- `web`: 정상 기동, HTTP 200 응답
- `worker`: 정상 기동, 현재는 큐 polling 로그만 출력하는 stub

`docker compose up --build`는 foreground 로그를 계속 유지하므로, 자동화된 명령 실행에서는 timeout처럼 보일 수 있다. 이 경우 `docker compose ps`로 실제 컨테이너 상태를 확인한다.

## 확인한 실행 시나리오

1. 기본 계정 로그인
   - username: `admin`
   - password: `admin`
2. 기본 템플릿 프로젝트 생성
   - projectId: `smoke-default`
   - templateId: `default`
   - playwrightVersion: `1.53.0`
   - baseUrl: `https://example.com`
3. 프로젝트 전체 실행 요청
4. 실행 결과 확인

## 이슈 1: Playwright 패키지 버전과 Docker 이미지 버전 불일치

### 증상

첫 실행 결과가 `FAILED`로 종료되었다.

`results.json`의 주요 오류:

```text
Looks like Playwright was just updated to 1.60.0.
Please update docker image as well.
current: mcr.microsoft.com/playwright:v1.53.0-noble
required: mcr.microsoft.com/playwright:v1.60.0-noble
```

### 원인

템플릿 렌더링에서 프로젝트의 `playwrightVersion=1.53.0`을 npm range인 `^1.53.0`으로 바꾸고 있었다.

그 결과 `npm install`이 최신 호환 버전인 `@playwright/test@1.60.0`을 설치했고, 실행 컨테이너 이미지는 `mcr.microsoft.com/playwright:v1.53.0-noble`이라 브라우저 바이너리 경로가 맞지 않았다.

### 처리

템플릿 렌더링에서 Playwright 버전을 exact version으로 유지하도록 수정했다.

```text
@playwright/test: "1.53.0"
```

기존에 생성된 `smoke-default` 프로젝트도 `package.json`을 exact version으로 보정한 뒤 재실행했다.

### 결과

두 번째 실행은 `PASSED`로 종료되었다.

```text
totalTests=1
passedTests=1
failedTests=0
```

## 이슈 2: Docker runner containerId가 잘못 저장됨

### 증상

프로젝트 생성 응답의 `dockerContainerId`가 실제 컨테이너 ID가 아니라 `Unable to fi`로 저장되었다.

### 원인

프로젝트 runner 컨테이너를 처음 실행할 때 Docker 이미지가 로컬에 없으면 `docker run -d` 출력에 pull 안내 로그가 함께 포함될 수 있다.

기존 코드는 전체 출력의 앞 12글자를 container ID로 저장했다.

### 처리

`docker run -d` 출력의 마지막 줄부터 탐색하여 sha-like container ID 라인을 찾아 저장하도록 수정했다.

## 이슈 3: 실행 로그 중복 출력

### 증상

`stream.log`에서 같은 로그가 두 번씩 기록되었다.

### 원인

컨테이너 내부 script가 `tee -a stream.log`로 로그를 저장하고, API 프로세스도 Docker stdout을 읽어 `stream.log`에 다시 append하고 있었다.

### 처리

컨테이너 script는 stdout과 phase별 로그 파일만 기록하고, `stream.log` 기록은 API의 stdout reader가 담당하도록 정리했다.

## 운영 메모

- Playwright Docker 이미지는 같은 버전이면 Docker가 재사용한다.
- `npm install` 결과는 이미지에 저장되지 않는다.
- 프로젝트 디렉터리가 볼륨으로 마운트되면 `node_modules`와 `package-lock.json`은 프로젝트별로 남아 재사용될 수 있다.
- npm cache, npm global install, Node version cache는 `/storage/cache` 아래로 두어 host 기준 D 드라이브에 저장한다.
- PostgreSQL 데이터는 named volume 대신 `./storage/postgres` bind mount를 사용하면 D 드라이브에 저장된다.
- Docker 이미지/레이어/build cache는 Docker Desktop 저장소를 사용하므로, C 드라이브가 부족하면 Docker Desktop disk image location 또는 WSL distro 위치를 D 드라이브로 옮겨야 한다.
- 같은 프로젝트에서 `node_modules`를 재사용하려면 프로젝트별 동시 실행 수를 1로 제한하는 것이 안전하다.
- 실행 결과는 `/storage/reports/{projectId}/{executionId}`에 저장되므로 덮어쓰지 않는다.

## Windows Docker Desktop 저장소 D 드라이브 이동

Windows에서 Docker Desktop을 기본 설정으로 사용하면 Docker image, container layer, volume, build cache가 보통 C 드라이브의 Docker WSL disk에 저장된다.

현재 확인된 기본 위치:

```text
C:\Users\parkhw\AppData\Local\Docker\wsl\disk\docker_data.vhdx
```

C 드라이브 용량이 부족하면 Docker Desktop/WSL을 종료한 뒤 Docker WSL 데이터 폴더를 D 드라이브로 옮기고, 원래 위치에 junction을 만든다.

실행 순서:

```powershell
docker compose down

Get-Process |
  Where-Object { $_.ProcessName -like 'Docker*' -or $_.ProcessName -like 'com.docker*' } |
  Stop-Process -Force -ErrorAction SilentlyContinue

wsl --shutdown

$source = Join-Path $env:LOCALAPPDATA 'Docker\wsl'
$targetRoot = 'D:\docker-data\DockerDesktop'
$target = Join-Path $targetRoot 'wsl'

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
Move-Item -LiteralPath $source -Destination $target
New-Item -ItemType Junction -Path $source -Target $target | Out-Null
```

확인:

```powershell
Get-Item "$env:LOCALAPPDATA\Docker\wsl" | Select-Object FullName,LinkType,Target
Get-ChildItem D:\docker-data\DockerDesktop\wsl\disk
```

정상 예:

```text
C:\Users\parkhw\AppData\Local\Docker\wsl -> D:\docker-data\DockerDesktop\wsl
D:\docker-data\DockerDesktop\wsl\disk\docker_data.vhdx
```

이후 Docker Desktop을 다시 시작하고 Compose를 올린다.

```powershell
docker compose up -d --build
```

주의:

- Docker Desktop이 실행 중이면 `docker_data.vhdx` 이동이 실패할 수 있다.
- 이 방식은 로컬 PC의 Docker 저장소 위치 변경 절차이며, 팀 공통 설정은 아니다.
- 초기화가 가능하다면 미사용 build cache와 volume을 정리해도 된다.

```powershell
docker builder prune -af
docker volume prune -f
docker system df
```

## 기본 점검 명령

```bash
docker compose ps
docker compose logs --no-color --tail=80
```

API 확인:

```bash
curl http://localhost:8080/actuator/health
```

Web 확인:

```bash
curl http://localhost:3000
```
