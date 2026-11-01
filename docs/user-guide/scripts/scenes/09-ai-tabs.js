// 7장 AI 탭: AI로 만들기(추천 문장 → 생성 → 검토 대기) · AI 분석 · AI 검토(변경 내용 펼치기 · 승인).
// AI 를 실제로 부른다(토큰 소량). AI 스위치를 켠 상태에서 돈다.

module.exports = async ({ page, shot, gotoTab, setAi, cardOf, api, projectId, scrollToTop }) => {
  page.on('dialog', (d) => {
    console.log(`  · 브라우저 확인 창: ${d.message().split('\n')[0]}`);
    d.accept();
  });
  const pid = await projectId(page);
  await gotoTab(page, 'ai-generate');
  await setAi(page, true);
  await page.waitForTimeout(800);

  // 이미 검토 대기 중인 작업이 있으면(앞선 실행에서 만든 것) 새로 만들지 않고 재사용한다.
  const waiting = await api(page, '/api/ai-jobs/needs-review').catch(() => []);
  const hasWaiting = Array.isArray(waiting) && waiting.length > 0;
  let ready = hasWaiting;
  if (!hasWaiting) {
  // AI로 만들기 — 추천 문장 칩
    const chips = page.locator('[aria-label="추천 문장"]');
    await chips.waitFor({ timeout: 20000 });
    const firstChip = chips.getByRole('button').first();
    await firstChip.click();
    await page.waitForTimeout(400);
    const box = page.getByRole('textbox', { name: '테스트로 확인할 내용' });
    const makeBtn = page.getByRole('button', { name: '테스트 만들기' });
    await shot(page, '50-ai-generate', {
      title: 'AI로 만들기 — 확인하고 싶은 것을 문장으로 쓰면 AI가 테스트를 만듭니다',
      items: [
        { target: chips, label: '추천 문장을 눌러도 됨', place: 'bottom' },
        { target: box, label: '확인할 내용을 문장으로', place: 'top' },
        { target: makeBtn, label: '테스트 만들기', place: 'left' },
      ],
    });
    console.log(`  · 고른 추천 문장: ${(await box.inputValue()).slice(0, 80)}`);
    await makeBtn.click();
    const jobCard = cardOf(page.getByText(/작업 #\d+/).first());
    await page.getByText(/작업 #\d+/).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, '51-ai-generate-running', {
      title: 'AI가 만드는 중 — 보통 1~3분 걸립니다. 다른 화면으로 가도 계속됩니다',
      items: [{ target: jobCard, label: '작업 진행 상태', place: 'top' }],
    });
    const t0 = Date.now();
    let status = '';
    while (Date.now() - t0 < 8 * 60 * 1000) {
      status = (await jobCard.innerText().catch(() => '')) || '';
      if (/검토 대기|생성 실패|오류 발생|시간 초과|거부됨|적용 완료/.test(status)) break;
      await page.waitForTimeout(5000);
    }
    console.log(`  · AI로 만들기 결과: ${status.split('\n').slice(0, 2).join(' / ')} (${Math.round((Date.now() - t0) / 1000)}초)`);
    const reviewBtn = page.getByRole('button', { name: '검토하러 가기' });
    ready = await reviewBtn.isVisible().catch(() => false);
    await shot(page, '52-ai-generate-ready', {
      title: ready ? '다 만들었습니다 — 아직 파일에 반영되지 않았습니다. 검토하러 가세요' : 'AI로 만들기 결과',
      items: [
        { target: jobCard, label: ready ? '검토 대기(승인해야 반영)' : '작업 결과', place: 'top' },
        ...(ready ? [{ target: reviewBtn, label: '검토하러 가기', place: 'bottom' }] : []),
      ],
    });
  }

  // AI 검토 — 목록 · 변경 내용 · 승인
  await gotoTab(page, 'ai-review');
  await page.getByRole('heading', { name: 'AI 검토' }).waitFor();
  await page.waitForTimeout(1500);
  const pending = page.getByText(/검토 대기 \(\d+\)/).first();
  const diffBtn = page.getByRole('button', { name: '변경 내용 보기' }).first();
  await shot(page, '55-ai-review', {
    title: 'AI 검토 — AI가 만든 변경은 사람이 승인해야만 실제 파일에 들어갑니다',
    items: [
      { target: pending, label: '승인을 기다리는 작업', place: 'right', pad: 4 },
      { target: diffBtn, label: '무엇이 바뀌는지 보기', place: 'bottom' },
      { target: page.getByRole('button', { name: '승인 및 적용' }).first(), label: '승인하면 반영', place: 'left' },
      { target: page.getByRole('button', { name: '거부' }).first(), label: '거부하면 버림', place: 'bottom' },
    ],
  });
  if (await diffBtn.isVisible().catch(() => false)) {
    await diffBtn.click();
    await page.waitForTimeout(2500);
    const diffArea = page.getByText(/import \{ test/).first().locator('xpath=ancestor::*[contains(@class,"overflow") or contains(@class,"rounded")][1]');
    await shot(page, '56-ai-review-diff', {
      title: '변경 내용 — 새로 생기는 테스트 코드가 초록색으로 보입니다',
      items: [
        { target: diffArea, label: '바뀌는 내용(초록 = 추가)', place: 'top' },
        { target: page.getByRole('button', { name: '승인 및 적용' }).first(), label: '확인했으면 승인', place: 'left' },
      ],
    });
    await page.getByRole('button', { name: '승인 및 적용' }).first().click();
    // 승인하면 적용 뒤 확인 실행(사후 검증)이 한 번 돈다. "적용됨" 또는 "적용 완료"가 보일 때까지 기다린다(최대 4분).
    await page.getByText(/적용됨|적용 완료/).first().waitFor({ timeout: 4 * 60 * 1000 }).catch(() => {});
    await page.getByRole('button', { name: '새로고침' }).click().catch(() => {});
    await page.waitForTimeout(1500);
    const recent = page.getByText(/최근 작업 \(\d+\)/).first();
    await scrollToTop(page, recent, 120).catch(() => {});
    await shot(page, '57-ai-review-approved', {
      title: '승인 완료 — 이제 테스트 탭에 새 테스트가 생깁니다',
      items: [{ target: page.getByText(/적용됨|적용 완료/).first(), label: '적용 완료', place: 'right', pad: 4 }],
    });
  }

  // AI 분석 — 실패한 실행을 쉬운 말로
  await gotoTab(page, 'ai-analysis');
  await page.waitForTimeout(1000);
  const execs = await api(page, `/api/projects/${pid}/executions`);
  const failed = execs.filter((e) => e.status === 'FAILED' && (e.failedTests || 0) > 0).sort((a, b) => b.id - a.id)[0];
  const select = page.locator('select').first();
  if (failed) {
    await page.evaluate(() => {
      window.__origPushState = history.pushState;
      history.pushState = function(state, title, url) {
        if (typeof url === 'string' && url.includes('/results')) return;
        return window.__origPushState.apply(this, arguments);
      };
    });
    await select.selectOption({ value: String(failed.id) }).catch(async () => {
      const opt = await select.locator('option').filter({ hasText: `#${failed.id} ` }).first().getAttribute('value');
      await select.selectOption(opt);
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      if (window.__origPushState) history.pushState = window.__origPushState;
    });
  }
  await page.getByRole('button', { name: /비전공자/ }).click();
  await page.waitForTimeout(400);
  const runBtn = page.getByRole('button', { name: /AI 분석 실행/ });
  await shot(page, '53-ai-analysis-setup', {
    title: 'AI 분석 — 실패한 실행을 골라 내 수준에 맞는 설명을 받습니다',
    items: [
      { target: select, label: '분석할 실행 고르기', place: 'bottom' },
      { target: page.getByRole('button', { name: /비전공자/ }).locator('xpath=..'), label: '설명 수준 고르기', place: 'bottom' },
      { target: runBtn, label: 'AI 분석 실행', place: 'left' },
    ],
  });
  await runBtn.click();
  const t1 = Date.now();
  while (Date.now() - t1 < 4 * 60 * 1000) {
    const busy = await page.getByRole('button', { name: /AI 분석 중/ }).isVisible().catch(() => false);
    if (!busy && Date.now() - t1 > 5000) break;
    await page.waitForTimeout(3000);
  }
  console.log(`  · AI 분석 ${Math.round((Date.now() - t1) / 1000)}초 (실행 #${failed ? failed.id : '?'})`);
  await page.waitForTimeout(1500);
  const summaryBox = page.getByText('AI 한 줄 진단 요약').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const detailBox = page.getByText('맞춤형 원인 해설').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const targetEl = (await summaryBox.isVisible().catch(() => false))
    ? summaryBox
    : page.locator('.prose, [class*="markdown"], article').first();
  await shot(page, '54-ai-analysis-result', {
    title: 'AI 분석 결과 — 왜 실패했는지 · 어떻게 고치면 되는지를 쉬운 말로',
    items: [
      { target: targetEl, label: '한 줄 진단 요약', place: 'top' },
      ...((await detailBox.isVisible().catch(() => false))
        ? [{ target: detailBox, label: '맞춤형 원인 해설 및 팁', place: 'bottom' }]
        : []),
    ],
  });
};
