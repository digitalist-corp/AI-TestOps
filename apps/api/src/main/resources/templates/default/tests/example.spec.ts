import { test, expect } from '@playwright/test';

// AI 없이도 등록한 사이트에 바로 돌릴 수 있는 기본 점검. 사이트 구조를 몰라도 되는 것만 본다.
test.describe('{{projectName}}', () => {
  test('첫 화면이 열린다', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status() ?? 0, '첫 화면 응답 코드').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('첫 화면에 스크립트 오류가 없다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/', { waitUntil: 'load' });
    expect(errors).toEqual([]);
  });

  test('첫 화면의 내부 링크가 열린다', async ({ page, request }) => {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    // 로그아웃처럼 상태를 바꾸는 링크는 건드리지 않는다. 앞에서 10개만 본다.
    const targets = [...new Set(hrefs.map((href) => href.split('#')[0]))]
      .filter((href) => href.startsWith(origin) && !/log-?out|sign-?out/i.test(href))
      .slice(0, 10);
    for (const url of targets) {
      const response = await request.get(url);
      expect.soft(response.status(), url).toBeLessThan(400);
    }
  });
});
