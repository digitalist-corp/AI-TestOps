import { test, expect } from './fixtures';
import { HomePage } from './pages/home.page';

test.describe('{{projectName}} smoke', () => {
  test('홈 페이지 로드', async ({ page }) => {
    const home = new HomePage(page);
    await test.step('홈 페이지 열기', async () => {
      await home.goto();
    });
    await test.step('페이지 제목 확인', async () => {
      await home.expectTitle();
    });
    await test.step('화면 본문이 보이는지 확인', async () => {
      await expect(page.locator('body')).toBeVisible();
    });
  });
});
