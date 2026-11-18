package com.playops.api.controller;

import com.playops.api.dto.RunTestRequest.CaseKey;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 테스트 탭에서 고른 케이스 실행 (3차 2번). 화면은 케이스 키를 넘기고 서버가 #135 정확 일치 패턴을 만든다.
 * 비슷한 제목의 다른 케이스(관리자 로그인 · 로그인 실패 · 다른 파일)는 같이 돌지 않는다.
 */
class RunCasesTest {

    private static boolean runs(String grep, String grepTitle) {
        return Pattern.compile(grep, Pattern.CASE_INSENSITIVE).matcher(grepTitle).find();
    }

    @Test
    void pickedCaseRunsAloneNotSimilarTitles() {
        String grep = ProjectWorkspaceController.casesGrep(List.of(new CaseKey("tests/a.spec.ts", "로그인", "TEST")));

        assertThat(runs(grep, "a.spec.ts 로그인")).isTrue();
        assertThat(runs(grep, "a.spec.ts 관리자 로그인")).isFalse();
        assertThat(runs(grep, "a.spec.ts 로그인 실패")).isFalse();
        assertThat(runs(grep, "b.spec.ts 로그인")).isFalse();
    }

    @Test
    void pickedGroupRunsEveryCaseUnderIt() {
        String grep = ProjectWorkspaceController.casesGrep(List.of(new CaseKey("tests/a.spec.ts", "결제", "DESCRIBE")));

        assertThat(runs(grep, "a.spec.ts 결제 카드")).isTrue();
        assertThat(runs(grep, "a.spec.ts 정기 결제 해지")).isFalse();
    }

    @Test
    void severalCasesAcrossFiles() {
        String grep = ProjectWorkspaceController.casesGrep(List.of(
                new CaseKey("tests/a.spec.ts", "로그인", "TEST"), new CaseKey("tests/b.spec.ts", "결제(카드)", "TEST")));

        assertThat(runs(grep, "a.spec.ts 로그인")).isTrue();
        assertThat(runs(grep, "b.spec.ts 결제(카드)")).isTrue();
        assertThat(runs(grep, "a.spec.ts 결제(카드)")).isFalse();
    }
}
