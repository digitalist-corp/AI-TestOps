// 5장 테스트 탭(케이스 목록 · 선택 실행 · 묶음) → 실행 탭(실시간 로그 · 실행 이력) → 결과(리포트 · 아티팩트) → 대시보드.
// 녹화한 "장바구니 담기" 테스트와 일부러 실패하게 만든 "바로구매" 테스트 두 개를 골라 함께 돌린다.

const SUITE = '장바구니 회귀 묶음';
const BROKEN_TITLE = '결제 화면에서 바로구매 버튼 누르기';
const CART_TITLE = '로그인 후 상품을 장바구니에 담는다';

module.exports = async ({ page, shot, gotoTab, cardOf, api, projectId }) => {
  page.on('dialog', (d) => {
    console.log(`  · 브라우저 확인 창: ${d.message().split('\n')[0]}`);
    d.accept();
  });
  const pid = await projectId(page);
  await gotoTab(page, 'scenarios');
  await page.getByText(/개 spec/).waitFor();
  await page.waitForTimeout(800);

  const broken = page.locator(`input[aria-label="${BROKEN_TITLE} 선택"]`);
  const cart = page.locator(`input[aria-label="${CART_TITLE} 선택"]`).last();
  await broken.check();
  await cart.check();
  await page.waitForTimeout(400);
  const brokenRow = broken.locator('xpath=ancestor::*[self::tr or @role="row"][1]');
  await shot(page, '30-tests-list', {
    title: '테스트 탭 — 파일별로 테스트(케이스)가 보이고, 골라서 실행합니다',
    items: [
      { target: await unionBoxOf(page, broken, cart), label: '실행할 테스트 체크', place: 'left' },
      { target: page.getByRole('button', { name: '선택 케이스 실행' }), label: '고른 것만 실행', place: 'bottom' },
      { target: page.getByRole('button', { name: '묶음으로 저장' }), label: '자주 쓰는 조합 저장', place: 'top' },
      { target: brokenRow.locator('button[title="케이스 실행"]'), label: '이것 하나만 실행', place: 'left' },
      { target: page.getByRole('heading', { name: '케이스 실행 이력' }), label: '이름을 누르면 지난 결과', place: 'bottom' },
    ],
  });

  // 묶음으로 저장
  await page.getByRole('button', { name: '묶음으로 저장' }).click();
  const suiteDialog = page.getByRole('dialog').filter({ hasText: '테스트 묶음으로 저장' });
  await suiteDialog.waitFor();
  const suites = await api(page, `/api/projects/${pid}/test-suites`).catch(() => []);
  const exists = Array.isArray(suites) && suites.some((s) => s.name === SUITE);
  await suiteDialog.getByPlaceholder('예: 로그인/결제 회귀 묶음').fill(exists ? `${SUITE} 2` : SUITE);
  await page.waitForTimeout(300);
  await shot(page, '31-tests-suite', {
    title: '테스트 묶음 — 고른 테스트에 이름을 붙여 두고 한 번에 다시 실행',
    items: [
      { target: suiteDialog.getByPlaceholder('예: 로그인/결제 회귀 묶음'), label: '묶음 이름', place: 'bottom' },
      { target: suiteDialog.getByText('순차 실행 (병렬 끄기)'), label: '하나씩 차례로 돌리기', place: 'bottom', pad: 4 },
      { target: suiteDialog.getByRole('button', { name: '저장', exact: true }), label: '저장', place: 'left' },
    ],
  });
  if (exists) {
    await suiteDialog.getByRole('button', { name: '취소' }).click();
  } else {
    await suiteDialog.getByRole('button', { name: '저장', exact: true }).click();
  }
  await page.waitForTimeout(1200);

  // 선택 케이스 실행 → 실행 탭으로 이동
  await page.getByRole('button', { name: '선택 케이스 실행' }).click();
  await page.waitForURL(/\/runs/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const streaming = page.getByText('스트리밍 중...');
  await streaming.waitFor({ timeout: 90000 }).catch(() => {});
  // 로그가 몇 줄 쌓이면 찍는다
  await page.waitForTimeout(9000);
  const logPanel = page.locator('pre, div.font-mono').filter({ hasText: '[' }).first();
  await shot(page, '32-runs-live', {
    title: '실행 중 — 진행 로그가 실시간으로 흐릅니다',
    items: [
      { target: page.locator('.ag-row').first(), label: '방금 시작한 실행', place: 'bottom' },
      { target: streaming, label: '지금 흐르는 중', place: 'left', pad: 4 },
      { target: logPanel, label: '실시간 진행 로그', place: 'top-end' },
    ],
  });

  // 끝날 때까지 기다린다(최대 5분)
  const start = Date.now();
  while (Date.now() - start < 5 * 60 * 1000) {
    const list = await api(page, `/api/projects/${pid}/executions`);
    const latest = list.sort((a, b) => b.id - a.id)[0];
    if (latest && !['PENDING', 'RUNNING', 'CANCEL_REQUESTED'].includes(latest.status)) {
      console.log(`  · 실행 #${latest.id} 결과: ${latest.status}`);
      break;
    }
    await page.waitForTimeout(4000);
  }
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, '33-runs-history', {
    title: '실행 이력 — 지금까지 돌린 실행이 쌓입니다',
    items: [
      { target: page.locator('.ag-row').first(), label: '가장 최근 실행(눌러서 로그 보기)', place: 'bottom-end' },
      { target: page.locator('.ag-row').first().getByText(/^(실패|성공)$/), label: '성공 · 실패 표시', place: 'right', pad: 4 },
      { target: page.getByRole('button', { name: '새로고침' }).first(), label: '새로고침', place: 'bottom' },
    ],
  });

  // 케이스 하나만 실행(행의 ▷). 케이스 실행 이력은 이렇게 하나씩 돌린 실행만 보여 준다.
  await gotoTab(page, 'scenarios');
  await page.getByText(/개 spec/).waitFor();
  await page.waitForTimeout(800);
  const row = page.locator(`input[aria-label="${BROKEN_TITLE} 선택"]`).locator('xpath=ancestor::*[self::tr or @role="row"][1]');
  await row.locator('button[title="케이스 실행"]').click();
  await page.waitForTimeout(3000);
  const t0 = Date.now();
  while (Date.now() - t0 < 4 * 60 * 1000) {
    const list = await api(page, `/api/projects/${pid}/executions`);
    const latest = list.sort((a, b) => b.id - a.id)[0];
    if (latest && latest.grepFilter && !['PENDING', 'RUNNING', 'CANCEL_REQUESTED'].includes(latest.status)) {
      console.log(`  · 단독 실행 #${latest.id} 결과: ${latest.status}`);
      break;
    }
    await page.waitForTimeout(4000);
  }
};

async function unionBoxOf(page, a, b) {
  const { unionBox } = require('../lib/helpers');
  return unionBox(page, a, b);
}
