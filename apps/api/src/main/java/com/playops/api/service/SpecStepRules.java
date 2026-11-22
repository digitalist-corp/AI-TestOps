package com.playops.api.service;

/**
 * AI 가 만드는 Playwright spec 의 단계 이름 규칙 (V-3). 단계 기록 화면(#84)은 test.step 제목을 그대로 문장으로 보여 주므로,
 * 제목이 한국어 업무 용어여야 비전공자가 읽을 수 있다. 시스템 프롬프트 끝에 붙인다.
 */
final class SpecStepRules {

    private SpecStepRules() {}

    /** 새 spec 을 쓰는 프롬프트용. 제목 규칙은 --grep 정확 일치(#135, #149)가 케이스를 제목으로 찾는 것과 맞춘다. */
    static final String GENERATE = """

            Step names (a non-developer reads the run record, so write them in Korean business terms):
            - Wrap each group of user actions in `await test.step('<short Korean step name>', async () => { ... })`,
              and keep the `expect` assertions that belong to that action inside the same step.
            - A step name is a short Korean phrase such as '로그인 화면 열기', '아이디와 비밀번호 입력',
              '대시보드로 이동했는지 확인'. Never use code words (selector, locator, spec, method names) in it.
            - Title each `test('...')` with one short Korean sentence about the business behavior, as plain text:
              no '@' (Playwright reads '@word' in a title as a tag) and no line breaks.
            Example (the locators here are only illustrative):
            test('올바른 계정으로 로그인하면 대시보드가 열린다', async ({ page }) => {
              await test.step('로그인 화면 열기', async () => {
                await page.goto('/login');
              });
              await test.step('아이디와 비밀번호 입력', async () => {
                await page.getByLabel('아이디').fill(process.env.LOGIN_ID ?? '');
                await page.getByLabel('비밀번호').fill(process.env.LOGIN_PASSWORD ?? '');
              });
              await test.step('로그인 버튼 누르기', async () => {
                await page.getByRole('button', { name: '로그인' }).click();
              });
              await test.step('대시보드로 이동했는지 확인', async () => {
                await expect(page).toHaveURL(/dashboard/);
              });
            });
            """;

    /** 이미 있는 spec 을 고치는 프롬프트용. 이름을 지우거나 영어로 바꾸면 단계 기록이 다시 읽기 어려워진다. */
    static final String KEEP = """

            Keep every existing `test.step('...')` name as it is — do not delete, merge, or translate it into English.
            Any step you add gets a short Korean business-term name (for example '로그인 버튼 누르기').
            """;
}
