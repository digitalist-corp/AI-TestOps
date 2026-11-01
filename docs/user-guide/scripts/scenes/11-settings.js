// 9장 설정: 프로젝트 설정 · 환경변수(값은 가려진 채로) · 예약 실행. 코드 편집기 사진은 05 장면에서 찍는다.
// ⚠ 환경변수 창에서 비밀번호 값이 평문으로 보이면 찍지 않는다(비밀번호 칸이 type=password 인지 확인).
// 예약은 "즉시 활성화"를 끈 채로 저장한다(촬영 때문에 서버가 실제로 자동 실행하지 않도록).

const SCHEDULE_NAME = '매일 아침 회귀 테스트';

module.exports = async ({ page, shot, gotoTab, cardOf, scrollToTop, api, projectId }) => {
  page.on('dialog', (d) => d.accept());
  const pid = await projectId(page);

  // 프로젝트 설정
  await gotoTab(page, 'settings');
  await page.getByRole('heading', { name: '환경 정보' }).waitFor();
  await page.waitForTimeout(1200);
  await shot(page, '70-settings', {
    title: '설정 — 사이트 주소 · 실행 방식 · 환경변수 등 프로젝트 기본값',
    items: [
      { target: page.getByRole('link', { name: '예약 실행' }).or(page.locator('a', { hasText: '예약 실행' })).first(), label: '설정 · 예약 실행 · 코드 편집기', place: 'bottom' },
      { target: cardOf(page.getByRole('heading', { name: '환경 정보' })), label: '프로젝트 정보', place: 'inside' },
      { target: page.getByRole('button', { name: '설정 수정' }), label: '바꾸려면 설정 수정', place: 'right' },
      { target: cardOf(page.getByRole('heading', { name: 'Docker Runner' })), label: '테스트를 돌리는 실행 상자', place: 'inside' },
    ],
  });

  // 환경변수 창
  await page.getByRole('button', { name: '환경변수' }).first().click();
  const dlg = page.getByRole('dialog').filter({ hasText: '환경변수' });
  await dlg.waitFor();
  await page.waitForTimeout(800);
  // 비밀번호류 값 칸이 모두 가려졌는지 확인
  const rows = await dlg.locator('input[placeholder="KEY"]').evaluateAll((keys) =>
    keys.map((k) => {
      const value = k.parentElement.querySelector('input[placeholder="value"]') || k.closest('div').parentElement.querySelector('input[placeholder="value"]');
      return { key: k.value, type: value ? value.type : '?' };
    })
  );
  const leaked = rows.filter((r) => /password|secret|token|credential/i.test(r.key) && r.type !== 'password');
  if (leaked.length) {
    console.log(`  ! 비밀번호 값이 가려지지 않은 칸이 있어 환경변수 사진을 찍지 않습니다: ${leaked.map((r) => r.key).join(', ')}`);
  } else {
    const pwKey = dlg.locator('input[placeholder="KEY"]').filter({ hasNot: page.locator('x') });
    void pwKey;
    const pwValue = dlg.locator('input[placeholder="value"][type="password"]').first();
    await shot(page, '71-settings-env', {
      title: '환경변수 — 테스트에 쓸 계정 · 주소 같은 값. 비밀번호는 ●●● 로 가려집니다',
      items: [
        { target: dlg.locator('input[placeholder="KEY"]').first(), label: '이름(KEY)', place: 'left' },
        { target: pwValue, label: '비밀번호는 가려서 보관', place: 'right' },
        { target: dlg.getByText('.env / JSON 붙여넣기').first(), label: '여러 개를 한 번에 붙여넣기', place: 'top' },
      ],
    });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 예약 실행
  await gotoTab(page, 'schedules');
  await page.getByRole('heading', { name: '예약 실행' }).first().waitFor();
  await page.waitForTimeout(800);
  const list = await api(page, `/api/projects/${pid}/schedules`).catch(() => []);
  const exists = Array.isArray(list) && list.some((s) => s.name === SCHEDULE_NAME);
  if (!exists) {
    await page.getByRole('button', { name: '예약 추가' }).click();
    const sd = page.getByRole('dialog');
    await sd.waitFor();
    await sd.getByPlaceholder('예: 매일 야간 회귀 테스트').fill(SCHEDULE_NAME);
    await sd.locator('input[type="time"]').fill('09:00');
    for (const day of ['월', '화', '수', '목', '금']) {
      await sd.getByRole('button', { name: day, exact: true }).click();
    }
    const active = sd.locator('input[type="checkbox"]').first();
    if (await active.isChecked()) await active.uncheck();
    await page.waitForTimeout(400);
    await shot(page, '72-schedules-new', {
      title: '예약 실행 — 정해진 시각에 테스트를 자동으로 돌립니다',
      items: [
        { target: sd.getByPlaceholder('예: 매일 야간 회귀 테스트'), label: '예약 이름', place: 'bottom' },
        { target: sd.getByPlaceholder('tests/login.spec.ts'), label: '비우면 전체 테스트', place: 'bottom' },
        { target: sd.locator('input[type="time"]'), label: '몇 시에', place: 'right' },
        { target: sd.getByRole('button', { name: '월', exact: true }).locator('xpath=..'), label: '무슨 요일에', place: 'bottom' },
        { target: active.locator('xpath=ancestor::label[1]'), label: '켜 두면 그 시각에 실행', place: 'right' },
      ],
    });
    await sd.getByRole('button', { name: '저장', exact: true }).click();
    await page.waitForTimeout(1500);
  }
  await shot(page, '72b-schedules-list', {
    title: '예약 목록 — 이름 · 시각 · 요일 · 켜짐 여부',
    items: [
      { target: page.getByText(SCHEDULE_NAME).first().locator('xpath=ancestor::*[contains(@class,"border")][1]'), label: '등록한 예약', place: 'bottom' },
      { target: page.getByRole('button', { name: '예약 추가' }), label: '예약 추가', place: 'left' },
    ],
  });
};
