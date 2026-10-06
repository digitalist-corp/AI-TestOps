# AI Runner

AI 작업 하나당 컨테이너 하나를 띄우고 끝나면 지우는 일회용 러너다(`docker run --rm`).
API 키를 받지 않으며, LLM 이 필요하면 api 의 내부 프록시(`/internal/ai-jobs/{id}/llm`)만 호출한다.

`job.json` 의 `jobType` 으로 동작이 갈린다.

| jobType | 파일 | 하는 일 | LLM |
|---|---|---|---|
| `CODE_FIX` (기본) | `run.js` | 실패한 spec 을 고치고 컨테이너 안에서 다시 돌려 검증 | 사용 |
| `EDIT_ASSIST_VERIFY` | `run.js` | 에디터의 제안 코드를 한 번 실행해 통과 여부만 반환 | 미사용 |
| `SITE_ANALYSIS` | `analyze.js` | 대상 사이트를 탐색해 화면 · 전환 · 검증된 셀렉터를 수집 | 미사용 |

환경변수: `AI_JOB_FILE`(job.json 경로), `AI_JOB_RESULT_DIR`(결과를 쓸 폴더).

## SITE_ANALYSIS — 대상 분석 v1 (DOM 경로)

테스트를 쓰기 전에 대상을 먼저 관찰한다. 링크를 따라 같은 호스트만 너비 우선으로 돌며
화면마다 상호작용 요소를 모으고, 요소마다 Playwright 셀렉터를 만들어 **실제로 그 요소 하나만
가리키는지 확인한 뒤** 채택한다. 클릭 · 입력을 하지 않으므로 대상 사이트에 부수 효과가 없다.

### 입력

```json
{
  "jobType": "SITE_ANALYSIS",
  "jobId": 1,
  "baseUrl": "http://host.docker.internal:3001/projects",
  "seedUrls": ["/projects/example.com/dashboard"],
  "limits": { "maxPages": 20, "maxDepth": 3, "timeoutMs": 180000 },
  "excludePatterns": ["/admin/danger"],
  "auth": { "storageStatePath": "/work/state.json" }
}
```

- `seedUrls` — 링크로 닿지 않는 화면(버튼으로만 이동하는 SPA 화면)의 시작점. 저장소 코드 분석이
  붙으면 코드에서 뽑은 라우트가 여기로 들어온다.
- `auth.storageStatePath` — 로그인된 세션. 프로젝트의 "로그인 선행 시나리오"가 만든 파일을 쓴다.
- 경로에 `logout · delete · remove` 등이 들어간 링크는 따라가지 않는다.

### 출력 — `result.json` + `screens/*.jpg`

| 필드 | 내용 |
|---|---|
| `mode` | `DOM` 또는 `VISUAL_REQUIRED`(첫 화면에 상호작용 요소가 없음 — 캔버스 렌더 대상) |
| `stats` | 화면 · 전환 · 요소 수, 검증된 셀렉터 수와 비율, 불안정 · 없음 개수 |
| `nodes[]` | 화면. URL · 제목 · 깊이 · 스크린샷 · 요소 목록 · 폼 · 접근성 트리(ariaSnapshot) |
| `nodes[].elements[]` | 요소. 역할 · 이름 · 채택한 셀렉터 · `unique` · `fragile`(순번 의존) |
| `edges[]` | 전환. 출발 · 도착 화면, 링크 이름, 그 링크의 셀렉터 |
| `warnings` · `redirects` | 상한 도달 · 열기 실패 · 리다이렉트 기록 |

셀렉터는 `getByTestId → getByRole → getByLabel → getByPlaceholder → getByText → 영역 범위(scoped)`
순으로 시도한다. 모두 여러 요소에 걸리면 `.nth(k)` 로 가리키되 `fragile: true` 로 표시한다.

### 로컬에서 직접 돌려보기

```bash
docker build -f apps/api/ai-runner.Dockerfile -t playops-ai-runner:latest apps/api
docker run --rm --add-host host.docker.internal:host-gateway \
  -v "<job.json 이 있는 폴더>:/work" \
  -e AI_JOB_FILE=/work/job.json -e AI_JOB_RESULT_DIR=/work/result \
  playops-ai-runner:latest
```

개발 서버(Vite)는 `allowedHosts` 에 등록된 호스트만 받는다. 컨테이너에서 로컬 웹에 접근할 때는
`host.docker.internal` 을 쓴다.

> api 는 이미지가 **없을 때만** 빌드한다. `run.js` · `analyze.js` 를 고친 뒤에는 위 명령으로
> 이미지를 직접 다시 빌드해야 반영된다.
