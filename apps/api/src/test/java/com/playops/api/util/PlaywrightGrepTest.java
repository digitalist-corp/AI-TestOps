package com.playops.api.util;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Playwright --grep · --grep-invert 값 (#135). grep title 은 "testDir 기준 파일 묶음 [@태그] 제목 [@태그]".
 * 여기서 쓰는 문법(이스케이프 · (?:) · \S · ^$)은 Java 와 JS 가 같아 Java 로 확인한다. 실제 러너 확인은 PR 본문.
 */
class PlaywrightGrepTest {

    private static boolean matches(String pattern, String grepTitle) {
        return Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(grepTitle).find();
    }

    @Test
    void escapesJsSpecialCharactersWithBackslashNotQuote() {
        assertThat(PlaywrightGrep.escape("로그인(성공).v2 [a] {b} *+?^$|\\"))
                .isEqualTo("로그인\\(성공\\)\\.v2 \\[a\\] \\{b\\} \\*\\+\\?\\^\\$\\|\\\\")
                .doesNotContain("\\Q");
    }

    @Test
    void testPatternMatchesOnlyThatCaseOfThatFile() {
        String p = PlaywrightGrep.testTitle("tests/login.spec.ts", "로그인(성공)");
        assertThat(matches(p, "login.spec.ts 로그인(성공)")).isTrue();
        assertThat(matches(p, "login.spec.ts 로그인(성공) @smoke")).isTrue();
        assertThat(matches(p, "login.spec.ts 로그인(성공) 이후 이동")).isFalse(); // 다른 케이스
        assertThat(matches(p, "login.spec.ts 관리자 로그인(성공)")).isFalse();     // 다른 묶음
        assertThat(matches(p, "other.spec.ts 로그인(성공)")).isFalse();           // 다른 파일
        assertThat(matches(p, "a/login.spec.ts 로그인(성공)")).isFalse();         // 다른 폴더의 같은 이름 파일
        assertThat(matches(PlaywrightGrep.testTitle("tests/a.spec.ts", "v1.0 확인"), "a.spec.ts v1x0 확인")).isFalse();
    }

    @Test
    void fileMatchesWhereverTestDirIs() {
        String p = PlaywrightGrep.testTitle("tests/auth/login.spec.ts", "로그인");
        assertThat(matches(p, "auth/login.spec.ts 로그인")).isTrue();        // testDir=tests
        assertThat(matches(p, "tests/auth/login.spec.ts 로그인")).isTrue();  // testDir=.
        assertThat(matches(p, "login.spec.ts 로그인")).isTrue();             // testDir=tests/auth
    }

    @Test
    void describePatternMatchesEveryCaseUnderItEvenWithGroupTags() {
        String p = PlaywrightGrep.describeTitle("tests/a.spec.ts", "결제(카드)");
        assertThat(matches(p, "a.spec.ts 결제(카드) 승인")).isTrue();
        assertThat(matches(p, "a.spec.ts 결제(카드) @slow 안쪽 묶음 취소")).isTrue();
        assertThat(matches(p, "a.spec.ts 결제(카드)2 승인")).isFalse();
        assertThat(matches(p, "a.spec.ts 정기 결제(카드) 해지")).isFalse();
        // 묶음 태그가 묶음 제목 바로 뒤에 끼어도 케이스가 맞는다
        assertThat(matches(PlaywrightGrep.testTitle("tests/a.spec.ts", "외부 내부 케이스"), "a.spec.ts 외부 @slow 내부 케이스")).isTrue();
    }

    @Test
    void anyOfJoinsPatterns() {
        String p = PlaywrightGrep.anyOf(List.of(PlaywrightGrep.testTitle("x.spec.ts", "가"), PlaywrightGrep.testTitle("x.spec.ts", "나.다")));
        assertThat(matches(p, "x.spec.ts 가")).isTrue();
        assertThat(matches(p, "x.spec.ts 나.다")).isTrue();
        assertThat(matches(p, "x.spec.ts 나x다")).isFalse();
        assertThat(PlaywrightGrep.anyOf(List.of())).isNull();
    }
}
