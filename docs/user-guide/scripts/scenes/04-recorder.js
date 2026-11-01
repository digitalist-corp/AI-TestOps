// 4장 클릭으로 만들기(녹화): 로그인 → 상품 자세히 → 장바구니 담기 → 장바구니 → "보이는지 확인" → 코드 보기 → 저장 → 바로 실행.
// AI 없이 동작하는 기능이다. 다시 찍을 때 저장 경로(tests/recorded/guide-cart.spec.ts)가 이미 있으면
// 같은 테스트가 둘이 되지 않도록 코드 보기까지만 찍고 저장하지 않은 채 녹화를 끝낸다(26 사진은 그대로 둔다).

const { createRecorderDriver } = require('../lib/recorder');

const SPEC = 'tests/recorded/guide-cart.spec.ts';
const TITLE = '로그인 후 상품을 장바구니에 담는다';

module.exports = async ({ page, browser, shot, SHOP_URL, gotoTab, api, projectId, unionBox, cardOf }) => {
  page.on('dialog', (d) => {
    console.log(`  · 브라우저 확인 창: ${d.message().split('\n')[0]}`);
    d.accept();
  });
  const pid = await projectId(page);
  await gotoTab(page, 'recorder');

  // 시작 화면
  const urlInput = page.locator('#recorder-url');
  await urlInput.waitFor();
  await urlInput.fill(`${SHOP_URL}/login.html`);
  await shot(page, '20-recorder-start', {
    title: '클릭으로 만들기 — 사이트를 직접 눌러 보여 주면 테스트가 됩니다(AI 없이)',
    items: [
      { target: page.locator('ol').first(), label: '세 단계로 끝', place: 'right' },
      { target: urlInput, label: '어느 화면에서 시작할지', place: 'top' },
      { target: page.getByRole('button', { name: '녹화 시작' }), label: '녹화 시작', place: 'left' },
    ],
  });
  await page.getByRole('button', { name: '녹화 시작' }).click();

  const rec = await createRecorderDriver(page, browser, SHOP_URL);
  try {
    await rec.screen.waitFor({ timeout: 120000 });
    await rec.waitIdle(1500);
    await rec.syncShadow('/login.html');

    // 아이디 입력
    await rec.mode('입력');
    await rec.openFill('#username');
    await page.getByRole('textbox', { name: '입력할 값' }).fill('demo');
    await shot(page, '22-recorder-fill', {
      title: '입력 — 입력칸을 누르면 작은 창이 뜹니다. 값을 넣고 Enter',
      items: [
        { target: page.getByRole('radiogroup', { name: '녹화 모드' }).getByRole('radio', { name: '입력' }), label: '입력 모드', place: 'bottom' },
        { target: cardOf(page.getByRole('textbox', { name: '입력할 값' })), label: '넣을 값을 적고 Enter', place: 'right' },
      ],
    });
    await page.keyboard.press('Enter');
    await rec.shadow.fill('#username', 'demo');
    await rec.waitIdle();

    // 비밀번호 — 값은 코드에 남지 않고 환경변수 LOGIN_PASSWORD 로 들어간다
    await rec.openFill('#password');
    await page.getByRole('textbox', { name: '입력할 값' }).fill('demo1234');
    await page.keyboard.press('Enter');
    await rec.shadow.fill('#password', 'demo1234');
    await rec.waitIdle();
    const steps0 = cardOf(page.getByRole('heading', { name: /기록된 단계/ }));
    const pwRow = steps0.locator('li').filter({ hasText: 'LOGIN_PASSWORD' }).first();
    await shot(page, '23-recorder-password', {
      title: '비밀번호는 값 대신 "환경변수 LOGIN_PASSWORD"로 기록됩니다',
      clip: steps0.locator('ol'),
      clipPad: 8,
      zoom: 1.6,
      items: [{ target: pwRow.getByText(/^\s*환경변수 LOGIN_PASSWORD/).last(), label: '비밀번호 값은 코드에 안 남음', place: 'top', pad: 4 }],
    });

    // 클릭 모드 — 마우스를 올리면 무엇을 누를지 미리 보여 준다
    await rec.mode('클릭');
    await rec.hover('#login-submit');
    const tip = page.locator('[role="group"][aria-label^="원격 브라우저 화면"] .font-mono').first();
    await shot(page, '21-recorder-hover', {
      title: '마우스를 올리면 — 누를 곳에 파란 테두리와 이름표(셀렉터)가 뜹니다',
      keepMouse: true,
      items: [
        { target: page.getByRole('radiogroup', { name: '녹화 모드' }), label: '누를 때 할 일 고르기', place: 'bottom' },
        { target: await rec.boxOf('#login-submit'), label: '여기를 누르면 기록', place: 'left', pad: 10 },
        { target: tip, label: '자동으로 붙는 이름표', place: 'right', pad: 6 },
      ],
    });
    await rec.click('#login-submit');

    // 상품 → 자세히 보기 → 장바구니 담기 → 장바구니
    await rec.click('[data-testid="product-detail-1"]');
    await rec.click('[data-testid="add-to-cart"]');
    await rec.click('[data-testid="nav-cart"]');

    // 확인: 보이는지 — 장바구니에 담긴 상품 이름
    await rec.mode('확인: 보이는지');
    await rec.click('[data-testid="cart-row-1"] .cart-item-name', { mirror: false });

    const stepList = cardOf(page.getByRole('heading', { name: /기록된 단계/ }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await shot(page, '24-recorder-steps', {
      title: '기록된 단계 — 누른 순서대로 쌓입니다. 고치기 · 지우기 · 순서 바꾸기 가능',
      items: [
        { target: page.getByRole('radiogroup', { name: '녹화 모드' }).getByRole('radio', { name: '확인: 보이는지' }), label: '확인할 곳 지정', place: 'bottom' },
        { target: stepList, label: '기록된 단계 목록', place: 'left' },
      ],
    });

    // 이름 · 저장 경로
    const titleInput = page.getByPlaceholder('예: 로그인하면 대시보드가 보인다');
    const pathInput = page.getByPlaceholder('tests/recorded/login.spec.ts');
    await titleInput.fill(TITLE);
    const spec = SPEC;
    const files = await api(page, `/api/projects/${pid}/files`).catch(() => []);
    const alreadySaved = files.includes(spec);
    await pathInput.fill(spec);
    await pathInput.scrollIntoViewIfNeeded();

    await page.getByRole('button', { name: '코드 보기' }).click();
    const codeDialog = page.getByRole('dialog').filter({ hasText: '만들어진 테스트 코드' });
    await codeDialog.locator('pre').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    await shot(page, '25-recorder-code', {
      title: '코드 보기 — 직접 쓰지 않아도 Playwright 테스트 코드가 만들어집니다',
      items: [
        { target: codeDialog.locator('pre, .monaco-editor').first(), label: '자동으로 만든 테스트 코드', place: 'left' },
        { target: codeDialog.getByRole('button', { name: '복사' }), label: '복사', place: 'top' },
      ],
    });
    await codeDialog.getByRole('button', { name: /닫기|확인/ }).last().click();
    await page.waitForTimeout(500);

    if (alreadySaved) {
      console.log(`  · ${spec} 이(가) 이미 있어 저장하지 않고 녹화를 끝냅니다(26 사진은 이전 것 유지).`);
      await page.getByRole('button', { name: '녹화 끝내기' }).click();
      await page.waitForTimeout(1000);
      return;
    }
    await page.getByRole('button', { name: '저장', exact: true }).click();
    const savedMsg = page.getByText('테스트 파일로 저장했어요');
    await savedMsg.waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await shot(page, '26-recorder-saved', {
      title: '저장 — 테스트 파일이 생겼습니다. [바로 실행]으로 확인해 보세요',
      items: [
        { target: await unionBox(page, titleInput, pathInput), label: '테스트 이름 · 저장 위치', place: 'top' },
        { target: cardOf(savedMsg), label: '저장 완료', place: 'top' },
        { target: page.getByRole('button', { name: '바로 실행' }), label: '바로 실행', place: 'right' },
      ],
    });
    console.log(`  · 저장한 파일: ${spec}`);
    await page.getByRole('button', { name: '바로 실행' }).click();
    await page.waitForTimeout(3000);
    console.log(`  · 바로 실행 뒤 주소: ${page.url()}`);
  } finally {
    await rec.close();
  }
};
