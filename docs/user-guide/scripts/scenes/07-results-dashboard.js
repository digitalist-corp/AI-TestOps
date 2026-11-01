// 5장 결과(요약 · 실패한 케이스 · HTML 리포트 · 아티팩트) · 케이스 실행 이력 · 대시보드.
// 06 장면에서 돌린 마지막 실행(실패 1 · 통과 1)을 본다.

module.exports = async ({ page, shot, gotoTab, cardOf, scrollToTop }) => {
  await gotoTab(page, 'results');
  await page.getByRole('heading', { name: '최종 결과' }).waitFor();
  await page.waitForTimeout(1500);

  // 요약 + 실패한 케이스
  const runHeading = page.getByRole('heading', { name: /^실행 #\d+/ }).first();
  await scrollToTop(page, page.getByRole('heading', { name: '최종 결과' }), 130);
  await shot(page, '34-results-log', {
    title: '결과 탭 — 실행을 고르면 그 실행의 로그와 결과가 나옵니다',
    items: [
      { target: page.locator('select').first(), label: '볼 실행 고르기', place: 'bottom-end' },
      { target: page.locator('pre, div.font-mono').filter({ hasText: '[' }).first(), label: '실행 로그(끝부분에 요약)', place: 'inside' },
    ],
  });

  await scrollToTop(page, runHeading, 80);
  const failedHeading = page.getByRole('heading', { name: /실패한 케이스/ });
  await shot(page, '35-results-summary', {
    title: '결과 요약 — 몇 개 통과 · 실패했고, 어디서 실패했는지',
    items: [
      { target: cardOf(page.getByText('통과', { exact: true }).first()).locator('xpath=..'), label: '통과 · 실패 개수', place: 'bottom' },
      { target: failedHeading.locator('xpath=..'), label: '실패한 테스트와 오류 문장', place: 'top-end' },
    ],
  });

  // HTML 리포트
  const report = page.getByRole('heading', { name: 'HTML 리포트' });
  await scrollToTop(page, report, 80);
  await page.waitForTimeout(2500);
  await shot(page, '36-results-report', {
    title: 'HTML 리포트 — Playwright 가 만든 자세한 보고서를 화면 안에서 봅니다',
    items: [
      { target: page.locator('iframe').first(), label: '테스트별 결과 · 걸린 시간', place: 'inside' },
      { target: report.locator('xpath=..').getByRole('button').first(), label: '새 창으로 크게 보기', place: 'left' },
    ],
  });

  // 아티팩트(스크린샷 · 동영상 · 추적 파일)
  const artifacts = page.getByRole('heading', { name: '아티팩트' });
  await scrollToTop(page, artifacts, 80);
  await shot(page, '37-results-artifacts', {
    title: '아티팩트 — 실패한 순간의 스크린샷 · 동영상을 바로 열어 봅니다',
    items: [
      { target: artifacts.locator('xpath=..'), label: '눌러서 보기 · 내려받기', place: 'top-end' },
    ],
  });
  // 실패 스크린샷 열기
  const shotItem = artifacts.locator('xpath=..').getByText(/\.png$/).first();
  if (await shotItem.isVisible().catch(() => false)) {
    await shotItem.click();
    await page.waitForTimeout(2500);
    const viewer = page.getByRole('dialog').last();
    if (await viewer.isVisible().catch(() => false)) {
      await shot(page, '37b-results-failed-screenshot', {
        title: '실패한 순간의 화면 — 결제 화면에 "바로구매" 버튼이 없어 멈췄습니다',
        items: [{ target: viewer.locator('img').first(), label: '테스트가 멈춘 순간의 화면', place: 'inside' }],
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }

  // 케이스 실행 이력(테스트 탭에서 이름 클릭)
  // ⚠ 케이스 실행 이력은 행의 ▷(케이스 하나만 실행)로 돌린 실행만 보여 준다("선택 케이스 실행" 결과는 안 잡힘, 보고서 참고).
  //   06 장면 끝에서 "바로구매" 케이스를 하나만 돌려 두었다.
  await gotoTab(page, 'scenarios');
  await page.getByText(/개 spec/).waitFor();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /결제 화면에서 바로구매/ }).first().click();
  await page.waitForTimeout(1500);
  const historyCard = cardOf(page.getByRole('heading', { name: '케이스 실행 이력' }));
  if (await historyCard.getByText('실행 이력이 없습니다.').isVisible().catch(() => false)) {
    console.log('  ! "바로구매" 케이스의 실행 이력이 비어 있습니다(06 장면의 단독 실행이 필요).');
  }
  const cartCase = page.getByRole('button', { name: /결제 화면에서 바로구매/ }).first();
  await cartCase.click();
  await page.waitForTimeout(2000);
  await shot(page, '38-tests-case-history', {
    title: '케이스 실행 이력 — 테스트 이름을 누르면 그 테스트의 지난 결과가 나옵니다',
    items: [
      { target: cartCase, label: '이름 누르기', place: 'top' },
      { target: historyCard, label: '지난 실행 결과', place: 'inside' },
    ],
  });

  // 대시보드
  await gotoTab(page, 'dashboard');
  await page.getByRole('heading', { name: '프로젝트 대시보드' }).waitFor();
  await page.waitForTimeout(1500);
  await shot(page, '39-dashboard', {
    title: '대시보드 — 최근 결과 · 성공률 · 걸린 시간을 한눈에',
    items: [
      { target: await unionOf(page, cardOf(page.getByText('최종 결과', { exact: true }).first()), cardOf(page.getByText('실행 건수', { exact: true }).first())), label: '숫자로 보는 요약', place: 'top' },
      { target: cardOf(page.getByText('상태 분포').first()), label: '성공 · 실패 비율', place: 'inside' },
      { target: cardOf(page.getByText('최근 실행 소요시간').first()), label: '실행마다 걸린 시간', place: 'inside' },
      { target: page.getByRole('button', { name: '결과 보기' }), label: '결과 탭으로', place: 'left' },
    ],
  });
};

async function unionOf(page, a, b) {
  const { unionBox } = require('../lib/helpers');
  return unionBox(page, a, b);
}
