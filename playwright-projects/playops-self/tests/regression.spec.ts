import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// PlayOps가 자기 자신을 테스트하는 dogfooding 스위트.
// 각 test()는 독립적으로 재로그인하지만, playops-full-test 프로젝트가 이전 케이스에서
// 만들어졌다는 것을 전제로 이어서 진행하므로 반드시 순서대로(sequential) 실행해야 한다.

const screenshotDir = process.env.PLAYOPS_SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

const takeScreenshot = async (page: Page, name: string) => {
  if (process.env.PLAYOPS_TAKE_SCREENSHOTS) {
    await page.screenshot({ path: path.join(screenshotDir, name) });
  }
};

const login = async (page: Page) => {
  await page.goto('/login');
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/projects');
  await expect(page.locator('h2:has-text("프로젝트")')).toBeVisible();
};

test.describe.serial('PlayOps Self Regression', () => {
  test('로그인 및 프로젝트 목록 진입', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    // 이전 실행이 남긴 playops-full-test 프로젝트를 정리한다.
    await page.evaluate(async () => {
      const token = localStorage.getItem('playops_token');
      if (token) {
        await fetch('/api/projects/playops-full-test', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    });
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.locator('h2:has-text("프로젝트")')).toBeVisible();
  });

  test('프로젝트 등록 및 소스 탐색기 확인', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    await page.click('button:has-text("프로젝트 등록")');
    await page.fill('#baseUrl', 'https://example.com');
    await page.fill('#projectName', 'PlayOps Full E2E Test Project');
    await page.click('button:has-text("고급 설정")');
    await page.fill('#projectIdField', 'playops-full-test');
    await page.click('button[type="submit"]:has-text("등록")');
    await page.waitForTimeout(3000);

    await page.goto('/projects/playops-full-test/dashboard');
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '06_dashboard.png');

    await page.goto('/projects/playops-full-test/source');
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
    await page.goto('/projects/playops-full-test/scenarios');
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '08_scenarios.png');
    await expect(page.locator('body')).toBeVisible();
  });

  test('실행 및 결과 탭 확인', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    await page.goto('/projects/playops-full-test/runs');

    await page.waitForTimeout(1000);
    const runBtn = page.locator('button:has-text("전체 실행")');
    if (await runBtn.isEnabled()) {
      await runBtn.click();
      await page.waitForTimeout(3000);
    }
    await takeScreenshot(page, '09_runs.png');

    await page.goto('/projects/playops-full-test/results');
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
    await page.route('**/api/projects/playops-full-test/sitemap', (route) =>
      route.fulfill({
        json: {
          projectId: 'playops-full-test',
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

    await page.goto('/projects/playops-full-test/structure');
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
