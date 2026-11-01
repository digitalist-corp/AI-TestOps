// 가이드 사진 찍기 실행기.
//
//   node scripts/capture.js                 # scenes/ 의 모든 장면을 파일 이름 순서대로
//   node scripts/capture.js 01 03-structure # 이름이 이 글자로 시작하는 장면만
//
// 장면 파일(scenes/NN-이름.js)은 `module.exports = async ({ page, shot, annotate, ... }) => {}` 꼴이다.
// 보통은 run.sh 로 Docker 컨테이너 안에서 돌린다.

const fs = require('fs');
const path = require('path');
const { openBrowser, login, dump, APP_URL, SHOP_URL } = require('./lib/session');
const { shot } = require('./lib/shot');
const { annotate, clearAnnotations } = require('./lib/annotate');
const helpers = require('./lib/helpers');

(async () => {
  const filters = process.argv.slice(2);
  const dir = path.join(__dirname, 'scenes');
  const scenes = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .filter((f) => !filters.length || filters.some((p) => f.startsWith(p)));
  if (!scenes.length) {
    console.error('찍을 장면이 없습니다:', filters.join(' '));
    process.exit(1);
  }

  const { browser, context, page } = await openBrowser();
  await login(page);
  let failed = 0;
  for (const file of scenes) {
    console.log(`▶ ${file}`);
    try {
      const scene = require(path.join(dir, file));
      await scene({ browser, context, page, shot, annotate, clearAnnotations, dump, login, APP_URL, SHOP_URL, ...helpers });
    } catch (err) {
      failed++;
      console.error(`  ✘ ${file}: ${err.message}`);
      const errFile = path.join(__dirname, '.auth', `error-${file.replace('.js', '')}.png`);
      await page.screenshot({ path: errFile }).catch(() => {});
      console.error(`    (오류 순간 화면: ${path.relative(process.cwd(), errFile)})`);
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
