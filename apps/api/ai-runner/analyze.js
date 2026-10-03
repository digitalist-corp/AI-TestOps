// AI-TestOps AI Runner — SITE_ANALYSIS (대상 분석 v1 · DOM 경로)
//
// 테스트를 작성하기 전에 대상 사이트를 먼저 관찰해 "화면(노드) · 전환(엣지)" 지식을 만든다.
// 지금까지 시나리오 생성 프롬프트는 URL · 이름 · 요구사항 세 문자열만 받아 셀렉터를 추측했고,
// 그래서 처음 등록한 사이트의 테스트가 자주 실패했다. 여기서 모은 셀렉터는 추측이 아니라
// Playwright 가 실제로 "정확히 그 요소 하나"를 찾는지 확인한 값이다.
//
// v1 원칙
//   · LLM 을 쓰지 않는다 — 결정적인 코드로만 탐색한다 (비용 0, 매번 같은 결과).
//   · 클릭하지 않는다 — 링크는 href 로 직접 이동만 한다. 폼 제출 · 삭제 같은 부수 효과가 없다.
//   · 같은 호스트만, 깊이 · 페이지 수 · 시간 상한 안에서만 돈다.
//   · 상호작용 요소가 0개인 대상(예: Flutter Web CanvasKit)은 VISUAL_REQUIRED 로 표시하고 멈춘다.
//     시각 기반 탐색은 이후 단계에서 붙인다.
//
// 입력  job.json  { jobType: 'SITE_ANALYSIS', jobId, baseUrl, seedUrls?, limits?, excludePatterns?, auth? }
//        seedUrls — 링크로 닿지 않는 화면(버튼으로만 이동하는 SPA 화면 등)의 시작점.
//                   저장소 코드 분석이 붙으면 코드에서 뽑은 라우트가 여기로 들어온다.
// 출력  <resultDir>/result.json  +  <resultDir>/screens/*.jpg
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LIMITS = {
  maxPages: 20,
  maxDepth: 3,
  timeoutMs: 180000,
  navTimeoutMs: 15000,
  maxElementsPerPage: 60,
};

// 경로에 이 단어가 들어간 링크는 따라가지 않는다. 링크 이동만으로도 상태가 바뀌는 곳이다.
const DEFAULT_EXCLUDE = ['logout', 'log-out', 'signout', 'sign-out', 'delete', 'remove', '로그아웃'];

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="checkbox"]', '[role="switch"]', '[role="radio"]', '[role="combobox"]',
  '[contenteditable="true"]',
].join(', ');

const IDX_ATTR = 'data-ait-idx';

function normalizeUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    let p = u.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return `${u.origin}${p}${u.search}`;
  } catch {
    return null;
  }
}

function isExcluded(url, patterns) {
  const lower = url.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * 페이지 안에서 상호작용 요소와 폼을 모은다 (브라우저 컨텍스트에서 실행).
 * 요소마다 IDX_ATTR 를 붙여 두고, 이후 Playwright 로 후보 셀렉터를 검증할 때
 * "찾은 요소가 정말 이 요소인가"를 이 번호로 대조한다.
 */
function collectInPage({ selector, idxAttr, maxElements }) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };

  const implicitRole = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button') return 'button';
    if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
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
    const img = el.querySelector('img[alt]');
    return clean(el.innerText || el.textContent || '') || clean(img?.getAttribute('alt')) || clean(el.getAttribute('title'));
  };

  // 접근성 이름은 자식 글자를 그대로 잇는다(예: <b>전체</b><span>0</span> → "전체0").
  // innerText 는 레이아웃 줄바꿈을 끼워 "전체 0" 이 되므로, 두 변형을 모두 후보로 남긴다.
  const contentName = (el) => clean(el.textContent || '');

  // 이름이 같은 요소가 여러 개일 때 범위를 좁히는 데 쓰는 가장 가까운 영역.
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

  const all = Array.from(document.querySelectorAll(selector));
  const interactiveCount = all.length;
  const elements = [];
  for (const el of all) {
    if (elements.length >= maxElements) break;
    if (!visible(el)) continue;
    const idx = elements.length;
    el.setAttribute(idxAttr, String(idx));
    const form = el.closest('form');
    elements.push({
      idx,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      role: implicitRole(el),
      name: nameOf(el),
      nameAlt: (() => {
        const alt = contentName(el);
        return alt && alt !== nameOf(el) && !el.getAttribute('aria-label') ? alt : null;
      })(),
      scope: scopeOf(el),
      label: labelOf(el) || null,
      placeholder: el.getAttribute('placeholder') || null,
      text: clean(el.innerText || ''),
      href: el.tagName === 'A' ? el.href : null,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || null,
      id: el.id || null,
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      inForm: form ? Array.from(document.forms).indexOf(form) : null,
    });
  }

  const forms = Array.from(document.forms).map((f, i) => ({
    idx: i,
    fieldIdx: elements.filter((e) => e.inForm === i && ['input', 'select', 'textarea'].includes(e.tag)).map((e) => e.idx),
    submitIdx: elements.filter((e) => e.inForm === i && e.role === 'button').map((e) => e.idx),
  })).filter((f) => f.fieldIdx.length > 0);

  return { interactiveCount, elements, forms };
}

function quote(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** 요소 하나에 대한 셀렉터 후보를 우선순위 순으로 만든다. */
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
  if (el.text && ['a', 'button'].includes(el.tag)) {
    c.push({ kind: 'text', code: `getByText(${quote(el.text)}, { exact: true })`, make: (p) => p.getByText(el.text, { exact: true }) });
  }
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
  if (el.id && !/[0-9]{3,}|:|^[a-f0-9-]{16,}$/i.test(el.id)) {
    c.push({ kind: 'css', code: `locator(${quote('#' + el.id)})`, make: (p) => p.locator(`#${el.id}`) });
  }
  return c;
}

/**
 * 후보를 순서대로 Playwright 로 찍어 보고, 정확히 한 요소만 가리키며 그 요소가
 * 수집한 요소와 같은 첫 후보를 채택한다. 하나도 없으면 selector 는 null 이다.
 */
async function resolveSelector(page, el) {
  const tried = [];
  for (const cand of candidatesFor(el)) {
    try {
      const loc = cand.make(page);
      const count = await loc.count();
      if (count === 1) {
        const idx = await loc.getAttribute(IDX_ATTR, { timeout: 1000 });
        if (idx === String(el.idx)) {
          return { selector: cand.code, selectorKind: cand.kind, unique: true, tried: tried.length + 1 };
        }
        tried.push(`${cand.kind}:다른요소`);
      } else {
        tried.push(`${cand.kind}:${count}개`);
      }
    } catch (e) {
      tried.push(`${cand.kind}:오류`);
    }
  }
  // 마지막 수단 — 같은 이름 중 몇 번째인지로 가리킨다. 화면 순서가 바뀌면 깨지므로 불안정으로 표시한다.
  if (el.role && (el.name || el.nameAlt)) {
    for (const nm of [el.name, el.nameAlt].filter(Boolean)) {
      try {
        const loc = page.getByRole(el.role, { name: nm, exact: true });
        const idxs = await loc.evaluateAll((els, attr) => els.map((e) => e.getAttribute(attr)), IDX_ATTR);
        const k = idxs.indexOf(String(el.idx));
        if (k >= 0) {
          return {
            selector: `getByRole(${quote(el.role)}, { name: ${quote(nm)}, exact: true }).nth(${k})`,
            selectorKind: 'nth', unique: true, fragile: true, tried: tried.length + 1,
          };
        }
      } catch { /* 다음 이름으로 */ }
    }
  }
  return { selector: null, selectorKind: null, unique: false, tried: tried.length, rejected: tried };
}

/**
 * 페이지의 fetch · XHR 요청을 추적한다. SSE(event-stream)는 끝나지 않으므로 세지 않는다.
 */
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

// 모든 문서에서 마지막 DOM 변경 시각을 기록한다 (속성 변경은 세지 않는다 — 수집 표식을 붙이기 때문).
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
 *
 * DOM 변화만 보면 안 된다 — SPA 는 빈 틀을 먼저 그리고 데이터 응답을 기다리는 동안 조용히 멈춰 있어,
 * 그 틈을 "완료"로 잘못 판정한다(실측: 틀 1.24초 → 목록 1.89초, 사이 650ms 정지). 그래서
 * "진행 중인 요청이 없고 + DOM 변화가 QUIET_MS 동안 멈춤"을 함께 만족할 때 완료로 본다.
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

async function runSiteAnalysis(job, resultDir) {
  const { chromium } = require('@playwright/test');
  const started = Date.now();
  const limits = { ...DEFAULT_LIMITS, ...(job.limits || {}) };
  const exclude = [...DEFAULT_EXCLUDE, ...(job.excludePatterns || [])];
  const entry = normalizeUrl(job.baseUrl);
  if (!entry) throw new Error(`baseUrl 이 올바르지 않습니다: ${job.baseUrl}`);
  const host = new URL(entry).host;

  const screensDir = path.join(resultDir, 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  const browser = await chromium.launch();
  const contextOptions = { viewport: { width: 1280, height: 800 }, locale: 'ko-KR' };
  if (job.auth && job.auth.storageStatePath && fs.existsSync(job.auth.storageStatePath)) {
    contextOptions.storageState = job.auth.storageStatePath;
  }
  const context = await browser.newContext(contextOptions);
  await installMutationClock(context);
  const page = await context.newPage();
  const requests = trackRequests(page);
  page.setDefaultNavigationTimeout(limits.navTimeoutMs);

  const nodes = [];
  const byUrl = new Map();          // 정규화 URL → 노드 id
  const redirects = [];
  const rawEdges = [];
  const warnings = [];
  const skipped = { external: 0, excluded: 0, depth: 0, pageLimit: 0 };
  const queue = [{ url: entry, depth: 0 }];
  const queued = new Set([entry]);
  for (const seed of job.seedUrls || []) {
    const u = normalizeUrl(seed, entry);
    if (u && new URL(u).host === host && !queued.has(u)) {
      queued.add(u);
      queue.push({ url: u, depth: 0, seed: true });
    }
  }
  let mode = 'DOM';

  try {
    while (queue.length > 0) {
      if (Date.now() - started > limits.timeoutMs) {
        warnings.push(`시간 상한(${limits.timeoutMs}ms)에 도달해 탐색을 멈췄습니다. 남은 대기 ${queue.length}건`);
        break;
      }
      if (nodes.length >= limits.maxPages) {
        skipped.pageLimit += queue.length;
        warnings.push(`페이지 수 상한(${limits.maxPages})에 도달했습니다. 남은 대기 ${queue.length}건`);
        break;
      }
      const { url, depth, seed } = queue.shift();

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        warnings.push(`열기 실패: ${url} — ${String(e.message || e).split('\n')[0]}`);
        continue;
      }
      await waitSettled(page, requests);

      const finalUrl = normalizeUrl(page.url());
      if (finalUrl !== url) {
        redirects.push({ from: url, to: finalUrl });
        if (byUrl.has(finalUrl)) {
          // 이미 본 화면으로 되돌아간 것(예: 로그인 안 된 상태에서 /login 으로 이동) — 노드를 새로 만들지 않는다.
          byUrl.set(url, byUrl.get(finalUrl));
          continue;
        }
      }

      const collected = await page.evaluate(collectInPage, {
        selector: INTERACTIVE_SELECTOR, idxAttr: IDX_ATTR, maxElements: limits.maxElementsPerPage,
      });

      // 첫 화면에 상호작용 요소가 하나도 없으면 DOM 경로로는 더 볼 것이 없다.
      if (nodes.length === 0 && collected.interactiveCount === 0) {
        mode = 'VISUAL_REQUIRED';
        warnings.push('첫 화면에 상호작용 가능한 DOM 요소가 없습니다. 화면을 캔버스로 그리는 대상(예: Flutter Web)일 수 있어 시각 기반 탐색이 필요합니다.');
      }

      for (const el of collected.elements) {
        Object.assign(el, await resolveSelector(page, el));
      }

      const id = `n${nodes.length + 1}`;
      const shot = `screens/${id}.jpg`;
      await page.screenshot({ path: path.join(resultDir, shot), type: 'jpeg', quality: 60 }).catch(() => {});
      const aria = await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '');

      const node = {
        id,
        url: finalUrl,
        path: new URL(finalUrl).pathname + new URL(finalUrl).search,
        title: await page.title(),
        depth,
        seed: Boolean(seed),
        screenshot: shot,
        interactiveCount: collected.interactiveCount,
        elements: collected.elements,
        forms: collected.forms,
        ariaSnapshot: aria.length > 6000 ? `${aria.slice(0, 6000)}\n… (이하 생략)` : aria,
      };
      nodes.push(node);
      byUrl.set(url, id);
      byUrl.set(finalUrl, id);

      if (mode === 'VISUAL_REQUIRED') break;

      for (const el of collected.elements) {
        if (!el.href) continue;
        const target = normalizeUrl(el.href, finalUrl);
        if (!target) continue;
        if (new URL(target).host !== host) { skipped.external += 1; continue; }
        if (isExcluded(target, exclude)) { skipped.excluded += 1; continue; }
        rawEdges.push({ from: id, toUrl: target, label: el.name || el.text || target, selector: el.selector });
        if (queued.has(target)) continue;
        if (depth + 1 > limits.maxDepth) { skipped.depth += 1; continue; }
        queued.add(target);
        queue.push({ url: target, depth: depth + 1 });
      }
    }
  } finally {
    await browser.close();
  }

  // 같은 두 화면 사이의 링크는 하나의 전환으로 합친다 (메뉴가 여러 화면에 반복되므로).
  const edgeMap = new Map();
  for (const e of rawEdges) {
    const to = byUrl.get(e.toUrl) || null;
    const key = `${e.from}->${to || e.toUrl}`;
    if (e.from === to) continue; // 자기 자신으로 가는 링크
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { from: e.from, to, toUrl: to ? null : e.toUrl, kind: 'link', label: e.label, selector: e.selector, visited: Boolean(to) });
    }
  }
  const edges = Array.from(edgeMap.values());

  const elementCount = nodes.reduce((s, n) => s + n.elements.length, 0);
  const uniqueCount = nodes.reduce((s, n) => s + n.elements.filter((e) => e.unique && !e.fragile).length, 0);
  const fragileCount = nodes.reduce((s, n) => s + n.elements.filter((e) => e.fragile).length, 0);
  const result = {
    version: 1,
    jobId: job.jobId ?? null,
    status: 'COMPLETED',
    mode,
    baseUrl: entry,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    limits,
    stats: {
      pages: nodes.length,
      edges: edges.length,
      edgesToUnvisited: edges.filter((e) => !e.visited).length,
      elements: elementCount,
      verifiedSelectors: uniqueCount,
      fragileSelectors: fragileCount,
      noSelector: elementCount - uniqueCount - fragileCount,
      selectorCoverage: elementCount ? Math.round((uniqueCount / elementCount) * 1000) / 10 : 0,
      forms: nodes.reduce((s, n) => s + n.forms.length, 0),
      skipped,
    },
    redirects,
    warnings,
    nodes,
    edges,
  };
  fs.writeFileSync(path.join(resultDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`[analyze] ${mode} · 화면 ${nodes.length} · 전환 ${edges.length} · 요소 ${elementCount} · `
    + `검증된 셀렉터 ${uniqueCount} (${result.stats.selectorCoverage}%) · 불안정 ${fragileCount} · `
    + `없음 ${result.stats.noSelector} · ${result.durationMs}ms`);
  return result;
}

module.exports = { runSiteAnalysis, normalizeUrl };
