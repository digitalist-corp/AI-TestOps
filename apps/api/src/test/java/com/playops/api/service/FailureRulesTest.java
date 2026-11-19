package com.playops.api.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static com.playops.api.service.FailureRules.Cause.*;
import static org.assertj.core.api.Assertions.assertThat;

class FailureRulesTest {

    private static final String CLICK_PAY = "locator.click: Timeout 5000ms exceeded.\nCall log:\n"
            + "  - waiting for getByRole('button', { name: '결제하기' })";

    @Test
    void sameCauseDifferentNumbersShareSignature() {
        FailureRules.Signature a = FailureRules.signature("tests/cart.spec.ts", CLICK_PAY);
        FailureRules.Signature b = FailureRules.signature("tests/cart.spec.ts", CLICK_PAY.replace("5000", "30000"));
        assertThat(a.key()).hasSize(12).isEqualTo(b.key());
        assertThat(a.head()).isEqualTo("locator.click: Timeout Nms exceeded.");
        assertThat(a.locator()).isEqualTo("getByRole('button', { name: '결제하기' })");

        String goto1 = "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4173/\nCall log:\n  - navigating to \"http://localhost:4173/\"";
        String goto2 = "page.goto: net::ERR_CONNECTION_REFUSED at http://shop:3000/login\nCall log:\n  - navigating to \"http://shop:3000/login\"";
        assertThat(FailureRules.signature("a.spec.ts", goto1).key()).isEqualTo(FailureRules.signature("a.spec.ts", goto2).key());
    }

    @Test
    void differentLocatorOrSpecSplits() {
        String other = CLICK_PAY.replace("결제하기", "장바구니");
        assertThat(FailureRules.signature("tests/cart.spec.ts", other).key())
                .isNotEqualTo(FailureRules.signature("tests/cart.spec.ts", CLICK_PAY).key());
        assertThat(FailureRules.signature("tests/order.spec.ts", CLICK_PAY).key())
                .isNotEqualTo(FailureRules.signature("tests/cart.spec.ts", CLICK_PAY).key());
    }

    @Test
    void ansiAndBlankAreSafe() {
        FailureRules.Signature colored = FailureRules.signature("a.spec.ts", "\u001B[31m" + CLICK_PAY + "\u001B[39m");
        assertThat(colored.key()).isEqualTo(FailureRules.signature("a.spec.ts", CLICK_PAY).key());
        assertThat(FailureRules.signature(null, null).key()).hasSize(12);
        assertThat(FailureRules.signature("a.spec.ts", "  ").head()).isEmpty();
        assertThat(FailureRules.classify(null, List.of())).isEqualTo(UNCLASSIFIED);
    }

    @Test
    void clusterKeepsFirstSeenOrder() {
        record Failed(String spec, String error) {}
        List<Failed> failed = List.of(
                new Failed("a.spec.ts", CLICK_PAY),
                new Failed("a.spec.ts", "page.goto: net::ERR_NAME_NOT_RESOLVED at http://x/"),
                new Failed("a.spec.ts", CLICK_PAY.replace("5000", "7000")));
        Map<String, List<Failed>> clusters = FailureRules.cluster(failed, f -> FailureRules.signature(f.spec(), f.error()));
        assertThat(clusters.values()).extracting(List::size).containsExactly(2, 1);
    }

    @Test
    void eachCauseHasARule() {
        assertThat(FailureRules.classify("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4173/", List.of()))
                .isEqualTo(ENVIRONMENT);
        assertThat(FailureRules.classify("Error: strict mode violation: getByRole('button', { name: '삭제' }) resolved to 3 elements", List.of()))
                .isEqualTo(SCRIPT_ERROR);
        assertThat(FailureRules.classify("Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('total')\n"
                + "Expected string: \"합계 30,000원\"\nReceived string: \"합계 0원\"", List.of()))
                .isEqualTo(PRODUCT_DEFECT);
        // 같은 케이스가 통과 · 실패를 오갔다 → 불안정 (최신 먼저)
        assertThat(FailureRules.classify(CLICK_PAY, List.of("PASSED", "FAILED", "PASSED"))).isEqualTo(FLAKY);
        // 처음 실패한 것은 뒤집힘이 1번뿐 → 불안정이 아니다
        assertThat(FailureRules.classify(CLICK_PAY, List.of("PASSED", "PASSED"))).isEqualTo(SCRIPT_ERROR);
        assertThat(FailureRules.classify("Test timeout of 30000ms exceeded.", List.of())).isEqualTo(UNCLASSIFIED);
    }
}
