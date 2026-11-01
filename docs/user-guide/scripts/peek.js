// 셀렉터 찾기용: 주소 하나를 열어 화면을 .auth/peek-N.png 로 찍고, 보이는 제목 · 버튼 · 입력칸을 출력한다.
//   node scripts/peek.js /projects /runners   # 여러 개도 된다
//   node scripts/peek.js tab:structure        # 데모샵 프로젝트의 구조 탭
const path = require('path');
const { openBrowser, login, dump, APP_URL } = require('./lib/session');
const { gotoTab } = require('./lib/helpers');

(async () => {
  const targets = process.argv.slice(2);
  if (!targets.length) targets.push('/projects');
  const { browser, page } = await openBrowser();
  await login(page);
  for (const [i, target] of targets.entries()) {
    if (target.startsWith('tab:')) await gotoTab(page, target.slice(4));
    else await page.goto(`${APP_URL}${target}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
    await dump(page, target);
    await page.screenshot({ path: path.join(__dirname, '.auth', `peek-${i + 1}.png`) });
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
