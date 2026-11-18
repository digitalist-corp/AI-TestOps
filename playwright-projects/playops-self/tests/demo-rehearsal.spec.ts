import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// 11/24 3분 시연 리허설 (#88). docs/demo/시연-순서.md 의 순서를 시연용 PM 계정으로 그대로 누르며 단계마다 화면을 남긴다.
// 수동 워크플로(demo-rehearsal.yml)가 테스트 서버에서 돌리고, 끝나면 scripts/demo-reset.sh 로 원래 상태로 되돌린다.
// 시연 PM 계정(DEMO_PM_USERNAME · DEMO_PM_PASSWORD)이 없으면 건너뛴다 — 앱의 전체 실행 · 셀프 회귀 테스트에는 끼지 않는다.

const USER = process.env.DEMO_PM_USERNAME || 'demo-pm';
const PASSWORD = process.env.DEMO_PM_PASSWORD;
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', 'demo-shots');
const PROJECT = '/projects/example.com';

test.skip(!PASSWORD, '시연 PM 계정이 없어 리허설을 건너뜁니다');
// trace · 영상에는 로그인 입력값과 요청 본문(비밀번호 원문)이 남는다 — 공개 저장소 아티팩트로 올라가지 않게 끈다
test.use({ trace: 'off', video: 'off' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(8 * 60_000);

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test('시연 순서 리허설', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.setViewportSize({ width: 1440, height: 900 });

  await test.step('1. 로그인 화면 — 게스트 버튼이 있다는 것만', async () => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '게스트로 시작' })).toBeVisible();
    await shot(page, '01-login');
    await page.fill('#username', USER);
    await page.fill('#password', PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/home');
  });

  await test.step('2. 첫 화면 · 프로젝트 카드 진척률', async () => {
    await expect(page.getByRole('heading', { name: '내가 맡은 프로젝트' })).toBeVisible();
    await expect(page.getByText('Example.com Demo').first()).toBeVisible();
    await shot(page, '02-home');
    await page.goto('/projects');
    await expect(page.getByText('Example.com Demo').first()).toBeVisible();
    await shot(page, '03-projects');
  });

  await test.step('3. 계획 표 — 사용 체크 · 담당자 · 마감일', async () => {
    await page.goto(`${PROJECT}/plan`);
    await expect(page.getByText('문의하기 링크가 보인다')).toBeVisible();
    await shot(page, '04-plan');
  });

  await test.step('4. 실행 · 중지', async () => {
    await page.getByRole('button', { name: '전체 실행' }).first().click();
    const stop = page.getByRole('button', { name: '실행 중지' });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await shot(page, '05-running');
    await stop.click().catch(() => {}); // 아주 빨리 끝나면 누를 틈이 없을 수 있다
    await expect(page.getByRole('button', { name: '전체 실행' }).first()).toBeVisible({ timeout: 120_000 });
    await shot(page, '06-stopped');
  });

  await test.step('5. 결함', async () => {
    await page.goto(`${PROJECT}/defects`);
    await expect(page.getByText('미해결 1 · 해결 0')).toBeVisible();
    await shot(page, '07-defects');
  });

  await test.step('6. 타임라인 — 실패 단계 · 화면 · 영상', async () => {
    await page.getByRole('button', { name: '문의하기 링크가 보인다' }).click();
    await expect(page.getByText('단계별 실행 기록')).toBeVisible();
    await expect(page.getByText("'문의하기' 링크가 보이는지 확인").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByAltText('실패 시점 화면')).toBeVisible();
    await shot(page, '08-timeline');
  });

  await test.step('7. 코드 편집기에서 링크 이름 고치기 (tests/demo.spec.ts 13번째 줄)', async () => {
    await page.goto(`${PROJECT}/source`);
    const file = page.getByRole('button', { name: 'demo.spec.ts', exact: true });
    const folder = page.getByRole('button', { name: 'tests', exact: true });
    await expect(folder).toBeVisible({ timeout: 15_000 });
    // 폴더가 접혀 있으면 한 번 펼친다 (지난번에 펼쳐 둔 상태가 남아 있을 수 있다)
    if (!(await file.isVisible())) await folder.click();
    await file.click({ timeout: 15_000 });
    // Monaco 는 줄 안의 공백을 줄바꿈 없는 공백(U+00A0)으로 그려서 \s 로 맞춘다
    const line = page.locator('.monaco-editor .view-line', { hasText: /name:\s'문의하기'/ });
    await expect(line).toBeVisible({ timeout: 20_000 });
    await line.getByText('문의하기').last().dblclick();
    // 한 글자씩 치면 편집기 자동완성이 끼어든다 — 한 번에 넣는다 (사람이 칠 때는 뜬 창을 Esc 로 닫는다)
    await page.keyboard.insertText('Learn more');
    await expect(page.locator('.monaco-editor .view-line', { hasText: /name:\s'Learn\smore'/ })).toBeVisible();
    await shot(page, '09-editor');
    await page.getByRole('button', { name: '저장' }).click();
    await expect(page.getByRole('button', { name: '저장' })).toBeDisabled({ timeout: 10_000 });
  });

  await test.step('8. 결함 다시 실행 → 해결', async () => {
    await page.goto(`${PROJECT}/defects`);
    await page.getByLabel('문의하기 링크가 보인다 고르기').check();
    await page.getByRole('button', { name: '고른 1건 다시 실행' }).click();
    await page.waitForURL('**/runs');
    await shot(page, '10-rerun');
    await expect(async () => {
      await page.goto(`${PROJECT}/defects`);
      await page.getByLabel('상태').selectOption('');
      await expect(page.getByText('미해결 0 · 해결 1')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 180_000, intervals: [5_000] });
    await shot(page, '11-resolved');
  });
});
