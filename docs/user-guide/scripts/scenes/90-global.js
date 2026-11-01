// 10장 전역 메뉴 — 왼쪽 세로 줄(레일)의 화면들.
// ⚠ AI 설정 · 사용자 관리 화면 아래쪽에는 API 키 칸이 있다. 그 부분은 가리지 않고 아예 잘라 내서(clip) 찍는다.

module.exports = async ({ page, shot, APP_URL, cardOf, unionBox, scrollToTop }) => {
  // 레일 — 작아서 부분 확대
  await page.goto(`${APP_URL}/projects`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const rail = (to) => page.locator(`nav a[href="${to}"]:not([title="AI-TestOps"])`);
  await shot(page, '90-rail', {
    title: '왼쪽 세로 줄 — 어느 화면에서나 보이는 전체 메뉴',
    clip: { x: 0, y: 0, width: 330, height: 330 },
    clipPad: 0,
    zoom: 1.6,
    items: [
      { target: rail('/projects'), label: '프로젝트 목록', place: 'right', pad: 2 },
      { target: rail('/runners'), label: 'Runner 컨테이너', place: 'right', pad: 2 },
      { target: rail('/templates'), label: 'Playwright 템플릿', place: 'right', pad: 2 },
      { target: rail('/ai-settings'), label: 'AI 설정 · 사용량', place: 'right', pad: 2 },
      { target: rail('/users'), label: '사용자 관리', place: 'right', pad: 2 },
    ],
  });

  // AI 설정 — 위쪽 "사용할 AI" 고르는 부분만(API 키 칸 위에서 자른다)
  await page.goto(`${APP_URL}/ai-settings`);
  const provider = page.getByRole('heading', { name: '사용할 AI' });
  await provider.waitFor();
  await page.waitForTimeout(800);
  const pBox = await provider.boundingBox();
  const kBox = await page.getByText('API 키', { exact: true }).first().boundingBox();
  const claude = page.locator('button, label').filter({ hasText: 'Claude (Anthropic)' }).first();
  const gpt = page.locator('button, label').filter({ hasText: 'GPT (OpenAI)' }).first();
  const top = pBox.y - 44;
  await shot(page, '91-ai-settings', {
    title: 'AI 설정 — 모든 AI 기능이 쓸 AI(공급자)를 고릅니다',
    clip: { x: 80, y: top, width: 1336, height: kBox.y - top - 26 },
    clipPad: 0,
    items: [
      { target: await unionBox(page, claude, gpt), label: '쓸 AI를 눌러 고르기', place: 'right' },
      { target: gpt.getByText('사용 중'), label: '지금 쓰는 AI', place: 'top', pad: 3 },
      { target: cardOf(page.getByRole('heading', { name: /단가/ })), label: '단가를 넣으면 비용을 추정', place: 'inside' },
    ],
  });

  // AI 사용량 — 아래쪽 사용량 카드
  const usage = page.getByRole('heading', { name: '사용량', exact: true });
  await scrollToTop(page, usage, 80);
  await page.waitForTimeout(600);
  const uCard = cardOf(usage);
  const uBox = await uCard.boundingBox();
  await shot(page, '92-ai-usage', {
    title: 'AI 사용량 — AI를 얼마나 썼는지 공급자 · 기능별로 봅니다',
    clip: { x: 72, y: Math.max(64, uBox.y - 8), width: 1352, height: Math.min(uBox.height + 16, 836 - Math.max(64, uBox.y - 8)) },
    clipPad: 0,
    items: [
      { target: page.getByRole('button', { name: '30일' }).locator('xpath=..'), label: '기간 바꾸기', place: 'left' },
      { target: page.getByRole('heading', { name: '기능별' }), label: '어떤 기능에 많이 썼는지', place: 'right' },
    ],
  });

  // 사용자 관리 — 표 부분만(아래 AI 키 칸은 자른다)
  await page.goto(`${APP_URL}/users`);
  await page.getByRole('heading', { name: '사용자 관리' }).waitFor();
  await page.waitForTimeout(1000);
  const aBox = await page.getByRole('heading', { name: 'AI 설정' }).boundingBox();
  await shot(page, '93-users', {
    title: '사용자 관리 — 함께 쓸 사람의 계정을 만듭니다(관리자 전용)',
    clip: { x: 56, y: 56, width: 1384, height: Math.min(360, aBox.y - 56 - 40) },
    clipPad: 0,
    items: [
      { target: page.getByRole('button', { name: '사용자 등록' }), label: '새 계정 만들기', place: 'left' },
      { target: page.locator('.ag-row').first().locator('button, svg').last(), label: '연필: 역할 · 비밀번호 바꾸기', place: 'bottom-end', pad: 8 },
    ],
  });

  // Runner 컨테이너
  await page.goto(`${APP_URL}/runners`);
  await page.getByRole('heading', { name: /Runner 컨테이너/ }).waitFor();
  await page.waitForTimeout(1200);
  await shot(page, '94-runners', {
    title: 'Runner 컨테이너 — 테스트를 돌리는 실행 상자(컨테이너)의 상태',
    items: [
      { target: cardOf(page.getByRole('heading', { name: 'Runner 현황' })), label: '지금 도는 실행 상자 수', place: 'inside' },
      { target: cardOf(page.getByRole('heading', { name: '호스트/도커 현황' })), label: '서버 자원(CPU · 메모리)', place: 'inside' },
      { target: page.getByRole('button', { name: '미사용 Runner 삭제' }), label: '안 쓰는 상자 정리', place: 'bottom' },
    ],
  });

  // Playwright 템플릿
  await page.goto(`${APP_URL}/templates`);
  await page.getByRole('heading', { name: 'Playwright 템플릿' }).waitFor();
  await page.waitForTimeout(1200);
  await shot(page, '95-templates', {
    title: 'Playwright 템플릿 — 새 프로젝트에 처음 깔리는 테스트 코드 묶음',
    items: [{ target: page.getByRole('heading', { name: '기본 점검' }), label: '기본으로 쓰는 템플릿', place: 'bottom' }],
  });
};
