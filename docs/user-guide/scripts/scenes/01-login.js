// 1장 시작하기 — 로그인 화면. 로그인 전 화면이라 따로 빈 브라우저 창을 연다(입력칸은 비운 채로 찍는다).
// 기본 계정으로 시작 버튼과 안내 문구(admin / admin)를 포함하여 찍는다.
const { VIEWPORT } = require('../lib/session');

module.exports = async ({ browser, shot, APP_URL }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/login`);
  await page.locator('#username').waitFor();
  await page.waitForTimeout(800);
  await shot(page, '01-login', {
    title: '로그인 — 관리자에게 받은 계정으로 들어갑니다',
    items: [
      { target: '#username', label: '사용자명 입력', place: 'right' },
      { target: '#password', label: '비밀번호 입력', place: 'right' },
      { target: 'form button[type="submit"]', label: '눌러서 로그인', place: 'right' },
      { target: page.getByRole('button', { name: '기본 계정으로 시작' }), label: '기본 계정으로 바로 시작', place: 'right' },
    ],
  });
  await ctx.close();
};
