import { test, expect } from '@playwright/test';

// 시연용 (#87). 앞의 하나는 통과하고, 뒤의 하나는 이 사이트에 없는 링크를 찾아 실제로 실패한다.
// 결함 리스트 · 실패 단계(화면 · 영상) · 다시 실행을 보여 주려는 것이다. 링크 이름을 사이트에 있는 것으로 고치면 해결된다.
test.describe('시연 확인', () => {
  test('본문 제목이 보인다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('문의하기 링크가 보인다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '문의하기' })).toBeVisible({ timeout: 5000 });
  });
});
