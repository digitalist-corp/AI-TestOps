// "클릭으로 만들기"(녹화) 화면을 사람처럼 누르는 도우미.
//
// 녹화 화면의 가운데 그림은 서버의 원격 브라우저(1280x800)를 찍은 사진이다. 어디를 누를지 알기 위해
// 같은 크기의 "그림자" 브라우저로 데모샵을 똑같이 열어 요소 위치를 재고, 그림 크기에 맞춰 좌표를 바꿔 누른다.
// 그림자 브라우저는 원격 브라우저와 같은 동작(입력 · 클릭)을 따라 해서 화면 상태를 맞춘다.

const REMOTE = { width: 1280, height: 800 };

async function createRecorderDriver(page, browser, shopUrl) {
  const shadowCtx = await browser.newContext({ viewport: REMOTE, deviceScaleFactor: 1, locale: 'ko-KR' });
  const shadow = await shadowCtx.newPage();
  const screen = page.locator('img[alt="원격 브라우저 화면"]');
  const group = page.locator('[role="group"][aria-label^="원격 브라우저 화면"]');

  async function waitIdle(extra = 900) {
    await group.waitFor();
    await page.waitForFunction(
      () => document.querySelector('[role="group"][aria-label^="원격 브라우저 화면"]')?.getAttribute('aria-busy') !== 'true',
      null,
      { timeout: 60000 }
    );
    await page.waitForTimeout(extra);
  }

  /** 그림자 브라우저의 selector 가운데 → 녹화 화면 위 좌표 */
  async function pointOf(selector) {
    const el = shadow.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    const b = await el.boundingBox();
    const img = await screen.boundingBox();
    const sx = img.width / REMOTE.width;
    const sy = img.height / REMOTE.height;
    return { x: img.x + (b.x + b.width / 2) * sx, y: img.y + (b.y + b.height / 2) * sy };
  }

  /** 그림자 브라우저의 selector 상자 → 녹화 화면 위 상자(주석용) */
  async function boxOf(selector) {
    const b = await shadow.locator(selector).first().boundingBox();
    const img = await screen.boundingBox();
    const s = img.width / REMOTE.width;
    return { x: img.x + b.x * s, y: img.y + b.y * s, width: b.width * s, height: b.height * s };
  }

  async function mode(label) {
    await page.getByRole('radiogroup', { name: '녹화 모드' }).getByRole('radio', { name: label }).click();
    await page.waitForTimeout(200);
  }

  async function hover(selector) {
    const p = await pointOf(selector);
    await page.mouse.move(p.x - 3, p.y - 3);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await page.waitForTimeout(1800);
  }

  /** 원격 화면을 클릭(지금 고른 모드대로 기록된다). 그림자 브라우저도 따라 누른다. */
  async function click(selector, { mirror = true } = {}) {
    const p = await pointOf(selector);
    await page.mouse.click(p.x, p.y);
    if (mirror) {
      await shadow.locator(selector).first().click();
      await shadow.waitForLoadState('networkidle').catch(() => {});
    }
    await waitIdle();
  }

  /** 입력 모드에서 입력칸을 눌러 작은 창을 띄운다. 값 넣기는 typeFill 로. */
  async function openFill(selector) {
    const p = await pointOf(selector);
    await page.mouse.click(p.x, p.y);
    await page.getByRole('textbox', { name: '입력할 값' }).waitFor();
    await page.waitForTimeout(300);
  }

  async function typeFill(selector, value) {
    await page.getByRole('textbox', { name: '입력할 값' }).fill(value);
    await page.keyboard.press('Enter');
    await shadow.locator(selector).first().fill(value);
    await waitIdle();
  }

  async function syncShadow(path) {
    await shadow.goto(`${shopUrl}${path}`);
    await shadow.waitForLoadState('networkidle').catch(() => {});
  }

  return { shadow, screen, waitIdle, pointOf, boxOf, mode, hover, click, openFill, typeFill, syncShadow, close: () => shadowCtx.close() };
}

module.exports = { createRecorderDriver };
