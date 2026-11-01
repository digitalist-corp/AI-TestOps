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
  { id: 'fill', label: '입력', hint: '값을 넣을 입력칸을 클릭하세요. 작은 창에서 값을 받아요.' },
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

/** 단계 설명(label)을 바꾼다. 비었거나 그대로면 같은 배열을 돌려줘서 서버 호출을 건너뛸 수 있다. */
export function renameStep(steps: RecordedStep[], id: string, label: string): RecordedStep[] {
  const trimmed = label.trim();
  const target = steps.find((step) => step.id === id);
  if (!target || !trimmed || target.label === trimmed) return steps;
  return steps.map((step) => (step.id === id ? { ...step, label: trimmed } : step));
}

/** 저장 뒤에 단계가 바뀌었는지 비교하려고 쓰는 짧은 지문. 순서 · 설명이 바뀌어도 달라진다. */
export function stepsSignature(steps: RecordedStep[]): string {
  return steps.map((step) => `${step.id}\u0001${step.label}`).join('\u0002');
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

/** 서버가 아직 준비 중이거나 동작 중이라 조금 뒤에 다시 물어봐야 하는 상태 */
export function needsPolling(status: RecorderStatus): boolean {
  return status === 'STARTING' || status === 'BUSY';
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

/**
 * 저장 경로를 다듬는다: 역슬래시 → 슬래시, 앞의 `./` · `/` 제거, `.spec.ts` 가 없으면 붙인다.
 * 비었거나 `..` 로 바깥을 가리키면 null.
 */
export function normalizeSpecPath(raw: string): string | null {
  let path = raw.trim().replaceAll('\\', '/');
  path = path.replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!path || path.endsWith('/')) return null;
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  if (!/\.(spec|test)\.(ts|js)$/.test(path)) {
    path = `${path.replace(/\.(ts|js)$/, '')}.spec.ts`;
  }
  return path;
}
