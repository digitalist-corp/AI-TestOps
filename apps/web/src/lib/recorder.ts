import type {
  RecordedStep,
  RecordedStepAction,
  RecorderInspected,
  RecorderStatus,
  RecorderViewport,
} from '@/types';

/**
 * "클릭으로 만들기(녹화)" 화면의 순수 로직.
 * 화면(React)과 분리해 두어 좌표 변환 · 단계 편집 · 문구를 단위 테스트로 지킨다.
 */

// ── 좌표 ──────────────────────────────────────────────

/** 화면에 그려진 스크린샷의 위치와 크기 (getBoundingClientRect 의 일부) */
export type DisplayRect = { left: number; top: number; width: number; height: number };

export type ViewportPoint = { x: number; y: number };

/**
 * 마우스 위치(브라우저 창 기준)를 원격 브라우저의 viewport 좌표로 바꾼다.
 * 스크린샷은 화면에서 줄어들거나 늘어나 보이므로 "표시 크기 ↔ viewport" 비율로 환산한다.
 * 그림 밖이거나 크기를 알 수 없으면 null.
 */
export function toViewportPoint(
  client: { x: number; y: number },
  rect: DisplayRect,
  viewport: RecorderViewport
): ViewportPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const localX = client.x - rect.left;
  const localY = client.y - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null;

  // 오른쪽 · 아래 가장자리는 viewport 안쪽 마지막 픽셀로 맞춘다.
  const x = Math.min(viewport.width - 1, Math.round((localX * viewport.width) / rect.width));
  const y = Math.min(viewport.height - 1, Math.round((localY * viewport.height) / rect.height));
  return { x, y };
}

/** viewport 좌표의 상자를 그림 크기에 상관없이 겹쳐 그릴 수 있게 퍼센트로 바꾼다. */
export function boxToPercent(
  box: { x: number; y: number; width: number; height: number },
  viewport: RecorderViewport
): { left: string; top: string; width: string; height: string } {
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  return {
    left: pct(box.x, viewport.width),
    top: pct(box.y, viewport.height),
    width: pct(box.width, viewport.width),
    height: pct(box.height, viewport.height),
  };
}

/** viewport 좌표 한 점을 퍼센트 위치로 바꾼다 (팝오버를 그 자리에 띄울 때). */
export function pointToPercent(
  point: ViewportPoint,
  viewport: RecorderViewport
): { left: string; top: string } {
  return {
    left: `${(point.x / viewport.width) * 100}%`,
    top: `${(point.y / viewport.height) * 100}%`,
  };
}

/** viewport 좌표의 한 점이 상자 안에 있는지 */
export function boxContains(
  box: { x: number; y: number; width: number; height: number },
  point: ViewportPoint
): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** 휠 값을 픽셀 단위로 맞춘다. 마우스에 따라 줄(1) · 쪽(2) 단위로 올 수 있다. */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) return Math.round(deltaY * 16);
  if (deltaMode === 2) return Math.round(deltaY * viewportHeight);
  return Math.round(deltaY);
}

// ── 모드 ──────────────────────────────────────────────

/** 화면을 눌렀을 때 무엇을 할지. 키(Enter)는 누르는 즉시 보내는 동작이라 모드가 아니다. */
export type RecorderMode = 'click' | 'fill' | 'assertVisible' | 'assertText';

export const RECORDER_MODES: { id: RecorderMode; label: string; hint: string }[] = [
  { id: 'click', label: '클릭', hint: '누를 곳을 클릭하세요. 그 동작이 단계로 기록돼요.' },
  { id: 'fill', label: '입력', hint: '값을 넣을 입력칸을 클릭하세요. 작은 창에서 값을 받아요. (선택 상자는 아직 지원하지 않아요)' },
  { id: 'assertVisible', label: '확인: 보이는지', hint: '화면에 보여야 하는 곳을 클릭하세요. 보이는지 확인 단계가 돼요.' },
  { id: 'assertText', label: '확인: 글자', hint: '글자를 확인할 곳을 클릭하세요. 지금 보이는 글자가 기대값이 돼요.' },
];

// ── 단계 편집 ─────────────────────────────────────────

/** 단계를 위(-1) 또는 아래(+1)로 한 칸 옮긴다. 맨 끝이거나 없는 id 면 같은 배열을 그대로 돌려준다. */
export function moveStep(steps: RecordedStep[], id: string, direction: -1 | 1): RecordedStep[] {
  const from = steps.findIndex((step) => step.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const next = steps.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** 단계를 지운다. 없는 id 면 같은 배열을 그대로 돌려준다. */
export function removeStep(steps: RecordedStep[], id: string): RecordedStep[] {
  if (!steps.some((step) => step.id === id)) return steps;
  return steps.filter((step) => step.id !== id);
}

/** 값(value)을 고칠 수 있는 동작. 서버(mergeSteps)와 같다 — 비밀번호(secretEnv) 단계는 값이 없으므로 제외. */
const VALUE_EDITABLE: RecordedStepAction[] = ['goto', 'fill', 'press', 'assertText'];

export function canEditValue(step: RecordedStep): boolean {
  return !step.secretEnv && VALUE_EDITABLE.includes(step.action);
}

/** 값 입력칸 위에 붙일 이름. 값을 고칠 수 없는 단계는 null. */
export function valueFieldLabel(step: RecordedStep): string | null {
  if (!canEditValue(step)) return null;
  switch (step.action) {
    case 'goto':
      return '이동할 주소';
    case 'fill':
      return '입력할 값';
    case 'press':
      return '누를 키';
    default:
      return '기대하는 글자';
  }
}

export type StepEdit = { label?: string; value?: string };

/**
 * 단계의 설명(label)과 값(value)을 고친다. 바뀐 게 없으면 같은 배열을 돌려줘서 서버 호출을 건너뛸 수 있다.
 *  - label 은 다듬어서 쓰고, 비면 그대로 둔다.
 *  - value 는 고칠 수 있는 단계(canEditValue)만 바꾼다. 입력(fill)은 빈 값도 되고, 나머지는 비면 그대로 둔다.
 */
export function editStep(steps: RecordedStep[], id: string, patch: StepEdit): RecordedStep[] {
  const target = steps.find((step) => step.id === id);
  if (!target) return steps;

  let label = target.label;
  if (patch.label !== undefined && patch.label.trim()) label = patch.label.trim();

  let value = target.value;
  if (patch.value !== undefined && canEditValue(target)) {
    const next = target.action === 'fill' ? patch.value : patch.value.trim();
    if (target.action === 'fill' || next) value = next;
  }

  if (label === target.label && value === target.value) return steps;
  return steps.map((step) =>
    step.id === id ? { ...step, label, ...(value !== undefined ? { value } : {}) } : step
  );
}

/** 단계 설명(label)만 바꾼다. */
export function renameStep(steps: RecordedStep[], id: string, label: string): RecordedStep[] {
  return editStep(steps, id, { label });
}

/** 저장 뒤에 단계가 바뀌었는지 비교하려고 쓰는 짧은 지문. 순서 · 설명 · 값이 바뀌어도 달라진다. */
export function stepsSignature(steps: RecordedStep[]): string {
  return steps.map((step) => `${step.id}\u0001${step.label}\u0001${step.value ?? ''}`).join('\u0002');
}

// ── 단계 → 아이콘 · 설명 ──────────────────────────────

/** 화면이 lucide 아이콘으로 바꿔 쓰는 이름. 라이브러리에 묶이지 않게 문자열로 둔다. */
export type StepIconKey = 'globe' | 'click' | 'input' | 'key' | 'eye' | 'text';

const STEP_META: Record<RecordedStepAction, { icon: StepIconKey; kind: string }> = {
  goto: { icon: 'globe', kind: '이동' },
  click: { icon: 'click', kind: '클릭' },
  fill: { icon: 'input', kind: '입력' },
  press: { icon: 'key', kind: '키' },
  assertVisible: { icon: 'eye', kind: '보이는지 확인' },
  assertText: { icon: 'text', kind: '글자 확인' },
};

export function stepIconKey(step: Pick<RecordedStep, 'action'>): StepIconKey {
  return STEP_META[step.action]?.icon ?? 'click';
}

export function stepKindLabel(step: Pick<RecordedStep, 'action'>): string {
  return STEP_META[step.action]?.kind ?? step.action;
}

const MAX_VALUE_LENGTH = 60;

function clip(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/**
 * 단계 이름(label) 아래에 작게 보여줄 값 설명. 보여줄 값이 없으면 null.
 * 비밀번호처럼 환경변수로 저장되는 입력은 값이 남아 있더라도 절대 보여주지 않는다.
 */
export function describeStepValue(step: RecordedStep): string | null {
  if (step.secretEnv) return `환경변수 ${step.secretEnv}`;
  switch (step.action) {
    case 'goto':
      return step.value ?? null;
    case 'fill':
      return step.value != null ? `값: ${clip(step.value)}` : null;
    case 'press':
      return step.value != null ? `키: ${step.value}` : null;
    case 'assertText':
      return step.value != null ? `기대 글자: ${clip(step.value)}` : null;
    default:
      return null;
  }
}

// ── 상태 ──────────────────────────────────────────────

/**
 * 서버에 상태를 다시 물어보는 간격(ms). 0 이면 묻지 않는다.
 * 준비 중 · 동작 중은 자주, 평소(READY)는 유휴 종료를 알아채려고 가끔만 묻는다.
 * (화면의 상태 조회는 서버가 유휴 시간으로 세지 않는다)
 */
export function pollIntervalMs(status: RecorderStatus): number {
  if (status === 'STARTING' || status === 'BUSY') return 1000;
  if (status === 'READY') return 10_000;
  return 0;
}

/** 시작할 때 서버가 자동으로 붙이는 첫 goto 말고, 사람이 한 일이 있는지 */
export function hasRecordedWork(steps: RecordedStep[]): boolean {
  return steps.some((step) => step.action !== 'goto');
}

/** 스크린샷을 받아 보여줄 수 있는 상태 */
export function hasScreen(status: RecorderStatus): boolean {
  return status === 'READY' || status === 'BUSY';
}

// ── 입력 도우미 ───────────────────────────────────────

const PASSWORD_HINT = /비밀번호|패스워드|암호|password|passwd|pwd/i;

/**
 * 마우스 아래 요소가 비밀번호 칸처럼 보이는지. 서버가 input type 을 알려주지 않아
 * 입력란이면서 이름 · 셀렉터에 비밀번호 단서가 있는지로 짐작한다. (안내 문구 용도)
 */
export function looksLikePasswordField(inspected: RecorderInspected | null | undefined): boolean {
  if (!inspected || inspected.tag.toLowerCase() !== 'input') return false;
  return PASSWORD_HINT.test(`${inspected.name ?? ''} ${inspected.selector ?? ''}`);
}

/**
 * 주소 입력칸의 글을 서버가 받는 주소로 바꾼다. (절대 주소 또는 baseUrl 기준 경로)
 *  - `https://a.com/x`, `/login` 은 그대로
 *  - `example.com/x` 처럼 도메인이면 https:// 를 붙인다
 *  - `login` 같은 한 단어는 경로로 보고 `/login`
 * 비었으면 null.
 */
export function normalizeGotoInput(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^https?:\/\//i.test(text) || text.startsWith('/')) return text;
  if (/^[^/]+\.[^/]+/.test(text) || /^localhost(:\d+)?(\/|$)/i.test(text)) return `https://${text}`;
  return `/${text}`;
}

/**
 * 시작 화면의 주소 칸을 녹화 시작에 쓸 절대 주소로 바꾼다.
 * 비었으면 프로젝트 baseUrl. 경로만 적었으면 baseUrl 의 출처에 붙인다. 만들 수 없으면 null.
 */
export function resolveStartUrl(raw: string, baseUrl: string | null | undefined): string | null {
  const text = raw.trim();
  if (!text) return baseUrl?.trim() || null;
  const normalized = normalizeGotoInput(text);
  if (!normalized) return null;
  if (!normalized.startsWith('/')) return normalized;
  if (!baseUrl) return null;
  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return null;
  }
}

/** 선택 상자(select)인지. 서버가 select 에 fill 을 지원하지 않는다. */
export function isSelectField(inspected: RecorderInspected | null | undefined): boolean {
  return inspected?.tag.toLowerCase() === 'select';
}

export type SpecPathCheck = { ok: true; path: string } | { ok: false; error: string };

const SPEC_FILE = /^.+\.(spec|test)\.(ts|js)$/;
const SPEC_PATH_EXAMPLE = 'tests/recorded/login.spec.ts';

/**
 * 저장 경로를 서버가 받는 규칙대로 미리 검사한다. 고칠 수 있는 것(역슬래시 · 앞의 ./)만 다듬고,
 * 나머지는 임의로 바꾸지 않고 이유를 알려 준다. 서버 규칙:
 *  - 프로젝트 안의 상대 경로 (/ 로 시작 금지, `..` · `//` 금지, 300자 이하)
 *  - .spec.ts · .spec.js · .test.ts · .test.js 로 끝나야 함
 */
export function checkSpecPath(raw: string): SpecPathCheck {
  const path = raw.replaceAll('\\', '/').trim().replace(/^(\.\/)+/, '');
  if (!path) return { ok: false, error: '저장 경로를 적어 주세요.' };
  if (path.startsWith('/') || /^[a-zA-Z]:\//.test(path)) {
    return { ok: false, error: `프로젝트 안의 상대 경로로 적어 주세요. 예: ${SPEC_PATH_EXAMPLE}` };
  }
  if (path.includes('..') || path.includes('//')) {
    return { ok: false, error: '경로에는 ".." 나 "//" 를 쓸 수 없어요.' };
  }
  if (path.length > 300) return { ok: false, error: '경로가 너무 길어요 (300자까지).' };
  if (!SPEC_FILE.test(path)) {
    return { ok: false, error: '파일 이름은 .spec.ts · .spec.js · .test.ts · .test.js 로 끝나야 해요.' };
  }
  return { ok: true, path };
}

// ── 서버 오류 → 안내 문구 ─────────────────────────────

/** 서버가 동시에 열어 줄 수 있는 녹화 수(전체). 서버 상한을 바꾸면 여기도 맞춘다. */
export const RECORDER_TOTAL_LIMIT = 2;

/**
 * 서버 오류를 사람이 읽는 안내로 바꾼다. status · code 가 있으면(ApiError) 그 코드별 문구를,
 * 없으면 서버가 준 메시지를, 그것도 없으면 fallback 을 쓴다.
 */
export function recorderErrorMessage(err: unknown, fallback: string): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    status?: number;
    code?: string;
    message?: string;
  };
  switch (e.code) {
    case 'RECORDER_LIMIT':
      return `지금 녹화 중인 세션이 많아요. 동시에 ${RECORDER_TOTAL_LIMIT}개까지만 녹화할 수 있어요. 다른 녹화가 끝난 뒤 다시 시도해 주세요.`;
    case 'RECORDER_CLOSED':
      return '녹화가 끝났어요. 새로 시작해 주세요.';
    case 'RECORDER_STARTING':
      return '브라우저를 아직 준비하고 있어요. 준비가 끝나면 다시 눌러 주세요.';
    case 'RECORDER_UNAVAILABLE':
      return '이 서버에서는 Docker 를 쓸 수 없어서 녹화를 시작할 수 없어요. 관리자에게 알려 주세요.';
    case 'RECORDER_SESSION_NOT_FOUND':
      return '녹화 기록을 찾을 수 없어요. 새로 시작해 주세요.';
    case 'FILE_EXISTS':
      return '같은 경로에 이미 파일이 있어요. 경로를 바꿔서 다시 저장해 주세요.';
  }
  if (e.status === 502) {
    return `녹화 브라우저와 통신하지 못했어요. 잠시 뒤 다시 시도해 주세요.${e.message ? ` (${e.message})` : ''}`;
  }
  return e.message || fallback;
}
