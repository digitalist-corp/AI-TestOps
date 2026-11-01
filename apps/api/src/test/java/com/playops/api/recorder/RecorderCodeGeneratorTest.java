package com.playops.api.recorder;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.recorder.RecorderDtos.RecordedStep;
import com.playops.api.recorder.RecorderDtos.RecorderState;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RecorderCodeGeneratorTest {

    private static final String BASE = "https://shop.example.com";

    private static RecordedStep step(String action, String selector, boolean fragile, String value, String secretEnv) {
        return new RecordedStep("s" + action.hashCode(), action, selector, fragile, "설명", value, secretEnv, BASE + "/");
    }

    @Test
    void generatesContractShape() {
        List<RecordedStep> steps = List.of(
                step("goto", null, false, "/login", null),
                step("fill", "getByLabel('이메일')", false, "user@example.com", null),
                step("fill", "getByLabel('비밀번호')", false, null, "LOGIN_PASSWORD"),
                step("click", "getByRole('button', { name: '로그인' })", false, null, null),
                step("assertVisible", "getByText('환영합니다')", false, null, null));

        String code = RecorderCodeGenerator.generate("로그인 흐름", steps, BASE);

        assertThat(code).isEqualTo("""
                import { test, expect } from '@playwright/test';

                test('로그인 흐름', async ({ page }) => {
                  await page.goto('/login');
                  await page.getByLabel('이메일').fill('user@example.com');
                  await page.getByLabel('비밀번호').fill(process.env.LOGIN_PASSWORD ?? '');
                  await page.getByRole('button', { name: '로그인' }).click();
                  await expect(page.getByText('환영합니다')).toBeVisible();
                });
                """);
    }

    @Test
    void marksFragileAndHandlesPressAssertText() {
        String code = RecorderCodeGenerator.generate(null, List.of(
                step("click", "getByRole('button', { name: '삭제', exact: true }).nth(1)", true, null, null),
                step("press", null, false, "Enter", null),
                step("assertText", "getByRole('heading')", false, "it's \"ok\"\n둘째 줄", null)), BASE);

        assertThat(code).contains("test('녹화한 테스트'");
        assertThat(code).contains("await page.getByRole('button', { name: '삭제', exact: true }).nth(1).click();"
                + RecorderCodeGenerator.FRAGILE_COMMENT);
        assertThat(code).contains("await page.keyboard.press('Enter');");
        assertThat(code).contains("await expect(page.getByRole('heading')).toHaveText('it\\'s \"ok\"\\n둘째 줄');");
    }

    @Test
    void gotoKeepsOnlyPathForSameOrigin() {
        assertThat(RecorderCodeGenerator.gotoTarget("https://shop.example.com/a?b=1#c", BASE)).isEqualTo("/a?b=1#c");
        assertThat(RecorderCodeGenerator.gotoTarget("https://shop.example.com:443", BASE)).isEqualTo("/");
        assertThat(RecorderCodeGenerator.gotoTarget("https://other.example.com/a", BASE)).isEqualTo("https://other.example.com/a");
        assertThat(RecorderCodeGenerator.gotoTarget("http://shop.example.com/a", BASE)).isEqualTo("http://shop.example.com/a");
        assertThat(RecorderCodeGenerator.gotoTarget("/x", null)).isEqualTo("/x");
    }

    @Test
    void skipsUnsafeSelectorsAndSecretEnvNames() {
        String code = RecorderCodeGenerator.generate("t", List.of(
                step("click", "getByText('a'));\nrequire('child_process').execSync('x'", false, null, null),
                step("click", "evaluate(() => 1)", false, null, null),
                step("fill", "getByLabel('pw')", false, null, "X; process.exit()")), BASE);

        assertThat(code).doesNotContain("child_process").doesNotContain("evaluate(");
        assertThat(code).contains("// 건너뜀:");
        assertThat(code).contains("fill(process.env.LOGIN_PASSWORD ?? '')");
    }

    @Test
    void safeSelectorAllowsOnlyLocatorExpressions() {
        assertThat(RecorderCodeGenerator.isSafeSelector("getByText('a; b \\' c', { exact: true })")).isTrue();
        assertThat(RecorderCodeGenerator.isSafeSelector(
                "getByRole('navigation').getByRole('link', { name: '홈', exact: true }).nth(2)")).isTrue();
        assertThat(RecorderCodeGenerator.isSafeSelector("locator('#login-form')")).isTrue();
        assertThat(RecorderCodeGenerator.isSafeSelector(
                "getByText('a')).click(); require('x'); page.getByText('b')")).isFalse();
        assertThat(RecorderCodeGenerator.isSafeSelector("getByText('a')).click(require('x')")).isFalse();
        assertThat(RecorderCodeGenerator.isSafeSelector("getByText('a)")).isFalse();
        assertThat(RecorderCodeGenerator.isSafeSelector("getByText(`${x}`)")).isFalse();
    }

    @Test
    void suggestsSpecPathFromTitleOrDate() {
        LocalDateTime now = LocalDateTime.of(2026, 11, 1, 9, 5, 7);
        assertThat(RecorderCodeGenerator.suggestSpecPath("Login Flow!", now)).isEqualTo("tests/recorded/login-flow.spec.ts");
        assertThat(RecorderCodeGenerator.suggestSpecPath("로그인 흐름", now)).isEqualTo("tests/recorded/recorded-20261101-090507.spec.ts");
        assertThat(RecorderCodeGenerator.suggestSpecPath(null, now)).isEqualTo("tests/recorded/recorded-20261101-090507.spec.ts");
    }

    /** record.js 를 실제 컨테이너로 돌려 로컬 웹(로그인 → 프로젝트 목록)을 녹화한 결과로 코드를 만든다. */
    @Test
    void generatesCodeFromRealRecording() throws Exception {
        RecorderState state;
        try (InputStream in = getClass().getResourceAsStream("/recorder/login-recorded-state.json")) {
            state = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .readValue(in, RecorderState.class);
        }

        String code = RecorderCodeGenerator.generate("로그인 후 프로젝트 열기", state.steps(), "http://host.docker.internal:3000");

        assertThat(code).contains("await page.goto('/login');");
        assertThat(code).contains("await page.getByRole('textbox', { name: '사용자명', exact: true }).fill('admin');");
        assertThat(code).contains("await page.getByLabel('비밀번호', { exact: true }).fill(process.env.LOGIN_PASSWORD ?? '');");
        assertThat(code).contains("await page.getByRole('button', { name: '로그인', exact: true }).click();");
        assertThat(code).contains("await expect(page.getByRole('heading', { name: '프로젝트', exact: true })).toBeVisible();");
        assertThat(code).contains("await page.keyboard.press('Enter');");
        assertThat(code).contains(".nth(0).click();" + RecorderCodeGenerator.FRAGILE_COMMENT);
        assertThat(code).doesNotContain("// 건너뜀");
        // 보고용으로 생성 결과를 build 폴더에 남긴다.
        Path out = Path.of("build", "tmp", "recorder", "login-recorded.spec.ts");
        Files.createDirectories(out.getParent());
        Files.writeString(out, code, StandardCharsets.UTF_8);
    }
}
