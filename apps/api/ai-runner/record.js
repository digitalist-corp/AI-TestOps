// AI-TestOps AI Runner — 녹화 (클릭으로 테스트 만들기)
//
// 사람이 화면(스크린샷)에서 클릭 · 입력한 위치를 받아 Playwright 로 실제로 수행하고, 그 요소를
// "정확히 하나만 가리키는" 셀렉터로 기록한다. AI 를 쓰지 않는다. 계약: docs/design/recorder-contract.md
//
// api 가 세션마다 이 스크립트로 컨테이너 하나를 띄우고(--network container:playops-api),
// 아래 작은 HTTP 서버를 127.0.0.1:<RECORDER_PORT> 로 부른다. 테스트 코드 생성은 api(Java)가 한다.
//
// 환경변수
//   RECORDER_PORT           HTTP 포트 (필수)
//   RECORDER_START_URL      처음 열 주소 (필수)
//   RECORDER_BASE_URL       프로젝트 baseUrl — 상대 경로 이동과 "같은 출처면 경로만 기록"에 쓴다 (선택)
//   RECORDER_STORAGE_STATE  로그인 세션(storageState) 파일 경로 (선택)
//   RECORDER_TOKEN          요청마다 X-Recorder-Token 헤더로 맞춰 본다 (선택 — 비어 있으면 검사 안 함)
//   RECORDER_HOST           듣는 주소 (기본 127.0.0.1 — 로컬 시험 때만 0.0.0.0)
//   RECORDER_IDLE_EXIT_MS   이 시간 동안 요청이 하나도 없으면 스스로 끝낸다 (기본 15분, api 가 죽었을 때 대비)
//
// 내부 엔드포인트
//   GET  /state       현재 상태 (RecorderState 에서 sessionId 를 뺀 모양)
//   GET  /screenshot  현재 화면 jpeg
//   POST /action      RecorderAction 을 수행하고 상태를 돌려준다. 실패하면 기록 없이 state.error 에 이유
//   PUT  /steps       { steps } 로 기록 목록을 바꾼다 (api 가 검증 · 병합한 목록)
//   POST /shutdown    브라우저를 닫고 끝낸다
'use strict';

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const sel = require('./selectors');

const PORT = Number(process.env.RECORDER_PORT || 0);
const HOST = process.env.RECORDER_HOST || '127.0.0.1';
const START_URL = process.env.RECORDER_START_URL || '';
const BASE_URL = process.env.RECORDER_BASE_URL || '';
const STORAGE_STATE = process.env.RECORDER_STORAGE_STATE || '';
const TOKEN = process.env.RECORDER_TOKEN || '';
const SECRET_ENV = process.env.RECORDER_SECRET_ENV || 'LOGIN_PASSWORD';
const IDLE_EXIT_MS = Number(process.env.RECORDER_IDLE_EXIT_MS || 15 * 60 * 1000);
const VIEWPORT = { width: 1280, height: 800 };
const ACTION_TIMEOUT_MS = 5000;
const NAV_TIMEOUT_MS = 20000;
const MAX_BODY = 1024 * 1024;

const ROLE_WORD = {
  button: '버튼', link: '링크', checkbox: '체크박스', radio: '라디오 버튼', textbox: '입력란',
  searchbox: '검색란', combobox: '선택 상자', listbox: '목록', tab: '탭', menuitem: '메뉴',
  heading: '제목', img: '이미지', switch: '스위치', option: '항목', spinbutton: '숫자 입력란',
};

const state = {
  status: 'STARTING',
  url: null,
  title: null,
  viewport: VIEWPORT,
  steps: [],
  screenshotVersion: 0,
  error: null,
  inspected: null,
};

let browser = null;
let context = null;
let page = null;
let requests = null;
let busy = false;
let lastRequestAt = Date.now();
const popups = [];   // 동작 중에 열린 새 탭 · 팝업의 주소 (Promise<string|null>)

function log(...args) {
  console.log('[record]', ...args);
}

function oneLine(e) {
  return String((e && e.message) || e).split('\n')[0].slice(0, 300);
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

/** 절대 주소 또는 baseUrl(없으면 지금 주소) 기준 경로를 절대 주소로 바꾼다. http(s) 만 허용한다. */
function absoluteUrl(raw) {
  const base = BASE_URL || (page && page.url()) || START_URL;
  const u = new URL(String(raw || '').trim(), base || undefined);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`http(s) 주소만 열 수 있습니다: ${raw}`);
  }
  return u.toString();
}

// ---------------------------------------------------------------- 내부 주소 차단
// 녹화 컨테이너는 api 와 네트워크 공간을 같이 쓰므로, 막지 않으면 사용자가 api 내부 화면(127.0.0.1:8080 등)이나
// DB 같은 내부 서비스를 열어 볼 수 있다. 페이지의 모든 요청(context.route)과 goto 동작을 같은 규칙으로 막는다.
// 단 RECORDER_BASE_URL 의 호스트와 같으면 허용한다 (로컬 개발에서 host.docker.internal · localhost 를 쓰는 경우).
const INTERNAL_MESSAGE = '내부 주소는 열 수 없습니다';
const INTERNAL_NAMES = ['playops-api', 'postgres', 'playops-postgres'];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** loopback(localhost, 127.0.0.0/8, ::1, 0.0.0.0)이거나 api 쪽 컨테이너 이름이면 true. URL 파서가 정규화한 호스트를 받는다. */
function isInternalHost(host) {
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0.0.0.0' || host === '::') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv4 를 담은 IPv6 (::ffff:127.0.0.1 → ::ffff:7f00:1, ::ffff:0.0.0.0 → ::ffff:0:0)
  if (/^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host) || host === '::ffff:0:0') return true;
  return INTERNAL_NAMES.includes(host);
}

function isBlockedUrl(url, baseUrl = BASE_URL) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  const host = hostOf(url);
  const baseHost = baseUrl ? hostOf(baseUrl) : null;
  if (baseHost && host === baseHost) return false;
  return isInternalHost(host);
}

function assertNotInternal(url) {
  if (isBlockedUrl(url)) throw new Error(INTERNAL_MESSAGE);
}

/** baseUrl 과 같은 출처면 경로만 남긴다 (Playwright config 의 baseURL 을 쓰게). */
function toRecordedPath(url) {
  if (!BASE_URL) return url;
  try {
    const u = new URL(url);
    const b = new URL(BASE_URL);
    if (u.origin === b.origin) return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch { /* 그대로 */ }
  return url;
}

function displayName(d) {
  return d.name || d.label || d.placeholder || d.text || d.tag;
}

function short(s, n = 40) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function refreshPageInfo() {
  state.url = page ? page.url() : null;
  state.title = page ? await page.title().catch(() => null) : null;
}

function attachPage(p) {
  page = p;
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  requests = sel.trackRequests(page);
  // alert · confirm 은 수락한다 (막혀 있으면 이후 동작이 모두 멈춘다).
  page.on('dialog', (d) => d.accept().catch(() => {}));
}

async function settle() {
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await sel.waitSettled(page, requests);
}

/** 좌표의 요소를 찾고 셀렉터까지 정한다. 표식은 끝나면 지운다. */
async function locateAt(x, y) {
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('x, y 좌표가 필요합니다');
  if (nx < 0 || ny < 0 || nx >= VIEWPORT.width || ny >= VIEWPORT.height) throw new Error('좌표가 화면 밖입니다');
  const mark = newId();
  const desc = await page.evaluate(sel.describeAtPoint, { x: nx, y: ny, markAttr: sel.MARK_ATTR, markValue: mark });
  if (!desc) throw new Error('그 위치에서 요소를 찾지 못했습니다');
  const res = await sel.resolveSelector(page, desc, mark);
  return { desc, res };
}

async function clearMark() {
  await page.evaluate((attr) => document.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr)), sel.MARK_ATTR)
    .catch(() => {});
}

function pushStep(step) {
  state.steps.push({ id: newId(), ...step, url: page.url() });
}

/** 클릭 등으로 새 탭 · 팝업이 열렸으면 닫고, 같은 탭에서 그 주소로 이동한 뒤 goto 단계로 남긴다. */
async function followPopups() {
  await page.waitForTimeout(300);
  while (popups.length > 0) {
    const url = await popups.shift();
    if (!url || url === 'about:blank') continue;
    if (isBlockedUrl(url)) {
      log('내부 주소 팝업은 따라가지 않습니다', url);
      continue;
    }
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settle();
      pushStep({ action: 'goto', selector: null, fragile: false, label: `${short(toRecordedPath(url), 60)} 열기 (새 탭 대신 같은 탭)`, value: toRecordedPath(url) });
    } catch (e) {
      log('팝업 주소 이동 실패', url, oneLine(e));
    }
  }
}

const actions = {
  async click(a) {
    const { desc, res } = await locateAt(a.x, a.y);
    if (!res.locator) throw new Error('이 요소를 가리킬 셀렉터를 만들지 못했습니다');
    await res.locator.click({ timeout: ACTION_TIMEOUT_MS });
    await clearMark();
    await settle();
    const word = ROLE_WORD[desc.role] || '요소';
    pushStep({ action: 'click', selector: res.selector, fragile: res.fragile, label: `'${short(displayName(desc))}' ${word} 클릭` });
    await followPopups();
    return true;
  },

  async fill(a) {
    if (typeof a.value !== 'string') throw new Error('value(입력할 값)가 필요합니다');
    const { desc, res } = await locateAt(a.x, a.y);
    if (!desc.fillable) {
      await clearMark();
      throw new Error(desc.tag === 'select' ? '선택 상자는 아직 지원하지 않습니다' : '그 위치는 입력란이 아닙니다');
    }
    if (!res.locator) throw new Error('이 입력란을 가리킬 셀렉터를 만들지 못했습니다');
    await res.locator.fill(a.value, { timeout: ACTION_TIMEOUT_MS });
    await clearMark();
    await settle();
    const name = short(displayName(desc));
    const step = { action: 'fill', selector: res.selector, fragile: res.fragile };
    if (desc.password) {
      // 비밀번호는 값을 남기지 않는다 — 생성 코드는 환경변수에서 읽는다.
      step.label = `'${name}' 비밀번호 입력 (값은 ${SECRET_ENV} 환경변수)`;
      step.secretEnv = SECRET_ENV;
    } else if (desc.loginId) {
      step.label = `'${name}' 로그인 아이디 입력: ${short(a.value)}`;
      step.value = a.value;
    } else {
      step.label = `'${name}' 칸에 '${short(a.value)}' 입력`;
      step.value = a.value;
    }
    pushStep(step);
    return true;
  },

  async press(a) {
    const key = String(a.key || '').trim();
    if (!key || key.length > 40) throw new Error('key(누를 키)가 필요합니다');
    await page.keyboard.press(key);
    await settle();
    pushStep({ action: 'press', selector: null, fragile: false, label: `${key} 키 누름`, value: key });
    await followPopups();
    return true;
  },

  async goto(a) {
    const url = absoluteUrl(a.url);
    assertNotInternal(url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await settle();
    const recorded = toRecordedPath(url);
    pushStep({ action: 'goto', selector: null, fragile: false, label: `${short(recorded, 60)} 열기`, value: recorded });
    return true;
  },

  async assertVisible(a) {
    const { desc, res } = await locateAt(a.x, a.y);
    await clearMark();
    if (!res.selector) throw new Error('이 요소를 가리킬 셀렉터를 만들지 못했습니다');
    pushStep({ action: 'assertVisible', selector: res.selector, fragile: res.fragile, label: `'${short(displayName(desc))}' 보이는지 확인` });
    return false;
  },

  async assertText(a) {
    const { desc, res } = await locateAt(a.x, a.y);
    await clearMark();
    if (!res.selector) throw new Error('이 요소를 가리킬 셀렉터를 만들지 못했습니다');
    const text = desc.fullText;
    if (!text) throw new Error('그 요소에는 글자가 없습니다');
    pushStep({ action: 'assertText', selector: res.selector, fragile: res.fragile, label: `'${short(displayName(desc), 20)}' 글자가 '${short(text)}' 인지 확인`, value: text });
    return false;
  },

  async scroll(a) {
    const dy = Number(a.deltaY);
    if (!Number.isFinite(dy)) throw new Error('deltaY 가 필요합니다');
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.mouse.wheel(0, Math.max(-5000, Math.min(5000, dy)));
    await page.waitForTimeout(300);
    return true;
  },

  async inspect(a) {
    const { desc, res } = await locateAt(a.x, a.y);
    await clearMark();
    state.inspected = {
      role: desc.role, name: desc.name || null, selector: res.selector, fragile: res.fragile, tag: desc.tag, box: desc.box,
    };
    return false;
  },
};

async function runAction(a) {
  const fn = a && typeof a.type === 'string' && Object.prototype.hasOwnProperty.call(actions, a.type) ? actions[a.type] : null;
  if (!fn) return { status: 400, body: { error: `알 수 없는 동작입니다: ${a && a.type}` } };
  // 처음 화면을 못 연 경우(ERROR)에도 브라우저가 떠 있으면 주소 이동으로 다시 시작할 수 있다.
  const recoverable = state.status === 'ERROR' && page && a.type === 'goto';
  if (state.status !== 'READY' && !recoverable) return { status: 409, body: { error: `지금은 동작할 수 없습니다 (상태 ${state.status})` } };
  if (busy) return { status: 409, body: { error: '이전 동작을 처리하는 중입니다' } };
  busy = true;
  state.status = 'BUSY';
  if (a.type !== 'inspect') state.inspected = null;
  try {
    const changed = await fn(a);
    state.error = null;
    if (changed) state.screenshotVersion += 1;
  } catch (e) {
    await clearMark();
    state.error = oneLine(e);
    // 실패한 동작도 화면을 바꿨을 수 있다 (예: 클릭 뒤 settle 실패).
    state.screenshotVersion += 1;
    log('동작 실패', a.type, state.error);
  } finally {
    await refreshPageInfo();
    state.status = 'READY';
    busy = false;
  }
  return { status: 200, body: state };
}

function validSteps(steps) {
  const allowed = ['goto', 'click', 'fill', 'press', 'assertVisible', 'assertText'];
  return Array.isArray(steps) && steps.length <= 500
    && steps.every((s) => s && typeof s.id === 'string' && allowed.includes(s.action));
}

// ---------------------------------------------------------------- HTTP

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined ? '' : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': payload.length, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('요청 본문이 너무 큽니다')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('JSON 형식이 아닙니다')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  lastRequestAt = Date.now();
  if (TOKEN && req.headers['x-recorder-token'] !== TOKEN) return send(res, 401, { error: 'unauthorized' });
  const path = (req.url || '/').split('?')[0];
  const key = `${req.method} ${path}`;
  try {
    switch (key) {
      case 'GET /state':
        return send(res, 200, state);
      case 'GET /screenshot': {
        if (!page) return send(res, 503, { error: '아직 화면이 없습니다' });
        const shot = await page.screenshot({ type: 'jpeg', quality: 70, timeout: 10000 });
        return send(res, 200, shot, 'image/jpeg');
      }
      case 'POST /action': {
        const body = await readJson(req);
        const r = await runAction(body);
        return send(res, r.status, r.body);
      }
      case 'PUT /steps': {
        const body = await readJson(req);
        if (!validSteps(body.steps)) return send(res, 400, { error: 'steps 형식이 올바르지 않습니다' });
        state.steps = body.steps;
        return send(res, 200, state);
      }
      case 'POST /shutdown':
        send(res, 204);
        setTimeout(() => shutdown(0), 50);
        return undefined;
      default:
        return send(res, 404, { error: 'not found' });
    }
  } catch (e) {
    return send(res, 500, { error: oneLine(e) });
  }
}

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  state.status = 'CLOSED';
  log('종료');
  try { if (browser) await browser.close(); } catch { /* 무시 */ }
  process.exit(code);
}

async function startBrowser() {
  const { chromium } = require('@playwright/test');
  browser = await chromium.launch();
  // 서비스 워커의 요청은 context.route 에 걸리지 않으므로 막는다.
  const options = { viewport: VIEWPORT, locale: 'ko-KR', serviceWorkers: 'block' };
  if (STORAGE_STATE && fs.existsSync(STORAGE_STATE)) {
    options.storageState = STORAGE_STATE;
    log('로그인 세션으로 시작', STORAGE_STATE);
  }
  context = await browser.newContext(options);
  await sel.installMutationClock(context);
  await context.route('**/*', (route) => {
    const reqUrl = route.request().url();
    if (isBlockedUrl(reqUrl)) {
      log('내부 주소 요청 차단', reqUrl);
      return route.abort('blockedbyclient').catch(() => {});
    }
    return route.continue().catch(() => {});
  });
  // 새 탭 · 팝업은 주소만 받아 두고 닫는다 — 동작이 끝난 뒤 같은 탭으로 따라간다 (followPopups).
  context.on('page', (p) => {
    if (!page || p === page) return;
    popups.push((async () => {
      await p.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
      const url = p.url();
      await p.close().catch(() => {});
      return url;
    })());
  });
  attachPage(await context.newPage());

  const url = absoluteUrl(START_URL);
  assertNotInternal(url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle();
  const recorded = toRecordedPath(url);
  pushStep({ action: 'goto', selector: null, fragile: false, label: `${short(recorded, 60)} 열기`, value: recorded });
  state.screenshotVersion += 1;
  await refreshPageInfo();
}

async function main() {
  if (!PORT) throw new Error('RECORDER_PORT 가 필요합니다');
  if (!START_URL) throw new Error('RECORDER_START_URL 이 필요합니다');
  const server = http.createServer((req, res) => { handle(req, res); });
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  log(`HTTP ${HOST}:${PORT} 시작, 처음 주소 ${START_URL}`);

  setInterval(() => {
    if (Date.now() - lastRequestAt > IDLE_EXIT_MS) {
      log('요청이 오래 없어 스스로 종료합니다');
      shutdown(0);
    }
  }, 30000).unref();
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));

  try {
    await startBrowser();
    state.status = 'READY';
  } catch (e) {
    // 서버는 계속 띄워 두어 api 가 이유를 읽을 수 있게 한다.
    state.status = 'ERROR';
    state.error = `처음 화면을 열지 못했습니다: ${oneLine(e)}`;
    log(state.error);
    if (page) await refreshPageInfo();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[record] 시작 실패:', oneLine(e));
    process.exit(1);
  });
}

module.exports = { isBlockedUrl, isInternalHost };
