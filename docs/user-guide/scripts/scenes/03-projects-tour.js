// 1장 프로젝트 목록 · 프로젝트 화면 둘러보기 · 6장 AI 스위치 켬/끔 비교.
// 목록에 다른 테스트 프로젝트가 있으므로 검색창에 "데모"를 넣어 거른 뒤 찍는다.

module.exports = async ({ page, shot, APP_URL, gotoTab, setAi, unionBox }) => {
  await page.goto(`${APP_URL}/projects`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await setAi(page, true);
  const search = page.getByPlaceholder('프로젝트명, 주소, 담당자 검색');
  await search.fill('데모');
  await page.waitForTimeout(800);
  const title = page.getByText('데모샵', { exact: true }).first();
  const card = page.locator('div').filter({ has: title }).filter({ has: page.locator('button[title="삭제"]') }).last();
  await shot(page, '02-projects-list', {
    title: '프로젝트 목록 — 테스트할 사이트마다 카드가 하나씩 있습니다',
    items: [
      { target: search, label: '이름 · 주소로 찾기', place: 'bottom' },
      { target: page.getByRole('button', { name: '프로젝트 등록' }), label: '새 사이트 등록', place: 'bottom-end' },
      { target: card.getByRole('button', { name: '실행' }), label: '모든 테스트 바로 실행', place: 'bottom' },
      { target: card.getByRole('button', { name: '열기' }), label: '작업 화면으로 들어가기', place: 'bottom-end' },
      { target: card.locator('button[title="결과 리포트"]').locator('xpath=..'), label: '결과 · 소스 · 환경변수 · 수정 · 삭제', place: 'right' },
    ],
  });
  await search.fill('');

  // 프로젝트 화면 둘러보기 — 대시보드에서 상단바 · 탭
  await gotoTab(page, 'dashboard');
  await page.waitForTimeout(800);
  const tab = (label) => page.locator(`a[aria-label="${label}"]`).first();
  await shot(page, '03-project-tour', {
    title: '프로젝트 화면 — 위쪽 탭으로 하는 일을 바꿉니다',
    items: [
      { target: page.locator('button[title="프로젝트 전환 (Ctrl+K)"]'), label: '다른 프로젝트로 바꾸기', place: 'bottom' },
      { target: await unionBox(page, tab('대시보드'), tab('AI')), label: '작업 탭: 대시보드 · 구조 · 테스트 · 실행 · 설정 · AI', place: 'bottom' },
      { target: page.getByRole('button', { name: '도움말 열기' }), label: '이 화면 설명', place: 'bottom' },
      { target: page.getByRole('switch', { name: 'AI 기능' }), label: 'AI 켜고 끄기', place: 'bottom-end' },
      { target: page.getByRole('button', { name: '전체 실행' }).first(), label: '모든 테스트 실행', place: 'left' },
      { target: page.getByRole('button', { name: 'AI 채팅 열기' }), label: 'AI 채팅', place: 'left' },
    ],
  });

  // AI 스위치: 켬 → 끔 (같은 화면)
  const aiTabBox = await tab('AI').boundingBox();
  const chatBox = await page.getByRole('button', { name: 'AI 채팅 열기' }).boundingBox();
  await shot(page, '41-ai-on', {
    title: 'AI 켬 — AI 탭과 오른쪽 아래 AI 채팅 버튼이 보입니다',
    items: [
      { target: page.getByRole('switch', { name: 'AI 기능' }), label: '스위치 켬(파란색)', place: 'bottom-end' },
      { target: tab('AI'), label: 'AI 탭이 생김', place: 'bottom' },
      { target: page.getByRole('button', { name: 'AI 채팅 열기' }), label: 'AI 채팅 버튼', place: 'left' },
    ],
  });
  await setAi(page, false);
  await page.waitForTimeout(800);
  await shot(page, '40-ai-off', {
    title: 'AI 끔 — 화면은 그대로, AI 기능만 사라집니다',
    items: [
      { target: page.getByRole('switch', { name: 'AI 기능' }), label: '스위치 끔(회색)', place: 'bottom-end' },
      { target: { x: aiTabBox.x, y: aiTabBox.y, width: aiTabBox.width, height: aiTabBox.height }, label: 'AI 탭 없음', place: 'bottom' },
      { target: chatBox, label: 'AI 채팅 버튼 없음', place: 'left' },
    ],
  });
  await setAi(page, true);
};
