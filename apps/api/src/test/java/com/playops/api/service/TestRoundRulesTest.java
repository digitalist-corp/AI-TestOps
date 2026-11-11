package com.playops.api.service;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 차수 번호와 지난 차수 대비 변화 규칙. */
class TestRoundRulesTest {

    private static Execution execution(long id, ExecutionStatus status) {
        Execution e = new Execution();
        e.setId(id);
        e.setProjectId("p1");
        e.setStatus(status);
        return e;
    }

    private static ExecutionCaseResult result(long executionId, String spec, String title, String status) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(executionId);
        r.setSpecPath(spec);
        r.setCaseTitle(title);
        r.setStatus(status);
        return r;
    }

    @Test
    void roundsCountFromTheFirstRunAndSkipNotYetRunSchedules() {
        // 저장소는 최신순으로 준다.
        List<TestRoundService.Round> rounds = TestRoundService.number(List.of(
                execution(9, ExecutionStatus.SCHEDULED),
                execution(7, ExecutionStatus.FAILED),
                execution(4, ExecutionStatus.PASSED),
                execution(2, ExecutionStatus.PASSED)));

        assertThat(rounds).extracting(TestRoundService.Round::round, TestRoundService.Round::executionId)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(3, 7L),
                        org.assertj.core.groups.Tuple.tuple(2, 4L),
                        org.assertj.core.groups.Tuple.tuple(1, 2L));
    }

    @Test
    void eachCaseIsComparedWithTheLastRoundThatRanIt() {
        Map<Long, Integer> roundOf = Map.of(2L, 1, 4L, 2, 7L, 3);
        List<ExecutionCaseResult> current = List.of(
                result(7, "a.spec.ts", "로그인", "FAILED"),     // 2차 통과 → 새로 실패
                result(7, "a.spec.ts", "로그아웃", "FAILED"),   // 2차 실패 → 계속 실패
                result(7, "b.spec.ts", "주문", "PASSED"),       // 1차 실패(2차는 안 돌림) → 고쳐짐
                result(7, "b.spec.ts", "검색", "PASSED"),       // 2차 통과 → 계속 통과
                result(7, "c.spec.ts", "새 기능", "PASSED"),    // 처음
                result(7, "c.spec.ts", "보류", "SKIPPED"));
        // 이전 결과는 최신 실행부터
        List<ExecutionCaseResult> prior = List.of(
                result(4, "a.spec.ts", "로그인", "PASSED"),
                result(4, "a.spec.ts", "로그아웃", "FAILED"),
                result(4, "b.spec.ts", "검색", "PASSED"),
                result(4, "b.spec.ts", "주문", "SKIPPED"),      // 건너뛴 것은 비교 대상이 아니다
                result(2, "b.spec.ts", "주문", "FAILED"),
                result(2, "a.spec.ts", "로그인", "FAILED"));

        List<TestRoundService.RoundCase> cases = TestRoundService.compare(current, prior, roundOf);

        assertThat(cases).extracting(TestRoundService.RoundCase::caseTitle, TestRoundService.RoundCase::change,
                        TestRoundService.RoundCase::previousRound)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("로그인", TestRoundService.NEW_FAIL, 2),
                        org.assertj.core.groups.Tuple.tuple("로그아웃", TestRoundService.STILL_FAIL, 2),
                        org.assertj.core.groups.Tuple.tuple("주문", TestRoundService.FIXED, 1),
                        org.assertj.core.groups.Tuple.tuple("검색", TestRoundService.STILL_PASS, 2),
                        org.assertj.core.groups.Tuple.tuple("새 기능", TestRoundService.FIRST_RUN, null),
                        org.assertj.core.groups.Tuple.tuple("보류", TestRoundService.SKIPPED, null));
    }
}
