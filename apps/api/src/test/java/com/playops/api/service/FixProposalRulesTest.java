package com.playops.api.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FixProposalRulesTest {

    @Test
    void missingElementProposesSwappingTheSelectorFromTheStructureMap() {
        FixProposalRules.Proposal p = FixProposalRules.of("장바구니 > 결제",
                "locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('link', { name: '홈' })");
        assertThat(p.problem()).isEqualTo("'홈' 링크를 찾지 못했습니다 · 장바구니 > 결제");
        assertThat(p.plan()).isEqualTo(FixProposalRules.PLAN_SELECTOR);
    }

    @Test
    void ambiguousElementAlsoProposesASelectorFix() {
        FixProposalRules.Proposal p = FixProposalRules.of(null,
                "Error: locator.click: Error: strict mode violation: getByRole('button', { name: '삭제' }) resolved to 3 elements:");
        assertThat(p.problem()).isEqualTo("'삭제' 버튼이 여러 개라 어느 것인지 알 수 없습니다");
        assertThat(p.plan()).isEqualTo(FixProposalRules.PLAN_SELECTOR);
    }

    @Test
    void eachOtherErrorKindGetsItsOwnPlan() {
        assertThat(FixProposalRules.of("t", "Error: expect(page).toHaveURL(expected) failed\n\nExpected: \"/done\"").plan())
                .isEqualTo(FixProposalRules.PLAN_URL);
        assertThat(FixProposalRules.of("t", "Error: expect(locator).toHaveText(expected) failed\n\n"
                + "Locator: getByRole('heading', { name: '주문 완료' })\nExpected string: \"주문 완료\"\nReceived string: \"주문 실패\"").plan())
                .isEqualTo(FixProposalRules.PLAN_VALUE);
        assertThat(FixProposalRules.of("t", "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/").plan())
                .isEqualTo(FixProposalRules.PLAN_OPEN);
        assertThat(FixProposalRules.of("t", "Error: 알 수 없는 오류").plan()).isEqualTo(FixProposalRules.PLAN_STOPPED);
        assertThat(FixProposalRules.of(" ", null).problem()).isEqualTo("테스트가 이 화면에서 멈췄습니다");
    }
}
