package com.playops.api.util;

import java.util.ArrayList;
import java.util.List;

/**
 * Playwright --grep · --grep-invert 값 (#135). Playwright 는 "파일 묶음 [@묶음태그] … 제목 [@태그]"를 공백으로 이은 문자열(grep title)에
 * JS 정규식으로 맞춘다. 파일은 testDir 기준 경로(auth/login.spec.ts)로 맨 앞에 온다 (1.53 _grepTitle, 러너에서 확인).
 * 시나리오의 grep 은 "상위 묶음 제목 + 자기 제목"이라 파일로 앞을, 끝을 고정해야 "로그인"이 다른 파일 · 묶음의 "관리자 로그인"을 잡지 않는다.
 */
public final class PlaywrightGrep {

    private PlaywrightGrep() {}

    /** JS 정규식 특수문자를 백슬래시로. Pattern.quote(\Q…\E)는 JS 가 몰라서 아무것도 맞지 않는다. */
    public static String escape(String text) {
        return text.replaceAll("[.*+?^${}()|\\[\\]\\\\]", "\\\\$0");
    }

    /** 케이스 하나: 그 파일의 그 제목 끝까지. 뒤 @태그 허용. specPath 는 프로젝트 기준 경로(tests/a.spec.ts). */
    public static String testTitle(String specPath, String grep) {
        return file(specPath) + segments(grep) + "(?: @\\S+)*$";
    }

    /** 묶음 하나: 그 파일의 그 묶음 아래 케이스 전부. */
    public static String describeTitle(String specPath, String grep) {
        return file(specPath) + segments(grep) + "(?: |$)";
    }

    /** 패턴을 | 로 잇는다. 없으면 null. */
    public static String anyOf(List<String> patterns) {
        return patterns.isEmpty() ? null : String.join("|", patterns);
    }

    /** 맨 앞 파일: testDir 이 어디든 맞도록 경로의 뒷부분들 중 하나 (경로 중간의 같은 이름 파일은 '/' 앞이라 안 맞는다). */
    private static String file(String specPath) {
        String[] parts = specPath.replace('\\', '/').replaceAll("^\\./", "").split("/");
        List<String> suffixes = new ArrayList<>();
        for (int i = 0; i < parts.length; i++) {
            suffixes.add(escape(String.join("/", List.of(parts).subList(i, parts.length))));
        }
        return "(?:^| )(?:" + String.join("|", suffixes) + ") ";
    }

    /** 단어 사이에 묶음 태그(@slow)가 끼어도 맞게. */
    private static String segments(String grep) {
        return escape(grep).replace(" ", "(?: @\\S+)* ");
    }
}
