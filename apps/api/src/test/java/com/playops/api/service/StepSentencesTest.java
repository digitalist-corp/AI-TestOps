package com.playops.api.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 단계 기록 → 한국어 문장 규칙 (#84). 제목은 Playwright 1.53 리포터가 남기는 그대로. */
class StepSentencesTest {

    private static String pw(String title) {
        return StepSentences.sentence("pw:api", title, null);
    }

    @Test
    void click() {
        assertThat(pw("Click getByRole('button', { name: '로그인' })")).isEqualTo("'로그인' 버튼 클릭");
        assertThat(pw("Click getByText('회원가입')")).isEqualTo("'회원가입' 글자 클릭");
        assertThat(pw("Click locator('#submit')")).isEqualTo("'#submit' 클릭");
        assertThat(pw("Double click getByRole('row', { name: '첫 줄' }).first()")).isEqualTo("'첫 줄' 행 두 번 클릭");
        assertThat(pw("Click getByRole('row').filter({ hasText: '가' }).getByRole('link', { name: '열기' })"))
                .isEqualTo("'열기' 링크 클릭");
    }

    @Test
    void fill() {
        assertThat(pw("Fill \"admin\" getByLabel('아이디')")).isEqualTo("'아이디' 입력란에 'admin' 입력");
        assertThat(pw("Fill \"x\" getByPlaceholder('검색어')")).isEqualTo("'검색어' 입력란에 'x' 입력");
        assertThat(pw("Fill \"hello\" getByRole('textbox', { name: '메모' })")).isEqualTo("'메모' 입력란에 'hello' 입력");
        // 비밀번호류는 리포터가 못 가렸어도 여기서 가린다
        assertThat(pw("Fill \"secret\" locator('#password')")).isEqualTo("'#password' 입력란에 '****' 입력");
        assertThat(pw("Fill \"****\" getByLabel('비밀번호')")).isEqualTo("'비밀번호' 입력란에 '****' 입력");
    }

    @Test
    void navigateAndKeys() {
        assertThat(pw("Navigate to \"/login\"")).isEqualTo("'/login' 페이지로 이동");
        assertThat(pw("Press \"Enter\" getByPlaceholder('검색')")).isEqualTo("'검색'에서 Enter 키 누름");
        assertThat(pw("Check getByLabel('약관 동의')")).isEqualTo("'약관 동의' 체크");
        assertThat(pw("Hover getByRole('link', { name: '메뉴' })")).isEqualTo("'메뉴' 링크에 마우스 올림");
        assertThat(pw("Select option locator('select')")).isEqualTo("'select'에서 항목 선택");
        assertThat(pw("Fetch \"/docs/intro\"")).isEqualTo("'/docs/intro' 주소 요청");
        assertThat(pw("Evaluate locator('a[href]')")).isEqualTo("'a[href]' 값 읽기");
        assertThat(pw("Wait for timeout")).isEqualTo("Wait for timeout"); // 모르는 단계는 그대로
    }

    @Test
    void expectUsesTheSourceLine() {
        assertThat(StepSentences.sentence("expect", "toBeVisible",
                "await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();"))
                .isEqualTo("'로그인' 제목이 보이는지 확인");
        assertThat(StepSentences.sentence("expect", "toHaveURL", "await expect(page).toHaveURL(/login/);"))
                .isEqualTo("페이지 주소 확인");
        assertThat(StepSentences.sentence("expect", "toHaveText", "await expect(page.locator('h1')).toHaveText('안녕');"))
                .isEqualTo("'h1'의 글자 확인");
        assertThat(StepSentences.sentence("expect", "toBeVisible", null)).isEqualTo("보이는지 확인");
        assertThat(StepSentences.sentence("expect", "toBe", "expect(count).toBe(3);")).isEqualTo("값 확인");
        // soft · 메시지가 있는 expect (실제 기본 점검 spec 모양)
        assertThat(StepSentences.sentence("expect", "toBeLessThan",
                "expect(response?.status() ?? 0, '첫 화면 응답 코드').toBeLessThan(400);")).isEqualTo("'첫 화면 응답 코드' 확인");
        assertThat(StepSentences.sentence("expect", "toBeLessThan",
                "expect.soft(response.status(), url).toBeLessThan(400);")).isEqualTo("값 확인");
        assertThat(StepSentences.sentence("expect", "toBeVisible", "await expect.soft(page.locator('body')).toBeVisible();"))
                .isEqualTo("'body'이(가) 보이는지 확인");
    }

    @Test
    void testStepKeepsItsTitle() {
        assertThat(StepSentences.sentence("test.step", "로그인 하기", null)).isEqualTo("로그인 하기");
    }
}
