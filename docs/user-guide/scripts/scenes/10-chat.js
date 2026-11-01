// 8장 AI 채팅: 오른쪽 아래 버튼 → 넓게 보기 → 질문 2개.
//  ① "이 프로젝트의 실행 결과를 상태별로 세어 줘" — DB 조회 도구 카드 · 표
//  ② "실패한 테스트를 다시 실행해 줘" — 허락 카드(허용 / 이 대화에서 항상 허용 / 거부)
// 스트리밍(답을 쓰는 중) 장면도 한 장 찍는다. AI 를 실제로 부른다.

const Q1 = '이 프로젝트의 실행 결과를 상태별로 세어 줘';
const Q2 = '실패한 테스트를 다시 실행해 줘';

module.exports = async ({ page, shot, gotoTab, setAi }) => {
  await gotoTab(page, 'dashboard');
  await setAi(page, true);
  const openBtn = page.getByRole('button', { name: 'AI 채팅 열기' });
  await shot(page, '60-chat-button', {
    title: 'AI 채팅 — 어느 화면에서나 오른쪽 아래 버튼(또는 Ctrl + /)',
    clip: { x: 1040, y: 560, width: 400, height: 340 },
    clipPad: 0,
    zoom: 1.5,
    items: [{ target: openBtn, label: '눌러서 AI 채팅 열기', place: 'top' }],
  });
  await openBtn.click();
  const panel = page.locator('[aria-label="AI 어시스턴트"]');
  await panel.waitFor();
  // 새 대화로 시작
  const newChat = panel.getByRole('button', { name: '새 대화' }).first();
  if (await newChat.isVisible().catch(() => false)) await newChat.click();
  await page.waitForTimeout(800);
  const wideBtn = panel.getByRole('button', { name: '넓게 보기' });
  if (await wideBtn.isVisible().catch(() => false)) await wideBtn.click();
  await page.waitForTimeout(800);
  const input = panel.getByPlaceholder(/무엇이든 물어보세요/);
  await input.fill(Q1);
  await shot(page, '61-chat-open', {
    title: 'AI 채팅 창 — 이 프로젝트에 대해 무엇이든 물어봅니다',
    items: [
      { target: panel.getByRole('button', { name: /작게 보기|넓게 보기/ }), label: '넓게 · 작게 보기', place: 'bottom' },
      { target: panel.getByRole('button', { name: '새 대화' }).first(), label: '새 대화', place: 'bottom' },
      { target: input, label: '질문을 쓰고 Enter', place: 'top' },
    ],
  });

  // ① DB 조회 — 스트리밍 중간 장면
  await input.press('Enter');
  const cursor = panel.locator('[aria-label="작성 중 커서"]');
  const t0 = Date.now();
  let tookStream = false;
  while (Date.now() - t0 < 90000) {
    const text = await panel.innerText().catch(() => '');
    const writing = await cursor.isVisible().catch(() => false);
    if (writing && text.length > 80) {
      await shot(page, '62-chat-streaming', {
        title: '답을 쓰는 중 — 글자가 실시간으로 이어서 나옵니다(중단 가능)',
        settle: 0,
        items: [
          { target: cursor, label: '지금 쓰는 중', place: 'right', pad: 6 },
          { target: panel.getByRole('button', { name: '중단' }), label: '그만 쓰게 하기', place: 'top' },
        ],
      });
      tookStream = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (!tookStream) console.log('  ! 스트리밍 중간 장면을 잡지 못했습니다.');
  await waitAnswer(page, panel);
  // 도구 카드 펼치기(표)
  const toolHeader = panel.locator('button[aria-expanded="false"]').filter({ hasText: /조회|DB|query|sql/i }).first();
  if (await toolHeader.isVisible().catch(() => false)) {
    await toolHeader.click();
    await page.waitForTimeout(800);
  }
  const table = panel.locator('table').last();
  if (await table.isVisible().catch(() => false)) await table.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, '63-chat-db', {
    title: '질문 ① 실행 결과를 상태별로 세어 줘 — AI가 데이터를 직접 조회해 표로 보여 줍니다',
    items: [
      { target: panel.getByText('DB 조회').first(), label: 'AI가 쓴 도구(DB 조회)', place: 'right', pad: 6 },
      ...((await table.isVisible().catch(() => false)) ? [{ target: table, label: '조회 결과 표', place: 'top' }] : []),
    ],
  });

  // ② 다시 실행 — 허락 카드
  await input.fill(Q2);
  await input.press('Enter');
  const allow = panel.getByRole('button', { name: '허용', exact: true });
  await allow.waitFor({ timeout: 60000 }).catch(() => {});
  if (!(await allow.isVisible().catch(() => false))) {
    // AI 가 먼저 글로 되묻는 경우가 있다. 사람처럼 "네"라고 답하면 허락 카드가 나온다.
    await waitAnswer(page, panel);
    await input.fill('네, 실행해 주세요');
    await input.press('Enter');
    await allow.waitFor({ timeout: 120000 }).catch(() => {});
  }
  if (await allow.isVisible().catch(() => false)) {
    await allow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const permCard = cardOf2(allow);
    await shot(page, '64-chat-permission', {
      title: '질문 ② 실패한 테스트를 다시 실행해 줘 — 무언가 바꾸는 일은 먼저 허락을 받습니다',
      items: [
        { target: permCard, label: 'AI가 하려는 일', place: 'top' },
        { target: allow, label: '이번만 허용', place: 'bottom' },
        { target: panel.getByRole('button', { name: '이 대화에서 항상 허용' }), label: '이 대화 동안 계속 허용', place: 'bottom' },
        { target: panel.getByRole('button', { name: '거부', exact: true }), label: '거부', place: 'right' },
      ],
    });
    await allow.click();
    await waitAnswer(page, panel, 180000);
    await page.waitForTimeout(1500);
    await shot(page, '65-chat-after-allow', {
      title: '허용하면 — AI가 테스트를 다시 실행하고 결과를 알려 줍니다',
      items: [{ target: panel.getByText('허용함').first(), label: '허용한 기록', place: 'right', pad: 4 }],
    });
  } else {
    console.log('  ! 허락 카드가 나오지 않았습니다.');
    await shot(page, '64-chat-permission', { title: '질문 ② 실패한 테스트를 다시 실행해 줘' });
  }
};

function cardOf2(locator) {
  return locator.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " border ")][1]');
}

async function waitAnswer(page, panel, timeout = 150000) {
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  while (Date.now() - t0 < timeout) {
    const busy = await panel.getByRole('button', { name: '중단' }).isVisible().catch(() => false);
    const waitingPerm = await panel.getByRole('button', { name: '허용', exact: true }).isVisible().catch(() => false);
    if (!busy || waitingPerm) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000);
}
