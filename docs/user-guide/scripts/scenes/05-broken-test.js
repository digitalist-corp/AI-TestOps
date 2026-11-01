// 3장 "막힌 곳"을 보여 주려고 일부러 실패하는 테스트를 만든다 + 9장 코드 편집기 사진.
//  1) 녹화: 로그인 → 상품 자세히 → 장바구니 담기 → 장바구니 → [주문하기](결제 화면) → tests/guide-broken.spec.ts 로 저장
//     (코드 편집기에는 새 파일 만들기 버튼이 없어 녹화의 "저장 경로"로 파일을 만든다)
//  2) 설정 › 코드 편집기에서 그 파일을 열어 결제 화면에 없는 버튼을 누르는 줄을 넣고 저장
//       await page.getByRole('button', { name: '바로구매' }).click();
// 파일이 이미 있으면 녹화는 건너뛰고, 줄이 이미 있으면 편집도 건너뛴다(편집기 사진만 다시 찍는다).

const { createRecorderDriver } = require('../lib/recorder');

const SPEC = 'tests/guide-broken.spec.ts';
const BROKEN = "  await page.getByRole('button', { name: '바로구매' }).click();";
// 테스트 이름에 괄호 같은 정규식 문자를 넣지 않는다 — 테스트 탭의 "케이스 하나만 실행"이 이름을 그대로 grep 에 넣어 못 찾는다(보고서 참고).
const TITLE = '결제 화면에서 바로구매 버튼 누르기';

module.exports = async ({ page, browser, shot, SHOP_URL, gotoTab, api, projectId, cardOf }) => {
  page.on('dialog', (d) => d.accept());
  const pid = await projectId(page);
  const files = await api(page, `/api/projects/${pid}/files`);

  if (!files.includes(SPEC)) {
    await gotoTab(page, 'recorder');
    await page.locator('#recorder-url').fill(`${SHOP_URL}/login.html`);
    await page.getByRole('button', { name: '녹화 시작' }).click();
    const rec = await createRecorderDriver(page, browser, SHOP_URL);
    try {
      await rec.screen.waitFor({ timeout: 120000 });
      await rec.waitIdle(1500);
      await rec.syncShadow('/login.html');
      await rec.mode('입력');
      await rec.openFill('#username');
      await rec.typeFill('#username', 'demo');
      await rec.openFill('#password');
      await rec.typeFill('#password', 'demo1234');
      await rec.mode('클릭');
      await rec.click('#login-submit');
      await rec.click('[data-testid="product-detail-1"]');
      await rec.click('[data-testid="add-to-cart"]');
      await rec.click('[data-testid="nav-cart"]');
      await rec.click('[data-testid="checkout-button"]');
      await page.getByPlaceholder('예: 로그인하면 대시보드가 보인다').fill(TITLE);
      await page.getByPlaceholder('tests/recorded/login.spec.ts').fill(SPEC);
      await page.getByRole('button', { name: '저장', exact: true }).click();
      await page.getByText('테스트 파일로 저장했어요').waitFor({ timeout: 20000 });
      console.log(`  · 녹화로 ${SPEC} 를 만들었습니다.`);
      await page.getByRole('button', { name: '녹화 끝내기' }).click();
      await page.waitForTimeout(800);
    } finally {
      await rec.close();
    }
  }

  // 코드 편집기
  await gotoTab(page, 'source');
  const tree = page.getByText('파일 탐색기').locator('xpath=..');
  await tree.getByText('guide-broken.spec.ts', { exact: true }).click();
  await page.locator('.monaco-editor').waitFor();
  await page.waitForTimeout(1500);

  // 원하는 내용: 기존 줄은 그대로 두고(이전에 넣은 바로구매 줄은 빼고), 마지막 "});" 바로 위에 바로구매 줄 하나.
  // 키보드로 줄을 찾아가면 자동 들여쓰기 때문에 어긋나서, 편집기에서 전체 선택 후 붙여넣기로 바꾼다.
  const before = await api(page, `/api/projects/${pid}/files/content?path=${encodeURIComponent(SPEC)}`);
  const kept = before.content
    .replace(/\s+$/, '')
    .split('\n')
    .filter((l) => !l.includes("name: '바로구매'"))
    .map((l) => (/^\s+await /.test(l) ? '  ' + l.trim() : l))
    .map((l) => (/^test\(/.test(l) ? l.replace(/^test\('[^']*'/, `test('${TITLE}'`) : l));
  const closing = kept.pop(); // "});"
  const desired = [...kept, BROKEN, closing].join('\n') + '\n';
  let edited = false;
  if (before.content !== desired) {
    // http 주소라 브라우저 클립보드 API 를 못 쓴다. 대신 편집기 입력칸에 붙여넣기 이벤트를 보낸다(Ctrl+V 와 같은 경로).
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+A');
    await page.evaluate((text) => {
      const ta = document.querySelector('.monaco-editor textarea');
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, desired);
    await page.waitForTimeout(800);
    edited = true;
  }

  const editor = page.locator('.monaco-editor').first();
  await page.mouse.move(1439, 64);
  await page.waitForTimeout(2500); // 편집기가 줄을 다시 그릴 때까지
  const saveBtn = page.getByRole('button', { name: '저장', exact: true });
  await shot(page, '73-source-editor', {
    title: '코드 편집기 — 테스트 파일을 직접 열어 고칩니다(설정 › 코드 편집기)',
    items: [
      { target: tree, label: '파일 고르기', place: 'right' },
      { target: editor.locator('.view-line').filter({ hasText: /바로구매'\s*\}\)\.click/ }).first(), label: edited ? '넣은 줄(저장 전)' : '결제 화면에 없는 버튼을 누르는 줄', place: 'bottom', pad: 4 },
      { target: saveBtn, label: '저장해야 반영', place: 'bottom-end' },
    ],
  });

  if (edited) {
    await saveBtn.click();
    await page.waitForTimeout(1500);
    const after = await api(page, `/api/projects/${pid}/files/content?path=${encodeURIComponent(SPEC)}`);
    const ok = after.content.replace(/\s+$/, '') === desired.replace(/\s+$/, '');
    console.log(`  · 바로구매 줄 저장: ${ok ? '확인' : '확인 필요'}`);
    if (!ok) console.log(after.content);
  }

  // AI 수정 도움 버튼(AI 켬일 때만)
  const aiBtn = page.getByRole('button', { name: 'AI 수정 도움' });
  if (await aiBtn.isVisible().catch(() => false)) {
    await shot(page, '74-source-ai-help', {
      title: 'AI 수정 도움 — 열린 파일을 AI에게 고쳐 달라고 할 수 있습니다(AI 켬)',
      clip: aiBtn.locator('xpath=../..'),
      clipPad: 12,
      zoom: 1.4,
      items: [{ target: aiBtn, label: 'AI에게 수정 요청', place: 'bottom' }],
    });
  }
};
