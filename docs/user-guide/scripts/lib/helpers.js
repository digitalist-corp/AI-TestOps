// 장면에서 같이 쓰는 도우미. 화면에 보이는 그대로 기능을 써서 이동한다(DOM 을 지어내 고치지 않는다).

const { APP_URL } = require('./session');

const PROJECT_NAME = process.env.GUIDE_PROJECT || '데모샵';

/** 로그인한 사용자 토큰으로 API 를 읽는다(조회 전용 — 화면 이동 주소를 알아낼 때만 쓴다). */
async function api(page, path) {
  return page.evaluate(async (p) => {
    const token = localStorage.getItem('playops_token');
    const res = await fetch(p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }, path);
}

async function findProject(page, name = PROJECT_NAME) {
  const list = await api(page, '/api/projects');
  return list.find((p) => p.projectName === name) || null;
}

async function projectId(page, name = PROJECT_NAME) {
  const p = await findProject(page, name);
  if (!p) throw new Error(`프로젝트 "${name}" 이(가) 없습니다. 먼저 02 장면(프로젝트 등록)을 돌리세요.`);
  return p.projectId;
}

/** 프로젝트의 탭으로 이동한다. tab: dashboard | structure | scenarios | recorder | runs | results | settings | schedules | source | ai-generate | ai-analysis | ai-review */
async function gotoTab(page, tab, name = PROJECT_NAME) {
  const id = await projectId(page, name);
  await page.goto(`${APP_URL}/projects/${id}/${tab}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
  return id;
}

/** 상단바 AI 스위치를 원하는 상태로 맞춘다. */
async function setAi(page, on) {
  const sw = page.getByRole('switch').first();
  await sw.waitFor();
  const checked = (await sw.getAttribute('aria-checked')) === 'true';
  if (checked !== on) {
    await sw.click();
    await page.waitForTimeout(500);
  }
}

/** 요소를 감싸는 가장 가까운 카드(테두리 있는 상자)를 고른다. 제목 대신 카드 전체를 강조할 때. */
function cardOf(locator, level = 1) {
  return locator.locator(`xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' border ')][${level}]`);
}

/** 여러 대상을 한 상자로 묶는다(뷰포트 좌표). */
async function unionBox(page, ...targets) {
  const { resolveBox } = require('./annotate');
  const boxes = [];
  for (const t of targets) boxes.push(await resolveBox(page, t));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

/** 요소가 화면 위쪽(offset px 아래)에 오도록 스크롤한다. 앱은 window 가 아니라 안쪽 영역이 스크롤되므로 그 영역을 찾아 움직인다. */
async function scrollToTop(page, locator, offset = 80) {
  await locator.first().evaluate((el, off) => {
    el.scrollIntoView({ block: 'start' });
    let p = el.parentElement;
    while (p) {
      const st = getComputedStyle(p);
      if (/(auto|scroll)/.test(st.overflowY) && p.scrollHeight > p.clientHeight) {
        p.scrollBy(0, -(off - (el.getBoundingClientRect().top - p.getBoundingClientRect().top)));
        return;
      }
      p = p.parentElement;
    }
    window.scrollBy(0, el.getBoundingClientRect().top - off);
  }, offset);
  await page.waitForTimeout(600);
}

module.exports = { scrollToTop, cardOf, unionBox, api, findProject, projectId, gotoTab, setAi, PROJECT_NAME };
