// 화면 찍기 + (선택) 위쪽 제목 띠 붙이기 + 저장.
//
// shot(page, 'NN-이름', { title, clip, zoom, items, spotlight, fullViewport })
//   items  : 주어지면 annotate() 로 주석을 얹고 찍은 뒤 지운다.
//   title  : 사진 위쪽 제목 띠("이 화면에서 할 수 있는 것: …"). 앱 화면을 가리지 않도록 사진 바깥 위에 붙인다.
//   clip   : 부분만 찍기. selector | Locator | {x,y,width,height}. clipPad 로 여백(기본 16).
//   zoom   : clip 결과를 몇 배로 키워 저장할지(기본 1). 작은 버튼을 크게 보여줄 때.
// 저장 형식은 GUIDE_FORMAT 환경변수(png|jpg, 기본 jpg)로 정한다. 용량 한도(15MB) 때문에 기본은 jpg.

const fs = require('fs');
const path = require('path');
const { annotate, clearAnnotations, resolveBox, ACCENT } = require('./annotate');

const IMAGES_DIR = path.resolve(__dirname, '..', '..', 'images');
const FORMAT = (process.env.GUIDE_FORMAT || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
const QUALITY = Number(process.env.GUIDE_QUALITY || 82);

let composer = null; // 제목 띠 합성용 빈 페이지(앱과 분리된 컨텍스트)

async function getComposer(browser) {
  if (composer && !composer.isClosed()) return composer;
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  composer = await ctx.newPage();
  return composer;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function shot(page, name, opts = {}) {
  // 마우스 커서 자리의 hover 효과가 사진에 남지 않게 기본으로 구석으로 치운다(hover 를 찍을 땐 keepMouse)
  if (!opts.keepMouse) await page.mouse.move(1439, 64).catch(() => {});
  await page.waitForTimeout(opts.settle ?? 250);

  let clip;
  if (opts.clip) {
    const box = await resolveBox(page, opts.clip);
    const pad = opts.clipPad ?? 16;
    const vp = page.viewportSize();
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    clip = {
      x,
      y,
      width: Math.min(vp.width - x, Math.ceil(box.width + pad * 2)),
      height: Math.min(vp.height - y, Math.ceil(box.height + pad * 2)),
    };
  }
  if (opts.items && opts.items.length) await annotate(page, opts.items, { spotlight: opts.spotlight, bounds: clip });
  await page.waitForTimeout(120);
  const raw = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  if (opts.items && opts.items.length) await clearAnnotations(page);

  const zoom = opts.zoom || 1;
  const needCompose = Boolean(opts.title) || zoom !== 1 || FORMAT === 'jpg';
  const file = path.join(IMAGES_DIR, `${name}.${FORMAT}`);
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  if (!needCompose) {
    fs.writeFileSync(file, raw);
    console.log(`  ✔ ${path.basename(file)}`);
    return file;
  }

  const vp = clip || page.viewportSize();
  const imgW = Math.round(vp.width * zoom);
  const imgH = Math.round(vp.height * zoom);
  const c = await getComposer(page.context().browser());
  await c.setViewportSize({ width: imgW, height: imgH });
  const band = opts.title
    ? `<div style="box-sizing:border-box;padding:14px 22px;background:${ACCENT};color:#fff;font-size:${imgW < 900 ? 19 : 21}px;font-weight:800;line-height:1.4;letter-spacing:-0.2px;">${escapeHtml(opts.title)}</div>`
    : '';
  await c.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;font-family:"Pretendard","Noto Sans KR","Noto Sans CJK KR","Malgun Gothic",sans-serif;}img{display:block;width:${imgW}px;height:${imgH}px;}</style></head><body>${band}<img src="data:image/png;base64,${raw.toString('base64')}"></body></html>`
  );
  await c.waitForFunction(() => document.images[0] && document.images[0].complete);
  const out = await c.screenshot(
    FORMAT === 'jpg' ? { type: 'jpeg', quality: QUALITY, fullPage: true } : { type: 'png', fullPage: true }
  );
  fs.writeFileSync(file, out);
  console.log(`  ✔ ${path.basename(file)}`);
  return file;
}

module.exports = { shot, IMAGES_DIR };
