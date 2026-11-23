package com.playops.api.service;

import com.playops.api.service.AppFixRules.Category;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class AppFixRulesTest {

    private static final String WRONG_TOTAL = """
            Error: expect(locator).toHaveText(expected) failed
            Expected string: "합계 3"
            Received string: "합계 2"
            """;

    @Test
    void wrongValueOnScreenIsACodeCandidate() {
        assertThat(AppFixRules.category(WRONG_TOTAL, List.of(), null)).isEqualTo(Category.APP_CODE);
    }

    @Test
    void serverErrorStatusIsAnApiCandidate() {
        String error = "expect(response.status()).toBe(200)\nExpected: 200\nReceived: 500";
        assertThat(AppFixRules.category(error, List.of(), null)).isEqualTo(Category.APP_API);
    }

    @Test
    void authStatusAloneDoesNotProveAProductDefect() {
        String error = "expect(response.status()).toBe(200)\nExpected: 200\nReceived: 401";
        assertThat(AppFixRules.category(error, List.of(), null)).isEqualTo(Category.UNKNOWN);
    }

    @Test
    void missingSelectorIsATestProblem() {
        String error = "expect(locator).toBeVisible() failed\nwaiting for getByRole('button', { name: '저장' })\nelement(s) not found";
        assertThat(AppFixRules.category(error, List.of(), null)).isEqualTo(Category.TEST);
    }

    @Test
    void networkFailureIsEnvironmentAndUnknownStaysUnknown() {
        assertThat(AppFixRules.category("page.goto: net::ERR_CONNECTION_REFUSED", List.of(), null)).isEqualTo(Category.ENVIRONMENT);
        assertThat(AppFixRules.category("Test timeout of 30000ms exceeded.", List.of(), null)).isEqualTo(Category.UNKNOWN);
    }

    @Test
    void humanCorrectionWinsOverTheRule() {
        assertThat(AppFixRules.category(WRONG_TOTAL, List.of(), "SCRIPT_ERROR")).isEqualTo(Category.TEST);
        assertThat(AppFixRules.category("Test timeout", List.of(), "PRODUCT_DEFECT")).isEqualTo(Category.APP_CODE);
    }

    @Test
    void redactRemovesCredentialsPersonalDataQueryStringsAndEnvValues() {
        String raw = """
                Authorization: Bearer abc.def.ghi
                cookie: sid=xyz; theme=dark
                navigated to https://shop.test/orders/new?token=t0p&page=2
                password=hunter22 user jane.doe@example.com
                filled s3cr3t-value into field
                """;
        String clean = AppFixRules.redact(raw, Set.of("s3cr3t-value", "ab"));

        assertThat(clean).doesNotContain("abc.def.ghi", "sid=xyz", "t0p", "hunter22", "jane.doe@example.com", "s3cr3t-value");
        assertThat(clean).contains("https://shop.test/orders/new", "filled");
    }

    @Test
    void redactRemovesQuotedJsonKeysAndQuotedValues() {
        String raw = "body {\"password\":\"hunter22\",\"access_token\": \"t0k3n-xyz\",\"name\":\"ok\"} token='abc123' api_key = \"zzz999\"";
        String clean = AppFixRules.redact(raw, Set.of());
        assertThat(clean).doesNotContain("hunter22", "t0k3n-xyz", "abc123", "zzz999").contains("\"name\":\"ok\"");
    }

    @Test
    void redactRemovesCredentialsInUrlsAndBareJwts() {
        String raw = "page.goto https://qa:p4ssw0rd@staging.shop.test/cart\n"
                + "response body eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl";
        String clean = AppFixRules.redact(raw, Set.of());
        assertThat(clean).doesNotContain("p4ssw0rd", "qa:", "eyJzdWIiOiIxIn0").contains("staging.shop.test/cart");
    }

    @Test
    void redactHidesTypedValues() {
        String clean = AppFixRules.redact("이름 입력란에 '홍길동' 입력\npage.fill('#name', '홍길동')", Set.of());
        assertThat(clean).doesNotContain("홍길동").contains("이름 입력란에");
    }

    @Test
    void cluesComeFromPathsNamesAndQuotedText() {
        String evidence = """
                page.goto https://shop.test/orders/new
                click getByRole('button', { name: '저장' })
                POST /api/orders 500
                at OrderForm (src/pages/OrderForm.tsx:42:7)
                """;
        assertThat(AppFixRules.clues(evidence)).contains("/orders/new", "저장", "/api/orders", "OrderForm.tsx");
    }

    @Test
    void diffAppliesAUniqueEditAndShowsContext() {
        String original = "a\nb\nc\nconst total = items.length - 1;\nd\ne\nf\ng\n";
        String diff = AppFixRules.unifiedDiff("src/Cart.tsx", original,
                List.of(new AppFixRules.Edit("src/Cart.tsx", "items.length - 1", "items.length")));

        assertThat(diff).isEqualTo("""
                --- a/src/Cart.tsx
                +++ b/src/Cart.tsx
                @@ -1,7 +1,7 @@
                 a
                 b
                 c
                -const total = items.length - 1;
                +const total = items.length;
                 d
                 e
                 f
                """);
    }

    @Test
    void missingOrChangedFinalNewlineIsNotShownAsAnApplicableDiff() {
        // 줄 수 · "No newline" 표시가 어긋날 수 있어 적용 확인 diff 로 내지 않는다 (진단만)
        assertThat(AppFixRules.unifiedDiff("a.ts", "x = 1;", List.of(new AppFixRules.Edit("a.ts", "1", "2")))).isNull();
        assertThat(AppFixRules.unifiedDiff("a.ts", "x = 1;\n", List.of(new AppFixRules.Edit("a.ts", "1;\n", "2;")))).isNull();
    }

    @Test
    void editThatDoesNotMatchExactlyOnceIsRejected() {
        String original = "x = 1;\nx = 1;\n";
        assertThat(AppFixRules.unifiedDiff("a.ts", original, List.of(new AppFixRules.Edit("a.ts", "x = 1;", "x = 2;")))).isNull();
        assertThat(AppFixRules.unifiedDiff("a.ts", original, List.of(new AppFixRules.Edit("a.ts", "y", "z")))).isNull();
    }
}
