# 클릭으로 테스트 만들기(녹화) — 서버 · 화면 계약

사용자가 테스트할 사이트를 화면에서 직접 클릭 · 입력하면, 그 동작을 실제로 하나만 가리키는 셀렉터로 기록하고 Playwright 테스트 코드로 바꿔 저장한다.
**AI 없이 동작한다.** (AI가 켜져 있으면 "AI로 다듬기"를 덧붙일 수 있지만 P1 범위 밖)

기존 "사이트 주소로 탐색"(analyze.js)은 링크를 자동으로 따라가며 화면 지도(구조 그래프)를 만드는 크롤러이고 클릭 · 입력을 하지 않는다. 녹화는 사람이 흐름을 보여주는 별개 기능이다.

## 동작 구조
- api 가 녹화 세션마다 `playops-ai-runner` 이미지로 컨테이너 하나를 띄운다: `docker run -d --rm --name rec-<sessionId> --network container:playops-api ... node /ai-runner/record.js`
  - api 와 네트워크 공간을 같이 쓰므로 record.js 는 세션마다 다른 포트(9400~9499)에서 HTTP 서버를 열고, api 는 `http://127.0.0.1:<port>` 로 부른다.
  - 컨테이너 안에서 Playwright Chromium(headless, 1280x800)으로 대상 사이트를 연다.
- 세션 상한: 사용자당 1개, 전체 4개. 10분 동안 동작이 없으면 api 가 컨테이너를 멈춘다.
- 프로젝트에 로그인 선행 세션(storageState)이 있으면 `useLogin: true` 일 때 그 상태로 시작.

## REST (api, 모두 Bearer 인증, 남의 세션이면 404)
| 메서드 · 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/projects/{projectId}/recorder/sessions` | `{ url?: string, useLogin?: boolean }` (url 없으면 프로젝트 baseUrl) | `RecorderState` (status STARTING 또는 READY) |
| `GET /api/projects/{projectId}/recorder/sessions/{sid}` | — | `RecorderState` |
| `GET /api/projects/{projectId}/recorder/sessions/{sid}/screenshot` | — | `image/jpeg` (현재 화면, viewport 크기) |
| `POST /api/projects/{projectId}/recorder/sessions/{sid}/actions` | `RecorderAction` | `RecorderState` (기록된 step 이 붙고 화면이 바뀐 뒤) |
| `PUT /api/projects/{projectId}/recorder/sessions/{sid}/steps` | `{ steps: RecordedStep[] }` (삭제 · 순서 · label 수정 반영) | `RecorderState` |
| `GET /api/projects/{projectId}/recorder/sessions/{sid}/code?title=` | — | `{ specPath: string, code: string }` (specPath 제안: `tests/recorded/<slug 또는 날짜>.spec.ts`) |
| `POST /api/projects/{projectId}/recorder/sessions/{sid}/save` | `{ specPath: string, title?: string }` | `{ specPath: string }` — 프로젝트 파일로 바로 저장(사람이 만든 코드라 AI 승인 대기 없음). 같은 경로가 있으면 409 |
| `DELETE /api/projects/{projectId}/recorder/sessions/{sid}` | — | 204 (컨테이너 종료) |

```ts
type RecorderState = {
  sessionId: string;
  status: 'STARTING' | 'READY' | 'BUSY' | 'CLOSED' | 'ERROR';
  url: string | null;          // 지금 열린 주소
  title: string | null;
  viewport: { width: number; height: number };
  steps: RecordedStep[];
  screenshotVersion: number;   // 화면이 바뀔 때마다 1씩 증가. 화면은 이 값으로 다시 받는다
  error?: string | null;
};

type RecorderAction =
  | { type: 'click'; x: number; y: number }               // viewport 좌표 (스크린샷 픽셀)
  | { type: 'fill'; x: number; y: number; value: string }  // 그 위치의 입력란에 값 입력
  | { type: 'press'; key: string }                          // 'Enter', 'Tab' 등
  | { type: 'goto'; url: string }                           // 절대 주소 또는 baseUrl 기준 경로
  | { type: 'assertVisible'; x: number; y: number }         // "이 요소가 보이는지 확인"
  | { type: 'assertText'; x: number; y: number }            // "이 요소의 글자가 같은지 확인" (현재 글자를 기대값으로)
  | { type: 'scroll'; deltaY: number }                      // 기록하지 않고 화면만 움직임
  | { type: 'inspect'; x: number; y: number };              // 기록하지 않고 그 위치 요소 정보만 → state.inspected

type RecordedStep = {
  id: string;
  action: 'goto' | 'click' | 'fill' | 'press' | 'assertVisible' | 'assertText';
  selector: string | null;     // Playwright 로케이터 식. 예: getByRole('button', { name: '로그인' })
  fragile: boolean;            // .nth() 순번에 기대는 셀렉터
  label: string;               // 사람이 읽는 설명. 예: "'로그인' 버튼 클릭"
  value?: string;              // fill · press · assertText 의 값, goto 의 경로
  secretEnv?: string;          // 비밀번호 입력이면 값을 저장하지 않고 이 환경변수 이름으로 코드에 넣는다 (기본 LOGIN_PASSWORD)
  url: string;                 // 동작 직후 주소
};
// inspect 응답은 RecorderState 에 inspected?: { role, name, selector, fragile, tag, box: {x,y,width,height} } 를 붙인다.
```

## 셀렉터 규칙
analyze.js 와 같은 순서: `getByTestId → getByRole(name) → getByLabel → getByPlaceholder → getByText → 영역 범위 → .nth(k)(fragile)`. 후보마다 실제로 `count() === 1` 이고 클릭한 그 요소인지 확인한 첫 후보를 쓴다.
클릭 지점의 요소는 `document.elementFromPoint` 후 가장 가까운 상호작용 요소(a, button, input, select, textarea, [role], [onclick], label)로 올라간다.

## 생성 코드 모양
```ts
import { test, expect } from '@playwright/test';

test('<title>', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill('user@example.com');
  await page.getByLabel('비밀번호').fill(process.env.LOGIN_PASSWORD ?? '');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByText('환영합니다')).toBeVisible();
});
```
- goto 는 baseUrl 과 같은 출처면 경로만 쓴다(Playwright config 의 baseURL 사용).
- fragile 셀렉터 줄 끝에는 `// 순번 의존 — 화면이 바뀌면 깨질 수 있음` 주석.
