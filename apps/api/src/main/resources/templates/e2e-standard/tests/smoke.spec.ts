import { test, expect } from './fixtures';
import { HomePage } from './pages/home.page';

test.describe('{{projectName}} smoke', () => {
  test('홈 페이지 로드', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.expectTitle();
    await expect(page.locator('body')).toBeVisible();
  });
});
