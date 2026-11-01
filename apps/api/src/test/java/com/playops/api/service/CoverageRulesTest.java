package com.playops.api.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CoverageRulesTest {

    private static final List<String> ROUTES = List.of("/", "/products", "/cart", "/checkout");

    private static List<String> states(List<CoverageRules.Step> steps) {
        return steps.stream().map(CoverageRules.Step::state).toList();
    }

    // ---------------------------------------------------------------- 흐름 단계

    @Test
    void passedRunMarksEveryStepPassed() {
        assertThat(states(CoverageRules.flowSteps(ROUTES, "PASSED", -1, null)))
                .containsExactly("PASSED", "PASSED", "PASSED", "PASSED");
    }

    @Test
    void failureInTheMiddlePassesStepsBeforeAndLeavesStepsAfterUnreached() {
        List<CoverageRules.Step> steps = CoverageRules.flowSteps(ROUTES, "FAILED", 2, "'결제하기' 버튼을 찾지 못했습니다");

        assertThat(states(steps)).containsExactly("PASSED", "PASSED", "FAILED", "NOT_REACHED");
        assertThat(steps.get(2).message()).isEqualTo("'결제하기' 버튼을 찾지 못했습니다");
        assertThat(steps.get(0).message()).isNull();
        assertThat(steps.get(3).message()).isNull();
    }

    @Test
    void failureWhoseSelectorIsOnNoScreenFailsTheLastStep() {
        int index = CoverageRules.failedStepIndex(ROUTES, "role|button|없는 버튼", Map.of("/cart", Set.of("role|button|담기")));

        assertThat(index).isEqualTo(-1);
        assertThat(states(CoverageRules.flowSteps(ROUTES, "FAILED", index, "x")))
                .containsExactly("PASSED", "PASSED", "PASSED", "FAILED");
    }

    @Test
    void neverRunFlowIsAllPending() {
        assertThat(states(CoverageRules.flowSteps(ROUTES, "NEVER_RUN", -1, null)))
                .containsExactly("PENDING", "PENDING", "PENDING", "PENDING");
        assertThat(CoverageRules.flowSteps(List.of(), "FAILED", -1, "x")).isEmpty();
    }

    @Test
    void failedStepIsTheFirstScreenThatHasTheFailedSelector() {
        Map<String, Set<String>> keys = Map.of(
                "/products", Set.of("role|link|장바구니"),
                "/cart", Set.of("role|button|결제하기", "role|link|장바구니"),
                "/checkout", Set.of("role|button|결제하기"));

        assertThat(CoverageRules.failedStepIndex(ROUTES, "role|button|결제하기", keys)).isEqualTo(2);
        // 공용 메뉴처럼 여러 화면에 있으면 앞 화면을 고른다 (뒤 화면을 고르면 앞 화면을 통과로 잘못 보여 줄 수 있다).
        assertThat(CoverageRules.failedStepIndex(ROUTES, "role|link|장바구니", keys)).isEqualTo(1);
        assertThat(CoverageRules.failedStepIndex(ROUTES, null, keys)).isEqualTo(-1);
    }

    @Test
    void infersVisitedScreensFromSelectorsThatBelongToOneScreenOnly() {
        Map<String, Set<String>> keys = new java.util.LinkedHashMap<>();
        keys.put("/login", Set.of("label|이메일", "role|button|로그인", "role|link|홈"));
        keys.put("/projects", Set.of("role|heading|프로젝트", "role|link|홈"));

        assertThat(CoverageRules.inferRoutes(
                List.of("label|이메일", "role|link|홈", "role|button|로그인", "role|heading|프로젝트", "text|없음"), keys))
                .containsExactly("/login", "/projects");
    }

    // ---------------------------------------------------------------- 화면 상태

    @Test
    void screenStatePriorityIsBlockedThenTestedThenObservedThenUnseen() {
        assertThat(CoverageRules.screenState(List.of("SELECTOR_FAILED"), true, true)).isEqualTo("BLOCKED");
        assertThat(CoverageRules.screenState(List.of("LOGIN_REQUIRED"), false, false)).isEqualTo("BLOCKED");
        assertThat(CoverageRules.screenState(List.of("OPEN_FAILED"), true, false)).isEqualTo("BLOCKED");
        assertThat(CoverageRules.screenState(List.of("EXPLORE_STOPPED"), false, true)).isEqualTo("BLOCKED");
        // 닿지 못함은 안내일 뿐 막힌 것이 아니다.
        assertThat(CoverageRules.screenState(List.of("NOT_REACHED"), false, true)).isEqualTo("OBSERVED");
        assertThat(CoverageRules.screenState(List.of(), true, true)).isEqualTo("TESTED");
        assertThat(CoverageRules.screenState(List.of(), false, true)).isEqualTo("OBSERVED");
        assertThat(CoverageRules.screenState(List.of(), false, false)).isEqualTo("UNSEEN");
    }

    @Test
    void siteAndRecordedOriginsCountAsSeen() {
        assertThat(CoverageRules.seenOrigin("SITE")).isTrue();
        assertThat(CoverageRules.seenOrigin("RECORDED")).isTrue();
        assertThat(CoverageRules.seenOrigin("CODE")).isFalse();
        assertThat(CoverageRules.seenOrigin("MANUAL")).isFalse();
    }

    @Test
    void failedEdgeWinsOverTestedAndObserved() {
        assertThat(CoverageRules.strongerEdge("TESTED", "FAILED")).isEqualTo("FAILED");
        assertThat(CoverageRules.strongerEdge("OBSERVED", "TESTED")).isEqualTo("TESTED");
        assertThat(CoverageRules.strongerEdge("UNKNOWN", "OBSERVED")).isEqualTo("OBSERVED");
    }

    // ---------------------------------------------------------------- 메시지

    @Test
    void clickTimeoutBecomesCouldNotFindButton() {
        CoverageRules.Explained explained = CoverageRules.explain("""
                locator.click: Timeout 30000ms exceeded.
                Call log:
                  - waiting for getByRole('button', { name: '결제하기' })
                """);

        assertThat(explained.kind()).isEqualTo("SELECTOR_FAILED");
        assertThat(explained.message()).isEqualTo("'결제하기' 버튼을 찾지 못했습니다");
        assertThat(explained.selector()).isEqualTo("getByRole('button', { name: '결제하기' })");
        assertThat(explained.key()).isEqualTo("role|button|결제하기");
    }

    @Test
    void particleFollowsTheLastSyllable() {
        assertThat(CoverageRules.explain("locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('link', { name: '홈' })")
                .message()).isEqualTo("'홈' 링크를 찾지 못했습니다");
        assertThat(CoverageRules.explain("locator.fill: Timeout 30000ms exceeded.\n  - waiting for getByLabel('이메일')")
                .message()).isEqualTo("'이메일' 입력칸을 찾지 못했습니다");
        assertThat(CoverageRules.josa("button", "을", "를")).isEqualTo("을(를)");
    }

    @Test
    void scopedSelectorReportsTheInnerTarget() {
        CoverageRules.Explained explained = CoverageRules.explain("""
                locator.click: Timeout 30000ms exceeded.
                Call log:
                  - waiting for getByRole('navigation').getByRole('link', { name: '주문 내역' })
                """);

        assertThat(explained.message()).isEqualTo("'주문 내역' 링크를 찾지 못했습니다");
        assertThat(explained.key()).isEqualTo("role|link|주문 내역");
    }

    @Test
    void expectWithDifferentValueSaysItDiffersFromExpected() {
        CoverageRules.Explained explained = CoverageRules.explain("""
                Error: expect(locator).toHaveText(expected) failed

                Locator:  getByTestId('cart-count')
                Expected: "3"
                Received: "2"
                Timeout:  5000ms
                """);

        assertThat(explained.message()).isEqualTo("'cart-count' 요소가 기대와 다릅니다");
        assertThat(explained.key()).isEqualTo("testid|cart-count");
    }

    @Test
    void expectVisibleOnMissingElementSaysNotFound() {
        CoverageRules.Explained explained = CoverageRules.explain("""
                Error: expect(locator).toBeVisible() failed

                Locator: getByRole('heading', { name: '주문 완료' })
                Expected: visible
                Timeout: 5000ms
                Error: element(s) not found

                Call log:
                  - Expect "toBeVisible" with timeout 5000ms
                  - waiting for getByRole('heading', { name: '주문 완료' })
                """);

        assertThat(explained.message()).isEqualTo("'주문 완료' 제목을 찾지 못했습니다");
    }

    @Test
    void expectWithAnsiColorsIsReadAfterStrippingThem() {
        String colored = "\u001B[2mexpect(\u001B[22m\u001B[31mreceived\u001B[39m\u001B[2m).\u001B[22mtoBeChecked\u001B[2m()\u001B[22m\n\n"
                + "Locator: getByRole('checkbox', { name: '약관 동의' })\nExpected: checked\nReceived: unchecked";

        assertThat(CoverageRules.explain(colored).message()).isEqualTo("'약관 동의' 체크박스가 기대와 다릅니다");
    }

    @Test
    void otherFailuresUsePlainSentences() {
        assertThat(CoverageRules.explain("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/\nCall log:\n"
                + "  - navigating to \"http://localhost:3000/\", waiting until \"load\"")).satisfies(e -> {
            assertThat(e.kind()).isEqualTo("OPEN_FAILED");
            assertThat(e.message()).isEqualTo("화면을 열지 못했습니다");
        });
        assertThat(CoverageRules.explain("Error: 알 수 없는 오류").message()).isEqualTo("테스트가 이 화면에서 멈췄습니다");
        assertThat(CoverageRules.explain(null).message()).isEqualTo("테스트가 이 화면에서 멈췄습니다");
        assertThat(CoverageRules.explain("Error: expect(page).toHaveURL(expected) failed\n\nExpected: \"/done\"").message())
                .isEqualTo("도착한 화면 주소가 기대와 다릅니다");
        assertThat(CoverageRules.explain("Error: locator.click: Error: strict mode violation: getByRole('button', { name: '삭제' }) "
                + "resolved to 3 elements:").message()).isEqualTo("'삭제' 버튼이 여러 개라 어느 것인지 알 수 없습니다");
    }

    // ---------------------------------------------------------------- 사이트 탐색 경고 · 흐름 이름

    @Test
    void readsSiteExplorationWarnings() {
        assertThat(CoverageRules.readWarning("로그인 화면에서 탐색이 멈췄습니다. 로그인 계정(아이디·비밀번호)을 입력하고 다시 탐색하거나 화면을 직접 추가하세요."))
                .extracting(CoverageRules.WarningIssue::kind, CoverageRules.WarningIssue::action)
                .containsExactly("LOGIN_REQUIRED", "SET_LOGIN");
        CoverageRules.WarningIssue open = CoverageRules.readWarning("열기 실패: https://shop.example.com/orders — net::ERR_ABORTED");
        assertThat(open.kind()).isEqualTo("OPEN_FAILED");
        assertThat(open.url()).isEqualTo("https://shop.example.com/orders");
        assertThat(CoverageRules.readWarning("페이지 수 상한(20)에 도달했습니다. 남은 대기 3건")).isNull();
    }

    @Test
    void flowTitleIsTheFirstTestTitle() {
        assertThat(CoverageRules.firstTestTitle("""
                import { test, expect } from '@playwright/test';
                test.describe('주문', () => {
                  test.beforeEach(async ({ page }) => {});
                  test('상품을 담고 결제한다', async ({ page }) => {});
                  test('두 번째', async () => {});
                });
                """)).isEqualTo("상품을 담고 결제한다");
        assertThat(CoverageRules.firstTestTitle("test('it\\'s ok', async () => {})")).isEqualTo("it's ok");
        assertThat(CoverageRules.firstTestTitle("const x = 1;")).isNull();
        assertThat(CoverageRules.fileName("tests/recorded/order.spec.ts")).isEqualTo("order.spec.ts");
    }
}
