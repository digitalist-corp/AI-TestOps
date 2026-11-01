// 2장 프로젝트 등록 → AI 첫 테스트 진행 창 → 로그인 정보 요청 카드 → 결과.
// 실제로 프로젝트를 만든다. "데모샵" 프로젝트가 이미 있으면 등록은 건너뛴다.
// 다시 찍으려면 GUIDE_RECREATE=1 로 돌린다 — 화면의 [삭제] 버튼으로 기존 "데모샵"을 지우고 새로 등록한다(테스트 · 실행 이력도 함께 지워진다).
// 실행 방식은 "일회용 컨테이너"를 고른다. 기본값 "서버에서 바로 실행"은 이 환경에서 테스트 실행 단계가
// "상주 Docker Runner가 중지되어 있습니다" 오류로 멈춘다(보고서 참고).

const INSTRUCTION = '로그인 후 상품을 장바구니에 담는지 확인';

module.exports = async ({ page, shot, APP_URL, SHOP_URL, findProject, setAi, cardOf, unionBox, PROJECT_NAME }) => {
  const existing = await findProject(page);
  const photosOnly = process.env.GUIDE_PHOTOS_ONLY === '1';
  if (existing && !photosOnly && process.env.GUIDE_RECREATE !== '1') {
    console.log(`  · "${PROJECT_NAME}" 프로젝트가 이미 있어 등록 장면을 건너뜁니다(GUIDE_RECREATE=1 이면 지우고 다시 등록).`);
    return;
  }
  await page.goto(`${APP_URL}/projects`);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (existing && !photosOnly) {
    await page.getByPlaceholder('프로젝트명, 주소, 담당자 검색').fill(PROJECT_NAME);
    const card = page.locator('div.rounded-md, article, div').filter({ has: page.getByText(PROJECT_NAME, { exact: true }) }).filter({ has: page.locator('button[title="삭제"]') }).last();
    page.once('dialog', (d) => d.accept());
    await card.locator('button[title="삭제"]').click();
    await page.waitForTimeout(2000);
    await page.getByPlaceholder('프로젝트명, 주소, 담당자 검색').fill('');
    console.log(`  · 기존 "${PROJECT_NAME}" 프로젝트를 지웠습니다.`);
  }
  await setAi(page, true);

  await page.getByRole('button', { name: '프로젝트 등록' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#baseUrl').waitFor();
  await dialog.locator('#baseUrl').fill(SHOP_URL);
  await dialog.getByRole('button', { name: '확인', exact: true }).click();
  const checkMsg = dialog.getByText(/열렸습니다|확인하지 못했습니다|응답 코드/).first();
  await checkMsg.waitFor({ timeout: 30000 });
  const reachable = /열렸습니다/.test(await checkMsg.innerText());
  if (!reachable) console.log(`  ! 사이트 확인 결과: ${await checkMsg.innerText()}`);
  await dialog.locator('#projectName').fill(PROJECT_NAME);
  await page.waitForTimeout(400);
  await shot(page, '05-register-site', {
    title: '프로젝트 등록 ① — 테스트할 사이트 주소와 이름만 넣으면 됩니다',
    items: [
      { target: dialog.locator('#baseUrl'), label: '사이트 주소 붙여넣기', place: 'bottom' },
      { target: dialog.getByRole('button', { name: '확인', exact: true }), label: '열리는지 확인', place: 'right' },
      { target: checkMsg, label: reachable ? '초록 글씨면 OK' : '로컬 주소는 확인이 막힘(등록은 됨)', place: 'bottom', pad: 4 },
      { target: dialog.locator('#projectName'), label: '알아보기 쉬운 이름', place: 'bottom' },
    ],
  });

  // 첫 테스트(AI) 영역까지 창 안에서 내린다
  const firstTest = dialog.getByRole('heading', { name: '첫 테스트' });
  await firstTest.scrollIntoViewIfNeeded();
  const toggle = cardOf(firstTest).locator('button').first();
  const textarea = cardOf(firstTest).locator('textarea');
  if (!(await textarea.isVisible().catch(() => false))) await toggle.click();
  await textarea.fill(INSTRUCTION);
  await textarea.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, '06-register-ai', {
    title: '프로젝트 등록 ② — AI에게 첫 테스트를 맡기고 [등록]을 누릅니다',
    items: [
      { target: toggle, label: 'AI 첫 테스트 켜기(파란 테두리)', place: 'top' },
      { target: textarea, label: '확인하고 싶은 것을 한 문장으로', place: 'bottom' },
      { target: dialog.getByRole('button', { name: '등록', exact: true }), label: '등록', place: 'left' },
    ],
  });

  if (process.env.GUIDE_PHOTOS_ONLY === '1') {
    console.log('  · 사진만 찍고 등록 창을 닫습니다(프로젝트는 만들지 않음).');
    await dialog.getByRole('button', { name: '취소' }).click();
    return;
  }
  // 이 환경에서는 기본 실행 방식으로 테스트가 돌지 않아(보고서 참고) 등록 직전에 일회용 컨테이너를 고른다. 사진은 이미 기본값 상태로 찍었다.
  const ephemeral = dialog.getByRole('button', { name: /일회용 컨테이너/ });
  await ephemeral.scrollIntoViewIfNeeded();
  await ephemeral.click();
  await dialog.getByRole('button', { name: '등록', exact: true }).click();

  // 첫 테스트 진행 창
  const progress = page.getByRole('dialog').filter({ hasText: 'AI 초기 테스트 케이스 생성' });
  await progress.waitFor({ timeout: 60000 });
  const start = Date.now();
  let tookProgress = false;
  let tookLogin = false;
  const credTitle = progress.getByText('이 사이트는 로그인이 필요합니다');
  const done = progress.getByText(/실제로 통과했습니다|실행에서 실패했습니다/);
  while (Date.now() - start < 15 * 60 * 1000) {
    if (!tookLogin && (await credTitle.isVisible().catch(() => false))) {
      await page.waitForTimeout(800);
      const idInput = progress.getByPlaceholder('아이디 또는 이메일');
      const pwInput = progress.getByPlaceholder('비밀번호');
      await shot(page, '08-bootstrap-login', {
        title: '로그인 화면을 만나면 — AI가 멈추고 계정을 물어봅니다',
        items: [
          { target: credTitle, label: '로그인이 필요하다는 알림', place: 'left', pad: 4 },
          { target: await unionBox(page, idInput, pwInput), label: '테스트용 계정 입력', place: 'left' },
          { target: progress.getByRole('button', { name: '저장하고 계속' }), label: '저장하고 계속', place: 'bottom' },
        ],
      });
      await idInput.fill('demo');
      await pwInput.fill('demo1234');
      await progress.getByRole('button', { name: '저장하고 계속' }).click();
      tookLogin = true;
      await credTitle.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    }
    // 진행 창: 로그인 뒤 화면을 다시 보고 테스트 코드를 쓰는 동안(창 모양이 한동안 그대로라 이때 찍는다)
    const stable = !(await credTitle.isVisible().catch(() => false)) && (await progress.locator('img').count()) >= 1;
    if (!tookProgress && stable && tookLogin) {
      await page.waitForTimeout(2500);
      const steps = progress.locator('div.rounded-lg.border').first();
      const timeline = progress.locator('div.rounded-lg.border').filter({ hasText: '현재 주소' }).first();
      await shot(page, '07-bootstrap-progress', {
        title: '첫 테스트 진행 창 — AI가 사이트를 직접 돌아보며 테스트를 만듭니다',
        items: [
          { target: steps, label: '지금 하는 단계(3단계)', place: 'left' },
          { target: progress.getByText(/현재 주소:/), label: '지금 보고 있는 주소', place: 'left', pad: 4 },
          { target: timeline.locator('.max-h-44'), label: '다녀간 주소 · 화면 썸네일', place: 'left' },
        ],
      });
      tookProgress = true;
    }
    if (await done.isVisible().catch(() => false)) break;
    await page.waitForTimeout(2000);
  }
  if (!tookLogin) console.log('  ! 로그인 정보 요청 카드가 나타나지 않았습니다.');
  await done.waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  const passed = await progress.getByText(/실제로 통과했습니다/).isVisible().catch(() => false);
  console.log(`  · 첫 테스트 결과: ${passed ? '통과' : '실패'} (${Math.round((Date.now() - start) / 1000)}초)`);
  await shot(page, '09-bootstrap-done', {
    title: passed ? '첫 테스트 완료 — AI가 만든 테스트가 실제로 통과했습니다' : '첫 테스트 결과 — 실패하면 생성된 파일은 그대로 남습니다',
    items: [
      { target: done, label: passed ? '통과! 테스트가 저장됨' : '실패 — 파일은 남아 있음', place: 'left', pad: 4 },
      { target: progress.getByRole('button', { name: '프로젝트 열기' }), label: '프로젝트로 들어가기', place: 'top' },
    ],
  });
  await progress.getByRole('button', { name: '프로젝트 열기' }).click();
  await page.waitForTimeout(1500);
};
