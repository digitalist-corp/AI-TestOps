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

  test('게시판 등록 확인', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    await page.goto('/board');
    await page.waitForTimeout(1000);

    await page.click('button:has-text("글 등록")');
    await page.fill('label:has-text("제목") + input', 'PlayOps 전수 테스트 완료');
    await page.fill('label:has-text("내용") + textarea', '전체 E2E 자동화 기능 전수 테스트가 정상적으로 종료되었습니다.');
    await page.click('button:has-text("저장")');
    await page.waitForTimeout(1500);

    await expect(
      page.locator('span.truncate.font-medium:has-text("PlayOps 전수 테스트 완료")').first()
    ).toBeVisible();
  });
});
