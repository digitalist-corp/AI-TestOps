// AI-TestOps AI Runner — 셀렉터 후보 · 검증 (녹화 record.js 가 쓴다)
//
// analyze.js 의 candidatesFor · resolveSelector · trackRequests · installMutationClock · waitSettled 를
// 복사해 모듈로 만든 것이다. analyze.js 는 다른 작업에서 동시에 고치고 있어 아직 이 모듈을 쓰지 않는다
// (병합 후 중복을 정리한다).
//
// analyze.js 와 다른 점
//   · "찾은 요소가 클릭한 그 요소인가"를 번호(idx) 대신 표식 속성(markAttr = markValue)으로 대조한다.
//   · 링크 · 버튼이 아닌 요소(제목 · 문단 등 확인용)도 글자로 찾을 수 있게 getByText 후보를 넓혔다.
//   · 모든 후보가 실패해도 마지막에 태그 순번(.nth)으로 반드시 하나를 돌려준다(fragile).
//   · 채택한 후보의 Playwright 로케이터도 함께 돌려줘, 기록한 셀렉터로 실제 동작을 수행할 수 있다.
'use strict';

const MARK_ATTR = 'data-ait-rec';

function quote(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
}

/**
 * 화면 좌표의 요소를 찾아 설명한다 (브라우저 컨텍스트에서 실행 — 바깥 변수를 쓰지 않는다).
 * elementFromPoint 후 가장 가까운 상호작용 요소로 올라가고, 없으면 그 요소 자체를 쓴다.
 * label 을 눌렀으면 그 label 이 가리키는 입력란을 대상으로 삼는다(라벨 클릭 = 입력란 클릭).
 */
function describeAtPoint({ x, y, markAttr, markValue }) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  const implicitRole = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button') return 'button';
    if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img' && el.getAttribute('alt')) return 'img';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (type === 'password') return null; // ARIA 역할이 없다 — getByLabel 로 찾아야 한다
      return 'textbox';
    }
    return null;
  };

  const labelOf = (el) => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (clean(text)) return clean(text);
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && clean(lab.textContent)) return clean(lab.textContent);
    }
    const wrap = el.closest('label');
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    return '';
  };

  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (clean(aria)) return clean(aria);
    const label = labelOf(el);
    if (label) return label;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (['button', 'submit', 'reset'].includes((el.getAttribute('type') || '').toLowerCase())) {
        return clean(el.value);
      }
      return clean(el.getAttribute('title') || el.getAttribute('placeholder') || '');
    }
    if (tag === 'img') return clean(el.getAttribute('alt'));
    const img = el.querySelector('img[alt]');
    return clean(el.innerText || el.textContent || '') || clean(img?.getAttribute('alt')) || clean(el.getAttribute('title'));
  };

  const contentName = (el) => clean(el.textContent || '');

  const LANDMARK = 'nav, aside, header, footer, main, dialog, [role="dialog"], [role="navigation"], '
    + '[role="complementary"], [role="banner"], [role="region"], [role="tabpanel"], '
    + 'section[aria-label], section[aria-labelledby], form[aria-label]';
  const landmarkRole = (lm) => {
    const r = lm.getAttribute('role');
    if (r) return r;
    return { nav: 'navigation', aside: 'complementary', header: 'banner', footer: 'contentinfo',
             main: 'main', dialog: 'dialog', section: 'region', form: 'form' }[lm.tagName.toLowerCase()] || null;
  };
  const scopeOf = (el) => {
    const lm = el.parentElement ? el.parentElement.closest(LANDMARK) : null;
    if (!lm) return null;
    const role = landmarkRole(lm);
    if (!role) return null;
    let name = clean(lm.getAttribute('aria-label'));
    const lb = lm.getAttribute('aria-labelledby');
    if (!name && lb) name = clean(lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
    return { role, name: name || null };
  };

  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const INTERACTIVE = 'a, button, input, select, textarea, [role], [onclick], label, [contenteditable="true"]';
  // SVG 안쪽 도형(path 등)을 누르면 그 그림 전체(svg)를 대상으로 삼는다.
  const svgRoot = hit instanceof SVGElement && hit.ownerSVGElement ? hit.closest('svg') : null;
  let el = hit.closest(INTERACTIVE) || svgRoot || hit;
  // 화면 전체를 덮는 [role] 틀(예: role="main")까지 올라가 버리면 원래 누른 요소를 쓴다.
  const LANDMARK_ROLES = ['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'region', 'document', 'application', 'presentation', 'none', 'group', 'list', 'listitem', 'form'];
  if (el !== hit && LANDMARK_ROLES.includes((el.getAttribute('role') || '').toLowerCase())) el = hit;
  if (el.tagName.toLowerCase() === 'label' && el.control) el = el.control;

  document.querySelectorAll(`[${markAttr}]`).forEach((n) => n.removeAttribute(markAttr));
  el.setAttribute(markAttr, markValue);

  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase() || null;
  const name = nameOf(el);
  const alt = contentName(el);
  const r = el.getBoundingClientRect();
  const hint = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('autocomplete') || ''}`.toLowerCase();
  return {
    tag,
    type,
    role: implicitRole(el),
    name,
    nameAlt: alt && alt !== name && !el.getAttribute('aria-label') ? alt : null,
    scope: scopeOf(el),
    label: labelOf(el) || null,
    placeholder: el.getAttribute('placeholder') || null,
    text: clean(el.innerText || ''),
    // toHaveText · getByText 는 textContent 기준이다 (innerText 는 <br> 을 공백으로 바꿔 어긋난다).
    fullText: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || null,
    id: el.id || null,
    fillable: (tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color'].includes(type || 'text'))
      || tag === 'textarea' || el.isContentEditable,
    password: tag === 'input' && type === 'password',
    loginId: tag === 'input' && (type === 'email' || /user|email|login|account|^id\b|\bid$|아이디/.test(hint)),
    box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
  };
}

/**
 * 글자 후보. 80자를 넘는 긴 글자(문단 등)는 잘린 글자로는 exact 가 맞지 않으므로,
 * 앞부분 60자를 "포함" 조건으로 찾는다 (정확히 하나인지는 resolveSelector 가 확인한다).
 */
function textCandidate(el) {
  const full = el.fullText || el.text;
  if (full.length <= 80) {
    return { kind: 'text', code: `getByText(${quote(full)}, { exact: true })`, make: (p) => p.getByText(full, { exact: true }) };
  }
  const head = full.slice(0, 60).trim();
  return { kind: 'text', code: `getByText(${quote(head)})`, make: (p) => p.getByText(head) };
}

/** 요소 하나에 대한 셀렉터 후보를 우선순위 순으로 만든다 (analyze.js 와 같은 순서). */
function candidatesFor(el) {
  const c = [];
  if (el.testId) c.push({ kind: 'testid', code: `getByTestId(${quote(el.testId)})`, make: (p) => p.getByTestId(el.testId) });
  if (el.role && el.name) {
    c.push({
      kind: 'role',
      code: `getByRole(${quote(el.role)}, { name: ${quote(el.name)}, exact: true })`,
      make: (p) => p.getByRole(el.role, { name: el.name, exact: true }),
    });
  }
  if (el.role && el.nameAlt) {
    c.push({
      kind: 'role',
      code: `getByRole(${quote(el.role)}, { name: ${quote(el.nameAlt)}, exact: true })`,
      make: (p) => p.getByRole(el.role, { name: el.nameAlt, exact: true }),
    });
  }
  if (el.label) c.push({ kind: 'label', code: `getByLabel(${quote(el.label)}, { exact: true })`, make: (p) => p.getByLabel(el.label, { exact: true }) });
  if (el.placeholder) {
    c.push({ kind: 'placeholder', code: `getByPlaceholder(${quote(el.placeholder)}, { exact: true })`, make: (p) => p.getByPlaceholder(el.placeholder, { exact: true }) });
  }
  // analyze.js 는 링크 · 버튼만 글자로 찾지만, 녹화는 "이 글자가 보이는지" 확인에도 쓰므로 입력란 외에는 모두 허용한다.
  if (el.text && !['input', 'select', 'textarea'].includes(el.tag)) c.push(textCandidate(el));
  // 이름이 겹치면 가장 가까운 영역 안으로 좁혀 다시 찾는다.
  if (el.scope && el.role && (el.name || el.nameAlt)) {
    const sc = el.scope;
    const scopeCode = sc.name
      ? `getByRole(${quote(sc.role)}, { name: ${quote(sc.name)}, exact: true })`
      : `getByRole(${quote(sc.role)})`;
    const scopeMake = (p) => (sc.name ? p.getByRole(sc.role, { name: sc.name, exact: true }) : p.getByRole(sc.role));
    for (const nm of [el.name, el.nameAlt].filter(Boolean)) {
      c.push({
        kind: 'scoped',
        code: `${scopeCode}.getByRole(${quote(el.role)}, { name: ${quote(nm)}, exact: true })`,
        make: (p) => scopeMake(p).getByRole(el.role, { name: nm, exact: true }),
      });
    }
  }
  // 자동 생성처럼 보이는 id(숫자 · 콜론 · 긴 해시)는 다음 배포에서 바뀌므로 쓰지 않는다.
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/[0-9]{3,}|^[a-f0-9-]{16,}$/i.test(el.id)) {
    c.push({ kind: 'css', code: `locator(${quote('#' + el.id)})`, make: (p) => p.locator(`#${el.id}`) });
  }
  return c;
}

/**
 * 후보를 순서대로 Playwright 로 찍어 보고, 정확히 한 요소만 가리키며 그 요소가 표식이 붙은
 * (클릭한) 요소와 같은 첫 후보를 채택한다. 모두 실패하면 순번(.nth)으로 가리키고 fragile 로 표시한다.
 *
 * @returns {{ selector: string, kind: string, fragile: boolean, locator: import('@playwright/test').Locator, rejected: string[] }}
 */
async function resolveSelector(page, el, markValue, markAttr = MARK_ATTR) {
  const tried = [];
  for (const cand of candidatesFor(el)) {
    try {
      const loc = cand.make(page);
      const count = await loc.count();
      if (count === 1) {
        const mark = await loc.getAttribute(markAttr, { timeout: 1000 });
        if (mark === markValue) {
          return { selector: cand.code, kind: cand.kind, fragile: false, locator: loc, rejected: tried };
        }
        tried.push(`${cand.kind}:다른요소`);
      } else {
        tried.push(`${cand.kind}:${count}개`);
      }
    } catch (e) {
      tried.push(`${cand.kind}:오류`);
    }
  }
  // 마지막 수단 — 같은 이름(또는 같은 태그) 중 몇 번째인지로 가리킨다. 화면 순서가 바뀌면 깨진다.
  const fallbacks = [];
  if (el.role) {
    for (const nm of [el.name, el.nameAlt].filter(Boolean)) {
      fallbacks.push({
        code: `getByRole(${quote(el.role)}, { name: ${quote(nm)}, exact: true })`,
        make: (p) => p.getByRole(el.role, { name: nm, exact: true }),
      });
    }
  }
  if (el.text && !['input', 'select', 'textarea'].includes(el.tag)) fallbacks.push(textCandidate(el));
  fallbacks.push({ code: `locator(${quote(el.tag)})`, make: (p) => p.locator(el.tag) });
  for (const fb of fallbacks) {
    try {
      const loc = fb.make(page);
      const marks = await loc.evaluateAll((els, attr) => els.map((e) => e.getAttribute(attr)), markAttr);
      const k = marks.indexOf(markValue);
      if (k >= 0) {
        return { selector: `${fb.code}.nth(${k})`, kind: 'nth', fragile: true, locator: loc.nth(k), rejected: tried };
      }
    } catch { /* 다음 후보로 */ }
  }
  return { selector: null, kind: null, fragile: false, locator: null, rejected: tried };
}

/** 페이지의 fetch · XHR 요청을 추적한다. SSE(event-stream)는 끝나지 않으므로 세지 않는다. */
function trackRequests(page) {
  const inflight = new Map();
  const tracked = (r) => ['fetch', 'xhr'].includes(r.resourceType())
    && !/event-stream/.test(r.headers().accept || '');
  page.on('request', (r) => { if (tracked(r)) inflight.set(r, Date.now()); });
  page.on('requestfinished', (r) => inflight.delete(r));
  page.on('requestfailed', (r) => inflight.delete(r));
  return {
    // maxAgeMs 보다 오래 걸리는 요청(주기적 상태 조회 등 느린 배경 요청)은 기다리지 않는다.
    pending(maxAgeMs) {
      const now = Date.now();
      let n = 0;
      for (const t of inflight.values()) if (now - t < maxAgeMs) n += 1;
      return n;
    },
  };
}

// 모든 문서에서 마지막 DOM 변경 시각을 기록한다 (속성 변경은 세지 않는다 — 표식을 붙이기 때문).
function installMutationClock(context) {
  return context.addInitScript(() => {
    window.__aitLastMutation = Date.now();
    const start = () => new MutationObserver(() => { window.__aitLastMutation = Date.now(); })
      .observe(document, { childList: true, subtree: true, characterData: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });
}

/**
 * 화면이 다 그려질 때까지 기다린다.
 * "진행 중인 요청이 없고 + DOM 변화가 QUIET_MS 동안 멈춤"을 함께 만족할 때 완료로 본다 (analyze.js 와 같음).
 */
async function waitSettled(page, requests) {
  const QUIET_MS = 600;
  const SLOW_REQUEST_MS = 4000;
  const MAX_MS = 10000;
  const started = Date.now();
  await page.waitForTimeout(200);
  while (Date.now() - started < MAX_MS) {
    const pending = requests.pending(SLOW_REQUEST_MS);
    const sinceMutation = await page.evaluate(() => Date.now() - (window.__aitLastMutation || 0)).catch(() => QUIET_MS);
    if (pending === 0 && sinceMutation >= QUIET_MS) return;
    await page.waitForTimeout(150);
  }
}

module.exports = {
  MARK_ATTR,
  quote,
  describeAtPoint,
  candidatesFor,
  textCandidate,
  resolveSelector,
  trackRequests,
  installMutationClock,
  waitSettled,
};
