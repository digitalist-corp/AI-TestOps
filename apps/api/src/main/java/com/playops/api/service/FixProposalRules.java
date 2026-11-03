package com.playops.api.service;

/**
 * 실패한 테스트를 보고 "무엇이 문제이고 어떻게 고칠지"를 AI 없이 한 줄씩 쓴다. (수정 제안 카드)
 * 문제 문장은 구조 탭과 같은 CoverageRules.explain 을 쓴다. 고칠 방법 문장은 진행하면 그대로 AI 수정 지시문이 된다.
 */
final class FixProposalRules {

    private FixProposalRules() {
    }

    static final String PLAN_SELECTOR = "구조 지도에서 찾은 이름표로 셀렉터를 바꿔 고칠게요.";
    static final String PLAN_VALUE = "화면에 실제로 보이는 값을 확인해, 기대값이 바뀐 거라면 확인 조건을 고칠게요.";
    static final String PLAN_URL = "실제로 이동하는 주소에 맞게 이동 확인을 고칠게요.";
    static final String PLAN_OPEN = "사이트 주소와 대기 조건을 확인해 화면 열기 단계를 고칠게요.";
    static final String PLAN_STOPPED = "실패 기록을 보고 멈춘 단계를 고칠게요.";

    record Proposal(String problem, String plan) {}

    static Proposal of(String caseTitle, String error) {
        CoverageRules.Explained explained = CoverageRules.explain(error);
        String message = explained.message();
        String problem = caseTitle == null || caseTitle.isBlank() ? message : message + " · " + caseTitle.trim();
        return new Proposal(problem, plan(explained));
    }

    // ponytail: explain 의 문장 끝으로 갈래를 고른다. explain 이 유형 값을 더 세분하면 그 값으로 바꾼다.
    private static String plan(CoverageRules.Explained explained) {
        if (CoverageRules.ISSUE_OPEN_FAILED.equals(explained.kind())) return PLAN_OPEN;
        String message = explained.message();
        if (message.endsWith("찾지 못했습니다") || message.endsWith("알 수 없습니다")) return PLAN_SELECTOR;
        if (message.contains("주소가 기대와 다릅니다")) return PLAN_URL;
        if (message.endsWith("기대와 다릅니다")) return PLAN_VALUE;
        return PLAN_STOPPED;
    }
}
