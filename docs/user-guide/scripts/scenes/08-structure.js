// 3장 구조 탭 "확인 지도": 요약 문장 · 4단계 색 · 화면 노드 · 테스트 흐름 · 재생(중간 장면) · 막힌 곳 카드 · 사이트 주소로 찾기.
// 05~06 장면에서 만든 실패 테스트(바로구매)가 "막힌 곳"으로 보인다.

module.exports = async ({ page, shot, gotoTab, cardOf, scrollToTop, api, projectId, dump }) => {
  const pid = await projectId(page);
  await gotoTab(page, 'structure');
  const summary = page.locator('[aria-label="확인 요약"]');
  await summary.waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);

  // ① 요약
  const sentence = summary.locator('p, h3, h2').first();
  await shot(page, '10-structure-summary', {
    title: '구조 탭(확인 지도) — 어디까지 확인됐고 어디서 막혔는지 한 문장으로',
    items: [
      { target: sentence, label: '한 줄 요약', place: 'bottom' },
      { target: summary.locator('div.rounded-full, div.h-2, div.h-3').first(), label: '4단계 색 막대', place: 'bottom' },
      { target: summary.getByRole('button').first(), label: '막힌 곳 바로 보기', place: 'left' },
      { target: page.getByRole('button', { name: '사이트 주소로 찾기' }), label: '사이트를 다시 둘러보기', place: 'bottom' },
    ],
  });

  // ② 지도 전체 — 그래프가 화면을 채우도록 내린다
  const search = page.getByRole('searchbox', { name: '화면 검색' }).or(page.locator('[aria-label="화면 검색"]')).first();
  await scrollToTop(page, search, 66);
  const fit = page.getByRole('button', { name: '전체 보기' });
  if (await fit.isVisible().catch(() => false)) await fit.click();
  await page.waitForTimeout(1200);
  const legend = page.getByText('테스트 통과', { exact: true }).first().locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
  const panelTabs = page.locator('[aria-label="패널 보기"]');
  await shot(page, '11-structure-map', {
    title: '확인 지도 — 사이트의 화면이 상자로, 화면 사이 이동이 선으로 보입니다',
    items: [
      { target: legend, label: '색 뜻: 통과 · 확인됨 · 안 봄 · 막힘', place: 'bottom' },
      { target: page.locator('.react-flow__node').first(), label: '화면 하나 = 상자 하나', place: 'top' },
      { target: panelTabs, label: '테스트 흐름 · 막힌 곳', place: 'bottom-end' },
    ],
  });
  await dump(page, 'structure-map');

  // ③ 화면 노드 확대 — 막힌 화면과 통과한 화면
  const blockedNode = page.locator('.react-flow__node').filter({ hasText: /여기서 막혔어요|실패/ }).first();
  const anyNode = (await blockedNode.count()) ? blockedNode : page.locator('.react-flow__node').first();
  await shot(page, '12-structure-node', {
    title: '화면 상자 읽는 법 — 이름 · 상태 · 확인한 버튼 수',
    clip: anyNode,
    clipPad: 120,
    zoom: 1.6,
    items: [{ target: anyNode, label: '상자를 누르면 자세히', place: 'bottom', pad: 4 }],
  });

  // ④ 테스트 흐름 목록
  await panelTabs.getByRole('button', { name: /테스트 흐름/ }).or(panelTabs.getByRole('tab', { name: /테스트 흐름/ })).first().click();
  await page.waitForTimeout(800);
  const flowCards = page.locator('button[title^="지도에서 이 흐름 재생"]');
  await shot(page, '13-structure-flows', {
    title: '테스트 흐름 — 테스트 하나가 어떤 화면을 차례로 지나가는지',
    items: [
      { target: flowCards.first(), label: '흐름 하나(누르면 재생)', place: 'left' },
      { target: flowCards.first().locator('[aria-label="단계"]'), label: '지나가는 화면 · ✓ ✗', place: 'left', pad: 4 },
    ],
  });

  // ⑤ 재생 중간 장면 — 실패한 흐름을 고른다
  const brokenFlow = flowCards.filter({ hasText: /바로구매/ }).first();
  const playTarget = (await brokenFlow.count()) ? brokenFlow : flowCards.first();
  await playTarget.click();
  await page.waitForTimeout(1500); // 600ms 간격으로 한 칸씩 — 두세 칸 진행된 때
  await shot(page, '14-structure-replay', {
    title: '흐름 재생 — 테스트가 지나간 길을 지도 위에서 한 칸씩 보여 줍니다',
    settle: 0,
    items: [{ target: playTarget, label: '재생 중인 흐름', place: 'left' }],
  });
  await page.waitForTimeout(6000);

  // ⑥ 막힌 곳 카드
  await panelTabs.getByRole('button', { name: /막힌 곳/ }).or(panelTabs.getByRole('tab', { name: /막힌 곳/ })).first().click();
  await page.waitForTimeout(800);
  const issues = page.locator('[aria-label="막힌 곳"] > li');
  const issue = issues.filter({ hasText: /바로구매|찾지 못했/ }).first();
  const card = (await issue.count()) ? issue : issues.first();
  const details = card.locator('summary', { hasText: '자세히' });
  if (await details.isVisible().catch(() => false)) await details.click();
  await page.waitForTimeout(600);
  await shot(page, '15-structure-issue', {
    title: '막힌 곳 — 어느 화면에서 왜 멈췄는지, 무엇을 하면 되는지',
    items: [
      { target: card.locator('button').first(), label: '막힌 화면 · 쉬운 이유', place: 'left' },
      { target: card.getByRole('button', { name: /AI로 고치기|다시 녹화하기|다시 실행|로그인 정보 넣기/ }).first(), label: '추천하는 다음 행동', place: 'left' },
      { target: card.locator('details'), label: '셀렉터 · 테스트 파일(개발자용)', place: 'left' },
    ],
  });

  // ⑦ 사이트 주소로 찾기(사이트 탐색)
  await scrollToTop(page, summary, 140);
  await page.getByRole('button', { name: '사이트 주소로 찾기' }).click();
  const running = page.getByText(/사이트 탐색 중/).first();
  await running.waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await shot(page, '16-structure-explore', {
    title: '사이트 주소로 찾기 — 링크를 따라가며 화면을 모읍니다(최대 3분, 클릭 · 입력은 안 함)',
    items: [
      { target: running, label: '탐색 중 — 찾은 화면이 하나씩 나타남', place: 'bottom', pad: 4 },
      { target: page.getByRole('button', { name: '로그인 탐색' }), label: '로그인 뒤 화면까지 찾기', place: 'bottom' },
    ],
  });
  // 끝날 때까지(최대 4분)
  const t0 = Date.now();
  while (Date.now() - t0 < 4 * 60 * 1000) {
    if (!(await page.getByText(/사이트 탐색 중/).first().isVisible().catch(() => false))) break;
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(3000);
  const cov = await api(page, `/api/projects/${pid}/sitemap/coverage`).catch(() => null);
  if (cov) console.log(`  · 탐색 뒤 요약: ${JSON.stringify(cov.summary)}`);
  await shot(page, '17-structure-after-explore', {
    title: '탐색이 끝나면 — 요약과 지도가 새로 그려집니다',
    items: [{ target: summary, label: '새 요약', place: 'bottom' }],
  });
};
