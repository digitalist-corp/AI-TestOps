import { ApiError, type RecorderApi } from '@/api/client';
import type { RecordedStep, RecorderInspected, RecorderState } from '@/types';

/**
 * 개발용 가짜 녹화 서버. 서버 없이 화면만 보고 싶을 때 쓴다.
 * 개발 서버에서 주소 끝에 `?recorderMock=1` 을 붙이면 켜진다. (운영 빌드에는 들어가지 않는다)
 *
 * 가짜 사이트는 캔버스에 그린 두 화면이다: /login (이메일 · 비밀번호 · 선택 상자 · 로그인 버튼) → /dashboard.
 * 실제 서버(RecorderService)와 같게 움직인다:
 *  - 동작이 실패하면 HTTP 200 + state.error 로 돌려주고 단계는 붙이지 않는다. 다음 동작이 성공하면 error 가 비워진다.
 *  - 준비가 끝나면 첫 goto 단계가 자동으로 붙는다.
 *  - 유휴 10분이면 CLOSED. 끝난 세션도 단계 · 코드 · 저장은 되고 동작 · 스크린샷은 409 RECORDER_CLOSED.
 *    끝난 지 30분이 지나면 404. 같은 사용자가 새로 시작하면 이전 세션은 닫힌다.
 *  - PUT steps 는 label · value(비밀번호 단계 제외)만 반영하고, 모르는 id · 중복 id 는 400.
 *  - 저장 경로는 .spec.ts|.spec.js|.test.ts|.test.js 로 끝나야 하고, 같은 경로는 409 FILE_EXISTS.
 *  - 선택 상자(select)에 fill 하면 단계 없이 오류.
 *
 * 개발 중에 오류 화면을 보려는 스위치:
 *  - 주소에 `&recorderMockIdle=20` → 유휴 종료를 20초로 줄인다 (닫힘 안내 확인)
 *  - 시작 주소에 `limit` 이 들어 있으면 409 RECORDER_LIMIT, `unavailable` 이면 503 RECORDER_UNAVAILABLE
 */

const BASE = 'https://demo.example.com';
const VIEWPORT = { width: 1280, height: 800 };
const FAKE_DELAY_MS = 350;
const FAKE_STARTUP_MS = 2500;
const IDLE_MS = 10 * 60 * 1000;
const KEEP_CLOSED_MS = 30 * 60 * 1000;
const MAX_VALUE_LENGTH = 10_000;
const IDLE_REASON = '10분 동안 동작이 없어 녹화를 멈췄습니다. 기록한 단계는 아직 저장할 수 있습니다.';
const REPLACED_REASON = '새 녹화를 시작해 이전 녹화를 닫았습니다.';
const VALUE_EDITABLE = ['fill', 'press', 'assertText', 'goto'];
const SPEC_FILE = /^.+\.(spec|test)\.(ts|js)$/;

type PageKey = 'login' | 'home';
type Kind = 'input' | 'select' | 'button' | 'link' | 'text';

type MockElement = {
  key: string;
  kind: Kind;
  role: string | null;
  name: string;
  /** 화면에 보이는 글자 (입력란은 비어 있음) */
  text: string;
  selector: string;
  fragile: boolean;
  tag: string;
  rect: [number, number, number, number];
};

const PAGES: Record<PageKey, { path: string; title: string; elements: MockElement[] }> = {
  login: {
    path: '/login',
    title: '로그인',
    elements: [
      { key: 'h1', kind: 'text', role: 'heading', name: '로그인', text: '로그인', selector: "getByRole('heading', { name: '로그인' })", fragile: false, tag: 'h1', rect: [440, 180, 400, 48] },
      { key: 'email', kind: 'input', role: 'textbox', name: '이메일', text: '', selector: "getByLabel('이메일')", fragile: false, tag: 'input', rect: [440, 280, 400, 44] },
      { key: 'password', kind: 'input', role: null, name: '비밀번호', text: '', selector: "getByLabel('비밀번호')", fragile: false, tag: 'input', rect: [440, 360, 400, 44] },
      { key: 'submit', kind: 'button', role: 'button', name: '로그인', text: '로그인', selector: "getByRole('button', { name: '로그인' })", fragile: false, tag: 'button', rect: [440, 440, 400, 48] },
      { key: 'find', kind: 'link', role: 'link', name: '비밀번호 찾기', text: '비밀번호 찾기', selector: "getByRole('link', { name: '비밀번호 찾기' })", fragile: false, tag: 'a', rect: [440, 510, 130, 24] },
      // 선택 상자: 서버가 fill 을 지원하지 않는다 ("입력할 수 없어요" 안내를 보기 위한 것)
      { key: 'lang', kind: 'select', role: 'combobox', name: '언어', text: '', selector: "getByLabel('언어')", fragile: false, tag: 'select', rect: [440, 550, 200, 36] },
      // 같은 이름이 둘이라 순번(.nth)에 기대야 하는 예 — "순번 의존" 배지를 보기 위한 것
      { key: 'more1', kind: 'link', role: 'link', name: '자세히', text: '자세히', selector: "getByRole('link', { name: '자세히' }).nth(0)", fragile: true, tag: 'a', rect: [440, 610, 60, 24] },
      { key: 'more2', kind: 'link', role: 'link', name: '자세히', text: '자세히', selector: "getByRole('link', { name: '자세히' }).nth(1)", fragile: true, tag: 'a', rect: [780, 610, 60, 24] },
    ],
  },
  home: {
    path: '/dashboard',
    title: '대시보드',
    elements: [
      { key: 'welcome', kind: 'text', role: 'heading', name: '환영합니다', text: '환영합니다', selector: "getByRole('heading', { name: '환영합니다' })", fragile: false, tag: 'h1', rect: [80, 140, 420, 52] },
      { key: 'last', kind: 'text', role: null, name: '마지막 접속: 오늘', text: '마지막 접속: 오늘', selector: "getByText('마지막 접속: 오늘')", fragile: false, tag: 'p', rect: [80, 210, 300, 28] },
      { key: 'logout', kind: 'button', role: 'button', name: '로그아웃', text: '로그아웃', selector: "getByRole('button', { name: '로그아웃' })", fragile: false, tag: 'button', rect: [1100, 30, 140, 40] },
    ],
  },
};

type Session = {
  id: string;
  readyAt: number;
  /** 준비가 끝나 첫 goto 단계를 붙였는지 */
  booted: boolean;
  /** 시작할 때 요청한 경로 (첫 goto 단계에 쓴다) */
  startPath: string;
  page: PageKey;
  url: string;
  steps: RecordedStep[];
  version: number;
  values: Record<string, string>;
  focus: string | null;
  seq: number;
  idleMs: number;
  lastActivity: number;
  closedAt: number | null;
  closedReason: string | null;
  /** 가장 최근 동작의 실패 이유. 다음 동작이 성공하면 비운다. */
  lastError: string | null;
};

// 모듈 맨 위에서 객체를 만들지 않고 값만 둔다 (운영 빌드에서 통째로 걷어내기 쉽게)
let sessions: Record<string, Session> = {};
let savedPaths: string[] = [];

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function notFound(): ApiError {
  return new ApiError('녹화 세션을 찾을 수 없습니다.', 404, 'RECORDER_SESSION_NOT_FOUND');
}

function closeSession(session: Session, reason: string | null) {
  if (session.closedAt != null) return;
  session.closedAt = Date.now();
  session.closedReason = reason;
}

/** 세션을 찾고, 유휴 시간이 지났으면 닫고, 끝난 지 오래됐으면 서버처럼 잊는다(404). */
function find(sid: string): Session {
  const session = sessions[sid];
  if (!session) throw notFound();
  const now = Date.now();
  if (session.closedAt == null && now - session.lastActivity > session.idleMs) {
    closeSession(session, IDLE_REASON);
  }
  if (session.closedAt != null && now - session.closedAt > KEEP_CLOSED_MS) {
    const { [sid]: _forgotten, ...rest } = sessions;
    sessions = rest;
    throw notFound();
  }
  return session;
}

function touch(session: Session) {
  session.lastActivity = Date.now();
}

function isReady(session: Session): boolean {
  return Date.now() >= session.readyAt;
}

/** 동작 · 스크린샷은 끝났거나 준비 중이면 409. (코드 · 저장 · 단계 수정은 이 검사를 거치지 않는다) */
function requireReady(session: Session) {
  if (session.closedAt != null) {
    throw new ApiError('녹화 세션이 끝났습니다. 새로 시작하세요.', 409, 'RECORDER_CLOSED');
  }
  if (!isReady(session)) {
    throw new ApiError('녹화를 준비하는 중입니다.', 409, 'RECORDER_STARTING');
  }
}

function snapshot(session: Session): RecorderState {
  const closed = session.closedAt != null;
  const ready = isReady(session);
  // 준비가 끝나는 순간 첫 goto 단계가 자동으로 붙는다 (서버: 리다이렉트된 주소가 아니라 요청한 시작 주소)
  if (!closed && ready && !session.booted) {
    session.booted = true;
    record(session, {
      action: 'goto',
      selector: null,
      label: `'${session.startPath}' 페이지로 이동`,
      value: session.startPath,
    });
  }
  return {
    sessionId: session.id,
    status: closed ? 'CLOSED' : ready ? 'READY' : 'STARTING',
    url: session.url,
    title: PAGES[session.page].title,
    viewport: VIEWPORT,
    steps: session.steps,
    screenshotVersion: session.version,
    error: closed ? session.closedReason : session.lastError,
  };
}

function elementAt(session: Session, x: number, y: number): MockElement | null {
  const elements = PAGES[session.page].elements;
  for (let i = elements.length - 1; i >= 0; i--) {
    const [ex, ey, w, h] = elements[i].rect;
    if (x >= ex && x <= ex + w && y >= ey && y <= ey + h) return elements[i];
  }
  return null;
}

const NO_ELEMENT = '그 위치에서 요소를 찾지 못했습니다. 다른 곳을 눌러 보세요.';

/** 서버가 만든 단계에 화면이 보낸 label · value 만 합친다 (selector · action · fragile 은 서버 값 유지). */
function mergeSteps(current: RecordedStep[], incoming: RecordedStep[]): RecordedStep[] {
  const byId: Record<string, RecordedStep> = {};
  for (const step of current) byId[step.id] = step;
  const seen: string[] = [];
  return incoming.map((step) => {
    const base = byId[step.id];
    if (!base) throw new ApiError(`모르는 단계입니다: ${step.id}`, 400, 'VALIDATION_ERROR');
    if (seen.includes(base.id)) throw new ApiError(`같은 단계가 두 번 들어 있습니다: ${base.id}`, 400, 'VALIDATION_ERROR');
    seen.push(base.id);
    const label = step.label?.trim() ? step.label.trim().slice(0, 200) : base.label;
    const editable = !base.secretEnv && VALUE_EDITABLE.includes(base.action);
    const value = editable && step.value != null ? step.value.slice(0, MAX_VALUE_LENGTH) : base.value;
    return { ...base, label, ...(value !== undefined ? { value } : {}) };
  });
}

function validateSpecPath(raw: string | undefined): string {
  if (!raw?.trim()) throw new ApiError('저장할 경로가 필요합니다.', 400, 'PATH_NOT_ALLOWED');
  const path = raw.replaceAll('\\', '/').trim();
  if (path.startsWith('/') || path.includes('..') || path.includes('//') || path.length > 300) {
    throw new ApiError(`저장할 수 없는 경로입니다: ${raw}`, 400, 'PATH_NOT_ALLOWED');
  }
  if (!SPEC_FILE.test(path)) {
    throw new ApiError(`테스트 파일 이름은 .spec.ts 처럼 끝나야 합니다: ${raw}`, 400, 'PATH_NOT_ALLOWED');
  }
  return path;
}

function record(session: Session, step: Omit<RecordedStep, 'id' | 'url' | 'fragile'> & { fragile?: boolean }) {
  session.seq += 1;
  session.steps = [
    ...session.steps,
    { fragile: false, ...step, id: `m${session.seq}`, url: session.url },
  ];
}

function go(session: Session, page: PageKey) {
  session.page = page;
  session.url = `${BASE}${PAGES[page].path}`;
  session.focus = null;
}

function submitLogin(session: Session) {
  if (session.page === 'login') go(session, 'home');
}

const KIND_WORD: Record<Kind, string> = { input: '칸', select: '선택 상자', button: '버튼', link: '링크', text: '글자' };

// ── 화면 그리기 ───────────────────────────────────────

function drawScreen(session: Session): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = VIEWPORT.width;
  canvas.height = VIEWPORT.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('캔버스를 만들 수 없습니다.'));

  const font = (size: number, weight = 400) =>
    `${weight} ${size}px Pretendard, 'Malgun Gothic', sans-serif`;
  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  ctx.fillStyle = session.page === 'login' ? '#f4f5f6' : '#ffffff';
  ctx.fillRect(0, 0, VIEWPORT.width, VIEWPORT.height);

  if (session.page === 'home') {
    ctx.fillStyle = '#256ef4';
    ctx.fillRect(0, 0, VIEWPORT.width, 100);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(24, 700);
    ctx.textBaseline = 'middle';
    ctx.fillText('데모 사이트', 80, 50);
  } else {
    ctx.fillStyle = '#ffffff';
    roundRect(400, 140, 480, 520, 12);
    ctx.fill();
    ctx.strokeStyle = '#cdd1d5';
    ctx.stroke();
  }

  for (const element of PAGES[session.page].elements) {
    const [x, y, w, h] = element.rect;
    ctx.textBaseline = 'middle';
    if (element.kind === 'input' || element.kind === 'select') {
      ctx.fillStyle = '#ffffff';
      roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.strokeStyle = session.focus === element.key ? '#256ef4' : '#8a949e';
      ctx.lineWidth = session.focus === element.key ? 2 : 1;
      ctx.stroke();
      ctx.lineWidth = 1;
      const typed = session.values[element.key] ?? '';
      ctx.font = font(16);
      if (typed) {
        ctx.fillStyle = '#131416';
        ctx.fillText(element.key === 'password' ? '●'.repeat(typed.length) : typed, x + 14, y + h / 2);
      } else {
        ctx.fillStyle = element.kind === 'select' ? '#131416' : '#9aa3ac';
        ctx.fillText(element.name, x + 14, y + h / 2);
      }
      if (element.kind === 'select') {
        ctx.fillStyle = '#6d7882';
        ctx.fillText('▾', x + w - 24, y + h / 2);
      }
    } else if (element.kind === 'button') {
      ctx.fillStyle = element.key === 'logout' ? '#ffffff' : '#256ef4';
      roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.fillStyle = element.key === 'logout' ? '#256ef4' : '#ffffff';
      ctx.font = font(17, 700);
      ctx.textAlign = 'center';
      ctx.fillText(element.text, x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
    } else if (element.kind === 'link') {
      ctx.fillStyle = '#256ef4';
      ctx.font = font(15);
      ctx.fillText(element.text, x, y + h / 2);
      const width = ctx.measureText(element.text).width;
      ctx.fillRect(x, y + h - 4, width, 1);
    } else {
      ctx.fillStyle = '#131416';
      ctx.font = font(element.role === 'heading' ? 32 : 16, element.role === 'heading' ? 700 : 400);
      ctx.fillText(element.text, x, y + h / 2);
    }
  }

  ctx.fillStyle = '#9aa3ac';
  ctx.font = font(13);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('개발용 가짜 응답 — 실제 사이트가 아닙니다', 24, VIEWPORT.height - 20);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('화면을 만들 수 없습니다.'))), 'image/jpeg', 0.9)
  );
}

// ── 코드 만들기 ───────────────────────────────────────

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function stepToCode(step: RecordedStep): string {
  const target = step.selector ? `page.${step.selector}` : 'page';
  const note = step.fragile ? ' // 순번 의존 — 화면이 바뀌면 깨질 수 있음' : '';
  switch (step.action) {
    case 'goto':
      return `  await page.goto(${quote(step.value ?? '/')});`;
    case 'click':
      return `  await ${target}.click();${note}`;
    case 'fill': {
      const value = step.secretEnv ? `process.env.${step.secretEnv} ?? ''` : quote(step.value ?? '');
      return `  await ${target}.fill(${value});${note}`;
    }
    case 'press':
      return `  await page.keyboard.press(${quote(step.value ?? 'Enter')});`;
    case 'assertVisible':
      return `  await expect(${target}).toBeVisible();${note}`;
    case 'assertText':
      return `  await expect(${target}).toHaveText(${quote(step.value ?? '')});${note}`;
  }
}

function suggestPath(title: string | undefined): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return `tests/recorded/${slug}.spec.ts`;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `tests/recorded/recorded-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.spec.ts`;
}

// ── 가짜 API ──────────────────────────────────────────

export const recorderMockApi: RecorderApi = {
  async start(_projectId, body) {
    await wait(FAKE_DELAY_MS);
    if (body.url?.includes('unavailable')) {
      throw new ApiError('Docker 를 쓸 수 없는 환경이라 녹화를 시작할 수 없습니다.', 503, 'RECORDER_UNAVAILABLE');
    }
    if (body.url?.includes('limit')) {
      throw new ApiError('지금 녹화 중인 세션이 많습니다(전체 2개). 잠시 뒤 다시 시도하세요.', 409, 'RECORDER_LIMIT');
    }

    // 사용자당 1개: 새로 시작하면 이전 녹화는 닫는다.
    for (const previous of Object.values(sessions)) closeSession(previous, REPLACED_REASON);

    let startPath = PAGES.login.path;
    try {
      if (body.url) startPath = new URL(body.url, BASE).pathname;
    } catch {
      // 주소 모양이 아니면 로그인 화면에서 시작한다
    }

    const idleParam = Number(new URLSearchParams(window.location.search).get('recorderMockIdle'));
    const now = Date.now();
    const id = `mock-${Math.random().toString(36).slice(2, 8)}`;
    const session: Session = {
      id,
      readyAt: now + FAKE_STARTUP_MS,
      booted: false,
      startPath,
      page: startPath === PAGES.home.path ? 'home' : 'login',
      url: '',
      steps: [],
      version: 1,
      values: {},
      focus: null,
      seq: 0,
      idleMs: idleParam > 0 ? idleParam * 1000 : IDLE_MS,
      lastActivity: now,
      closedAt: null,
      closedReason: null,
      lastError: null,
    };
    go(session, session.page);
    // 로그인한 상태로 시작이면 바로 대시보드에서 시작한다.
    if (body.useLogin) go(session, 'home');
    sessions = { ...sessions, [id]: session };
    return snapshot(session);
  },

  async get(_projectId, sid) {
    await wait(120);
    return snapshot(find(sid));
  },

  async screenshot(_projectId, sid) {
    const session = find(sid);
    requireReady(session);
    return drawScreen(session);
  },

  async act(_projectId, sid, action) {
    const session = find(sid);
    requireReady(session);
    touch(session);

    if (action.type === 'inspect') {
      const element = elementAt(session, action.x, action.y);
      const inspected: RecorderInspected | null = element
        ? {
            role: element.role,
            name: element.name,
            selector: element.selector,
            fragile: element.fragile,
            tag: element.tag,
            box: { x: element.rect[0], y: element.rect[1], width: element.rect[2], height: element.rect[3] },
          }
        : null;
      session.lastError = null;
      return { ...snapshot(session), inspected };
    }

    await wait(FAKE_DELAY_MS);
    // 동작이 실패하면 HTTP 200 + error 로 돌려주고 단계는 붙이지 않는다.
    const fail = (message: string): RecorderState => {
      session.lastError = message;
      return snapshot(session);
    };

    switch (action.type) {
      case 'scroll':
        break;
      case 'goto': {
        let path = action.url;
        try {
          const target = new URL(action.url, BASE);
          if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            return fail('http(s) 주소만 열 수 있습니다');
          }
          path = target.pathname;
        } catch {
          return fail('주소를 열 수 없습니다');
        }
        go(session, path === PAGES.home.path ? 'home' : 'login');
        record(session, { action: 'goto', selector: null, label: `'${path}' 페이지로 이동`, value: path });
        session.version += 1;
        break;
      }
      case 'click': {
        const element = elementAt(session, action.x, action.y);
        if (!element) return fail(NO_ELEMENT);
        session.focus = element.kind === 'input' ? element.key : null;
        if (element.key === 'submit') submitLogin(session);
        if (element.key === 'logout') go(session, 'login');
        record(session, {
          action: 'click',
          selector: element.selector,
          fragile: element.fragile,
          label: `'${element.name}' ${KIND_WORD[element.kind]} 클릭`,
        });
        session.version += 1;
        break;
      }
      case 'fill': {
        const element = elementAt(session, action.x, action.y);
        if (!element) return fail(NO_ELEMENT);
        if (element.kind === 'select') return fail('선택 상자(select)에는 값을 입력할 수 없습니다');
        if (element.kind !== 'input') return fail('그 위치는 입력란이 아닙니다');
        const secret = element.key === 'password';
        session.values = { ...session.values, [element.key]: action.value };
        session.focus = element.key;
        record(session, {
          action: 'fill',
          selector: element.selector,
          label: `'${element.name}' 칸에 입력`,
          ...(secret ? { secretEnv: 'LOGIN_PASSWORD' } : { value: action.value }),
        });
        session.version += 1;
        break;
      }
      case 'press':
        if (action.key === 'Enter' && session.focus) submitLogin(session);
        // 키 입력은 셀렉터 없이 기록한다 (생성 코드: page.keyboard.press)
        record(session, { action: 'press', selector: null, label: `${action.key} 키 누르기`, value: action.key });
        session.version += 1;
        break;
      case 'assertVisible': {
        const element = elementAt(session, action.x, action.y);
        if (!element) return fail(NO_ELEMENT);
        record(session, {
          action: 'assertVisible',
          selector: element.selector,
          fragile: element.fragile,
          label: `'${element.name}' ${KIND_WORD[element.kind]}이(가) 보이는지 확인`,
        });
        break;
      }
      case 'assertText': {
        const element = elementAt(session, action.x, action.y);
        if (!element) return fail(NO_ELEMENT);
        if (!element.text) return fail('확인할 글자가 없는 곳입니다');
        record(session, {
          action: 'assertText',
          selector: element.selector,
          fragile: element.fragile,
          label: `'${element.name}' 글자가 '${element.text}' 인지 확인`,
          value: element.text,
        });
        break;
      }
    }
    session.lastError = null;
    return snapshot(session);
  },

  async putSteps(_projectId, sid, steps) {
    await wait(120);
    const session = find(sid);
    touch(session);
    session.steps = mergeSteps(session.steps, steps);
    return snapshot(session);
  },

  async code(_projectId, sid, title) {
    await wait(120);
    const session = find(sid);
    touch(session);
    const lines = [
      "import { test, expect } from '@playwright/test';",
      '',
      `test(${quote(title?.trim() || '녹화한 테스트')}, async ({ page }) => {`,
      ...session.steps.map(stepToCode),
      '});',
      '',
    ];
    return { specPath: suggestPath(title?.trim()), code: lines.join('\n') };
  },

  async save(_projectId, sid, body) {
    await wait(200);
    const session = find(sid);
    touch(session);
    if (session.steps.length === 0) throw new ApiError('기록한 단계가 없습니다.', 400, 'VALIDATION_ERROR');
    const specPath = validateSpecPath(body.specPath);
    if (savedPaths.includes(specPath)) {
      throw new ApiError(`같은 경로에 파일이 이미 있습니다: ${specPath}`, 409, 'FILE_EXISTS');
    }
    savedPaths = [...savedPaths, specPath];
    return { specPath };
  },

  async close(_projectId, sid) {
    await wait(120);
    const { [sid]: _removed, ...rest } = sessions;
    sessions = rest;
  },

  closeOnLeave(_projectId, sid) {
    const { [sid]: _removed, ...rest } = sessions;
    sessions = rest;
  },
};
