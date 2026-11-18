import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// PlayOps가 자기 자신을 테스트하는 dogfooding 스위트.
// 각 test()는 독립적으로 재로그인하지만, 테스트 프로젝트(TEST_PROJECT_NAME)가 이전 케이스에서
// 만들어졌다는 것을 전제로 이어서 진행하므로 반드시 순서대로(sequential) 실행해야 한다.

const screenshotDir = process.env.PLAYOPS_SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

const takeScreenshot = async (page: Page, name: string) => {
  if (process.env.PLAYOPS_TAKE_SCREENSHOTS) {
    await page.screenshot({ path: path.join(screenshotDir, name) });
  }
};

// 셀프 회귀 전용 계정 (배포가 서버 .env 에 만들고 API 가 이 실행에만 넘긴다). 진짜 관리자 계정은 쓰지 않는다.
const SELFTEST_USERNAME = process.env.SELFTEST_USERNAME || 'selftest';
const SELFTEST_PASSWORD = process.env.SELFTEST_PASSWORD || '';

/**
 * 비밀번호 칸은 page.fill 대신 값을 직접 넣는다. fill 은 단계 제목(Fill "값" …)으로 HTML 리포트에 값을 남긴다 (#157).
 * React 가 바뀐 값을 받도록 네이티브 setter 로 넣고 input 이벤트를 보낸다.
 */
const fillSecret = (page: Page, selector: string, value: string) =>
  page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

const login = async (page: Page) => {
  if (!SELFTEST_PASSWORD) throw new Error('SELFTEST_PASSWORD 가 없습니다 (서버 .env 확인)');
  await page.goto('/login');
  await page.fill('#username', SELFTEST_USERNAME);
  await fillSecret(page, '#password', SELFTEST_PASSWORD);
  try {
    await page.click('button[type="submit"]');
    // 로그인하면 역할별 첫 화면(/home)으로 간다. 이 스위트는 프로젝트 목록에서 시작한다.
    await page.waitForURL('**/home');
  } catch (err) {
    // 실패하면 Playwright 가 페이지 접근성 스냅샷(error-context)을 리포트에 붙이는데, 비밀번호 칸 값이 그대로 들어간다 (#157).
    // 로그인 화면에 남아 있으면 칸을 비우고 다시 던진다.
    await fillSecret(page, '#password', '').catch(() => {});
    throw err;
  }
  await page.goto('/projects');
  await expect(page.locator('h2:has-text("프로젝트")')).toBeVisible();
};

const TEST_PROJECT_NAME = 'PlayOps Full E2E Test Project';

/** 프로젝트 아이디는 서버가 붙인다(P0001 …). 이름으로 테스트 프로젝트 아이디들을 찾는다. */
const testProjectIds = (page: Page) =>
  page.evaluate(async (name) => {
    const token = localStorage.getItem('playops_token');
    const res = await fetch('/api/projects', { headers: { Authorization: `Bearer ${token}` } });
    const projects: Array<{ projectId: string; projectName: string }> = await res.json();
    return projects.filter((p) => p.projectName === name).map((p) => p.projectId);
  }, TEST_PROJECT_NAME);

// 등록 테스트가 만든 프로젝트 아이디. describe.serial 이라 뒤 테스트가 이어서 쓴다.
let projectId = '';

test.describe.serial('PlayOps Self Regression', () => {
  test('로그인 및 프로젝트 목록 진입', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    // 이전 실행이 남긴 테스트 프로젝트를 이름으로 찾아 정리한다.
    const leftovers = await testProjectIds(page);
    await page.evaluate(async (ids) => {
      const token = localStorage.getItem('playops_token');
      for (const id of ids) {
        await fetch(`/api/projects/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }, leftovers);
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.locator('h2:has-text("프로젝트")')).toBeVisible();
  });

  test('프로젝트 등록 및 소스 탐색기 확인', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    await page.click('button:has-text("프로젝트 등록")');
    await page.fill('#baseUrl', 'https://example.com');
    await page.fill('#projectName', TEST_PROJECT_NAME);
    await page.click('button[type="submit"]:has-text("등록")');
    await expect.poll(async () => (await testProjectIds(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
    projectId = (await testProjectIds(page))[0];

    await page.goto(`/projects/${projectId}/dashboard`);
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '06_dashboard.png');

    await page.goto(`/projects/${projectId}/source`);
    await page.waitForTimeout(1000);

    const templateBtn = page.locator('button:has-text("템플릿 생성")');
    if (await templateBtn.isVisible()) {
      await templateBtn.click();
      await page.waitForTimeout(2000);
    }

    const configSpan = page.locator('span:has-text("playwright.config.ts")');
    await configSpan.waitFor({ state: 'visible', timeout: 15000 });
    await configSpan.click();
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '07_source.png');
  });

  test('시나리오 탭 확인', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    await page.goto(`/projects/${projectId}/scenarios`);
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '08_scenarios.png');
    await expect(page.locator('body')).toBeVisible();
  });

  test('실행 및 결과 탭 확인', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    await page.goto(`/projects/${projectId}/runs`);

    await page.waitForTimeout(1000);
    const runBtn = page.locator('button:has-text("전체 실행")');
    if (await runBtn.isEnabled()) {
      await runBtn.click();
      await page.waitForTimeout(3000);
    }
    await takeScreenshot(page, '09_runs.png');

    await page.goto(`/projects/${projectId}/results`);
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '10_results.png');
  });

  test('구조 탭 그래프 및 경로 칩 확인', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);

    // 테스트 프로젝트(example.com)는 분석된 화면이 없으므로, 구조 응답만 고정된 화면 3개로 바꿔 그래프를 그린다.
    const screen = (routeKey: string, failedCount = 0) => ({
      routeKey, title: null, sourceFile: null, origin: 'CODE', stale: false, elementCount: 2, excluded: false,
      note: null, url: null, hasScreenshot: false, authRequired: routeKey !== '/login',
      passedCount: 2 - failedCount, failedCount, unverifiedCount: 0,
    });
    await page.route(`**/api/projects/${projectId}/sitemap`, (route) =>
      route.fulfill({
        json: {
          projectId,
          source: { url: null, branch: null, tokenSet: false, usesProjectRepository: false, siteUrl: 'https://example.com' },
          analysis: {
            status: 'COMPLETED', commitSha: null, framework: 'URL', partial: false, screenCount: 3, processedCount: 3,
            llmCalls: 0, etaSeconds: null, warnings: [], errorMessage: null, startedAt: null, finishedAt: null,
          },
          nodes: [screen('/login'), screen('/projects'), screen('/projects/:id', 1)],
          edges: [
            { from: '/login', to: '/projects', kind: 'link', label: '로그인', selector: null },
            { from: '/projects', to: '/projects/:id', kind: 'link', label: '열기', selector: null },
          ],
          layouts: [],
        },
      })
    );

    await page.goto(`/projects/${projectId}/structure`);
    const graph = page.getByTestId('structure-graph');
    await expect(graph).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('structure-screen-node')).toHaveCount(3);
    await expect(page.locator('[data-route="/projects/:id"]')).toHaveAttribute('data-status', 'failed');

    // 목록 → 상세 → 로그인: 마지막 구간은 직접 전환이 없어 경고가 뜬다.
    for (const route of ['/projects', '/projects/:id', '/login']) {
      await page.locator(`[data-route="${route}"]`).getByRole('button', { name: /경로에 추가/ }).click();
    }
    await expect(page.getByTestId('structure-path-chip')).toHaveCount(3);
    await expect(page.getByTestId('structure-path-broken')).toBeVisible();
    await takeScreenshot(page, '11_structure_graph.png');
  });

  test('알림 창 확인', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);

    // 우상단 종을 누르면 알림 창이 열리고, 알림이 없거나 목록이 보인다.
    const bell = page.getByRole('button', { name: /^알림/ });
    await expect(bell).toBeVisible();
    await bell.click();
    const panel = page.getByRole('dialog', { name: '알림' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('새 알림이 없습니다').or(panel.getByRole('listitem').first())).toBeVisible();
    await takeScreenshot(page, '12_notifications.png');

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
