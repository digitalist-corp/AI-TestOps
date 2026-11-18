package com.playops.api.util;

import org.junit.jupiter.api.Test;

import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Playwright --grep · --grep-invert 값 (#135). Playwright 는 "파일 묶음 제목 @태그"를 공백으로 이은 문자열에 JS 정규식으로 맞춘다.
 * 여기서 쓰는 문법(이스케이프 · (?:) · \S · ^$)은 Java 와 JS 가 같아 Java 로 확인한다. 실제 러너 확인은 PR 본문.
 */
class PlaywrightGrepTest {

    private static boolean matches(String pattern, String grepTitle) {
        return Pattern.compile(pattern).matcher(grepTitle).find();
    }

    @Test
    void escapesJsSpecialCharactersWithBackslashNotQuote() {
        assertThat(PlaywrightGrep.escape("로그인(성공).v2 [a] {b} *+?^$|\\"))
                .isEqualTo("로그인\\(성공\\)\\.v2 \\[a\\] \\{b\\} \\*\\+\\?\\^\\$\\|\\\\")
                .doesNotContain("\\Q");
    }

    @Test
    void testPatternMatchesExactlyThatCaseIncludingTags() {
        String p = PlaywrightGrep.testTitle("로그인(성공)");
        assertThat(matches(p, "login.spec.ts 로그인(성공)")).isTrue();
        assertThat(matches(p, "login.spec.ts 로그인(성공) @smoke")).isTrue();
        assertThat(matches(p, "login.spec.ts 로그인(성공) 이후 이동")).isFalse(); // 다른 케이스
        assertThat(matches(p, "login.spec.ts 다른로그인(성공)")).isFalse();
        assertThat(matches(PlaywrightGrep.testTitle("v1.0 확인"), "a.spec.ts v1x0 확인")).isFalse(); // 마침표는 글자 그대로
        assertThat(matches(PlaywrightGrep.testTitle("묶음 로그인"), "a.spec.ts 묶음 로그인")).isTrue();
    }

    @Test
    void describePatternMatchesEveryCaseUnderIt() {
        String p = PlaywrightGrep.describeTitle("결제(카드)");
        assertThat(matches(p, "a.spec.ts 결제(카드) 승인")).isTrue();
        assertThat(matches(p, "a.spec.ts 결제(카드) 안쪽 묶음 취소")).isTrue();
        assertThat(matches(p, "a.spec.ts 결제(카드)2 승인")).isFalse();
    }

    @Test
    void anyOfJoinsPatterns() {
        String p = PlaywrightGrep.anyOf(java.util.List.of(PlaywrightGrep.testTitle("가"), PlaywrightGrep.testTitle("나.다")));
        assertThat(matches(p, "x.spec.ts 가")).isTrue();
        assertThat(matches(p, "x.spec.ts 나.다")).isTrue();
        assertThat(matches(p, "x.spec.ts 나x다")).isFalse();
        assertThat(PlaywrightGrep.anyOf(java.util.List.of())).isNull();
    }
}
