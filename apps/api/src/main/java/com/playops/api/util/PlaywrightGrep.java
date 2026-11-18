package com.playops.api.util;

import java.util.List;

/**
 * Playwright --grep · --grep-invert 값 (#135). Playwright 는 "파일 묶음… 제목 @태그"를 공백으로 이은 문자열에 JS 정규식으로 맞춘다.
 * 시나리오의 grep 은 "상위 묶음 제목 + 자기 제목"이라, 앞은 공백 경계로 자르고 끝을 고정해야 "로그인"이 "로그인 실패"까지 잡지 않는다.
 */
public final class PlaywrightGrep {

    private PlaywrightGrep() {}

    /** JS 정규식 특수문자를 백슬래시로. Pattern.quote(\Q…\E)는 JS 가 몰라서 아무것도 맞지 않는다. */
    public static String escape(String text) {
        return text.replaceAll("[.*+?^${}()|\\[\\]\\\\]", "\\\\$0");
    }

    /** 케이스 하나: 제목 끝까지 같아야 한다. 뒤에 붙는 @태그는 허용. */
    public static String testTitle(String grep) {
        return "(?:^| )" + escape(grep) + "(?: @\\S+)*$";
    }

    /** 묶음 하나: 그 아래 케이스 전부. */
    public static String describeTitle(String grep) {
        return "(?:^| )" + escape(grep) + "(?: |$)";
    }

    /** 패턴을 | 로 잇는다. 없으면 null. */
    public static String anyOf(List<String> patterns) {
        return patterns.isEmpty() ? null : String.join("|", patterns);
    }
}
