// 10장 알림(우상단 종) · 도움말(?) 메뉴 · 프로젝트 전환(Ctrl+K).

module.exports = async ({ page, shot, gotoTab }) => {
  await gotoTab(page, 'structure');
  await page.waitForTimeout(1500);

  // 도움말(?) — 지금 화면 설명 · 단축키
  await page.getByRole('button', { name: '도움말 열기' }).click();
  await page.waitForTimeout(700);
  const help = page.getByText(/지금 이 화면 ·/).first().locator('xpath=ancestor::*[contains(@class,"shadow")][1]');
  await shot(page, '81-help-menu', {
    title: '도움말(?) — 지금 보고 있는 화면의 설명과 단축키',
    items: [
      { target: page.getByRole('button', { name: '도움말 열기' }), label: '? 버튼', place: 'left' },
      { target: page.getByText(/지금 이 화면 ·/).first(), label: '이 화면에서 하는 일', place: 'left', pad: 4 },
      { target: page.getByText('키보드 단축키').first(), label: 'Ctrl + / : AI 채팅', place: 'left', pad: 4 },
    ],
  });
  void help;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 알림(종)
  const bell = page.getByRole('button', { name: /^알림/ }).first();
  await bell.click();
  const panel = page.getByRole('dialog', { name: '알림' });
  await panel.waitFor();
  await page.waitForTimeout(700);
  await shot(page, '80-notifications', {
    title: '알림(종) — 테스트가 끝나거나 예약 실행 결과가 나오면 여기에 쌓입니다',
    items: [
      { target: bell, label: '빨간 숫자 = 안 본 알림', place: 'left' },
      { target: panel.locator('li, a, div.border-b').nth(1), label: '알림 하나(누르면 결과로)', place: 'left' },
      { target: panel.getByRole('button', { name: '모두 지우기' }), label: '확인한 알림 지우기', place: 'left' },
    ],
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 프로젝트 전환(Ctrl+K)
  await page.locator('button[title="프로젝트 전환 (Ctrl+K)"]').click();
  const sw = page.getByRole('dialog').filter({ hasText: '프로젝트 선택' });
  await sw.waitFor();
  await sw.getByPlaceholder('프로젝트명, ID, 관리자, URL 검색').fill('데모');
  await sw.getByText('데모샵').first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, '82-project-switch', {
    title: '프로젝트 전환(Ctrl + K) — 다른 프로젝트로 바로 이동',
    items: [
      { target: sw.getByPlaceholder('프로젝트명, ID, 관리자, URL 검색'), label: '이름으로 찾기', place: 'bottom' },
    ],
  });
  await page.keyboard.press('Escape');
};
