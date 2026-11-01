// 브라우저 열기 · 로그인 · 공용 도우미.
// 관리자 계정은 환경변수(LOGIN_USERNAME / LOGIN_PASSWORD)로만 받는다. 파일 · 사진 · 로그에 남기지 않는다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const APP_URL = (process.env.APP_URL || 'http://host.docker.internal:3000').replace(/\/$/, '');
const SHOP_URL = (process.env.SHOP_URL || 'http://host.docker.internal:4173').replace(/\/$/, '');
const AUTH_DIR = path.resolve(__dirname, '..', '.auth');
const STATE_FILE = path.join(AUTH_DIR, 'state.json');
const VIEWPORT = { width: 1440, height: 900 };

async function openBrowser({ fresh = false } = {}) {
  const browser = await chromium.launch({ args: ['--lang=ko-KR'] });
  const useState = !fresh && fs.existsSync(STATE_FILE);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    storageState: useState ? STATE_FILE : undefined,
  });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  return { browser, context, page };
}

async function login(page, { force = false } = {}) {
  await page.goto(`${APP_URL}/projects`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const onLogin = await page.locator('#username').isVisible().catch(() => false);
  if (!onLogin && !force) return;
  const user = process.env.LOGIN_USERNAME;
  const pass = process.env.LOGIN_PASSWORD;
  if (!user || !pass) throw new Error('LOGIN_USERNAME / LOGIN_PASSWORD 환경변수가 필요합니다(run.sh 가 .env 에서 넘깁니다).');
  if (!onLogin) await page.goto(`${APP_URL}/login`);
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: STATE_FILE });
}

/** 지금 화면에서 보이는 글자 · 버튼 목록을 콘솔에 찍는다(셀렉터 찾기용). */
async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    };
    const pick = (sel) =>
      [...document.querySelectorAll(sel)].filter(vis).map((el) => {
        const r = el.getBoundingClientRect();
        const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}] ${name}`;
      });
    return {
      url: location.href,
      buttons: pick('button, a[href], [role="tab"], [role="button"]'),
      inputs: pick('input, textarea, select'),
      headings: pick('h1, h2, h3'),
    };
  });
  console.log(`\n=== ${label} ${info.url}`);
  for (const k of ['headings', 'buttons', 'inputs']) {
    console.log(`-- ${k}`);
    info[k].forEach((s) => console.log('   ' + s));
  }
}

module.exports = { openBrowser, login, dump, APP_URL, SHOP_URL, VIEWPORT, STATE_FILE };
