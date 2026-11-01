import { ApiError, type RecorderApi } from '@/api/client';
import type { RecordedStep, RecorderInspected, RecorderState } from '@/types';

/**
 * 개발용 가짜 녹화 서버. 서버 없이 화면만 보고 싶을 때 쓴다.
 * 개발 서버에서 주소 끝에 `?recorderMock=1` 을 붙이면 켜진다. (운영 빌드에는 들어가지 않는다)
 *
 * 가짜 사이트는 캔버스에 그린 두 화면이다: /login (이메일 · 비밀번호 · 로그인 버튼) → /dashboard.
 */

const BASE = 'https://demo.example.com';
const VIEWPORT = { width: 1280, height: 800 };
const FAKE_DELAY_MS = 350;
const FAKE_STARTUP_MS = 2500;

type PageKey = 'login' | 'home';
type Kind = 'input' | 'button' | 'link' | 'text';

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
      // 같은 이름이 둘이라 순번(.nth)에 기대야 하는 예 — "순번 의존" 배지를 보기 위한 것
      { key: 'more1', kind: 'link', role: 'link', name: '자세히', text: '자세히', selector: "getByRole('link', { name: '자세히' }).nth(0)", fragile: true, tag: 'a', rect: [440, 580, 60, 24] },
      { key: 'more2', kind: 'link', role: 'link', name: '자세히', text: '자세히', selector: "getByRole('link', { name: '자세히' }).nth(1)", fragile: true, tag: 'a', rect: [780, 580, 60, 24] },
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
  page: PageKey;
  url: string;
  steps: RecordedStep[];
  version: number;
  values: Record<string, string>;
  focus: string | null;
  seq: number;
};

// 모듈 맨 위에서 객체를 만들지 않고 값만 둔다 (운영 빌드에서 통째로 걷어내기 쉽게)
let sessions: Record<string, Session> = {};
let savedPaths: string[] = [];

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function find(sid: string): Session {
  const session = sessions[sid];
  if (!session) throw new ApiError('녹화 세션을 찾을 수 없습니다.', 404);
  return session;
}

function snapshot(session: Session): RecorderState {
  const ready = Date.now() >= session.readyAt;
  return {
    sessionId: session.id,
    status: ready ? 'READY' : 'STARTING',
    url: session.url,
    title: PAGES[session.page].title,
    viewport: VIEWPORT,
    steps: session.steps,
    screenshotVersion: session.version,
    error: null,
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

function requireElement(session: Session, x: number, y: number): MockElement {
  const element = elementAt(session, x, y);
  if (!element) throw new ApiError('그 위치에서 요소를 찾지 못했어요. 다른 곳을 눌러 보세요.', 422);
  return element;
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

const KIND_WORD: Record<Kind, string> = { input: '칸', button: '버튼', link: '링크', text: '글자' };

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
    roundRect(400, 140, 480, 460, 12);
    ctx.fill();
    ctx.strokeStyle = '#cdd1d5';
    ctx.stroke();
  }

  for (const element of PAGES[session.page].elements) {
    const [x, y, w, h] = element.rect;
    ctx.textBaseline = 'middle';
    if (element.kind === 'input') {
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
        ctx.fillStyle = '#9aa3ac';
        ctx.fillText(element.name, x + 14, y + h / 2);
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
    const id = `mock-${Math.random().toString(36).slice(2, 8)}`;
    const startPath = body.url?.includes('/dashboard') ? 'home' : 'login';
    const session: Session = {
      id,
      readyAt: Date.now() + FAKE_STARTUP_MS,
      page: startPath,
      url: `${BASE}${PAGES[startPath].path}`,
      steps: [],
      version: 1,
      values: {},
      focus: null,
      seq: 0,
    };
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
    return drawScreen(find(sid));
  },

  async act(_projectId, sid, action) {
    const session = find(sid);
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
      return { ...snapshot(session), inspected };
    }

    await wait(FAKE_DELAY_MS);
    switch (action.type) {
      case 'scroll':
        break;
      case 'goto': {
        let path = action.url;
        try {
          path = new URL(action.url, BASE).pathname;
        } catch {
          // 주소 모양이 아니면 받은 글을 경로로 본다
        }
        go(session, path === PAGES.home.path ? 'home' : 'login');
        record(session, { action: 'goto', selector: null, label: `'${path}' 페이지로 이동`, value: path });
        session.version += 1;
        break;
      }
      case 'click': {
        const element = requireElement(session, action.x, action.y);
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
        const element = requireElement(session, action.x, action.y);
        if (element.kind !== 'input') throw new ApiError('글자를 넣을 수 있는 칸이 아니에요.', 422);
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
        record(session, { action: 'press', selector: null, label: `${action.key} 키 누르기`, value: action.key });
        session.version += 1;
        break;
      case 'assertVisible': {
        const element = requireElement(session, action.x, action.y);
        record(session, {
          action: 'assertVisible',
          selector: element.selector,
          fragile: element.fragile,
          label: `'${element.name}' ${KIND_WORD[element.kind]}이(가) 보이는지 확인`,
        });
        break;
      }
      case 'assertText': {
        const element = requireElement(session, action.x, action.y);
        if (!element.text) throw new ApiError('확인할 글자가 없는 곳이에요.', 422);
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
    return snapshot(session);
  },

  async putSteps(_projectId, sid, steps) {
    await wait(120);
    const session = find(sid);
    session.steps = steps;
    return snapshot(session);
  },

  async code(_projectId, sid, title) {
    await wait(120);
    const session = find(sid);
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
    find(sid);
    if (savedPaths.includes(body.specPath)) {
      throw new ApiError('같은 경로에 이미 파일이 있습니다.', 409);
    }
    savedPaths = [...savedPaths, body.specPath];
    return { specPath: body.specPath };
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
