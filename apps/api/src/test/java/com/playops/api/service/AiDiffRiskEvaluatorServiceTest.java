package com.playops.api.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AiDiffRiskEvaluatorServiceTest {

    private static final String BEFORE = """
            test('문의하기 링크가 보인다', async ({ page }) => {
              await page.goto('/');
              await expect(page.getByRole('link', { name: '문의하기' })).toBeVisible({ timeout: 5000 });
            });
            """;

    private final AiDiffRiskEvaluatorService evaluator = new AiDiffRiskEvaluatorService();

    private List<String> flags(String after) {
        return evaluator.evaluate(List.of(new AiDiffRiskEvaluatorService.FileChange("tests/demo.spec.ts", BEFORE, after)), 1, 5)
                .hardGateFlags();
    }

    /** 로컬 루프 한 바퀴에서 실제로 나온 수정(#26): 실제 사이트 대신 가짜 화면을 만들어 통과시켰다 */
    @Test
    void replacingTheRealSiteWithFakeContentIsFlagged() {
        String faked = BEFORE.replace("await page.goto('/');", "await page.setContent(`<a href=\"#\">문의하기</a>`);");
        assertThat(flags(faked)).anyMatch(f -> f.startsWith("target_bypassed(tests/demo.spec.ts"));

        String mocked = BEFORE.replace("await page.goto('/');",
                "await page.route('**/*', r => r.fulfill({ body: '<a>문의하기</a>' }));\n  await page.goto('/');");
        assertThat(flags(mocked)).anyMatch(f -> f.startsWith("target_bypassed("));
    }

    @Test
    void fixingTheLocatorIsNotFlagged() {
        assertThat(flags(BEFORE.replace("'문의하기'", "'Learn more'"))).isEmpty();
    }
}
