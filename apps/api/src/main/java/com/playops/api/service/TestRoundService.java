package com.playops.api.service;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 차수(N차 테스트). 사용자가 돌린 실행을 순서대로 1차, 2차…로 부르고, 한 차수의 케이스가
 * 지난번과 비교해 어떻게 바뀌었는지 알려 준다. 따로 저장하지 않고 실행 이력에서 계산한다.
 *
 * - 번호: 프로젝트의 실행을 id 순으로 센다. 아직 돌지 않은 예약(SCHEDULED)은 세지 않는다.
 * - 비교: 케이스(spec 경로 + 케이스 이름)마다 "그 케이스를 마지막으로 돌린 앞 차수"와 비교한다.
 *   한 spec 만 돌린 차수가 끼어 있어도 다른 케이스의 비교가 끊기지 않게 하려는 것이다.
 */
@Service
public class TestRoundService {

    public static final String NEW_FAIL = "NEW_FAIL";
    public static final String STILL_FAIL = "STILL_FAIL";
    public static final String FIXED = "FIXED";
    public static final String STILL_PASS = "STILL_PASS";
    public static final String FIRST_RUN = "FIRST_RUN";
    public static final String SKIPPED = "SKIPPED";

    public record Round(int round, Long executionId, String status, String title, String source,
                        Instant startedAt, Instant finishedAt, Long durationMs,
                        int total, int passed, int failed, int skipped) {}

    public record RoundCase(String specPath, String caseTitle, String status, String errorMessage,
                            String change, Integer previousRound) {}

    public record RoundDetail(Round round, Integer previousRound, Map<String, Integer> changes, List<RoundCase> cases) {}

    private final ExecutionRepository executionRepository;
    private final ExecutionCaseResultRepository caseResultRepository;

    public TestRoundService(ExecutionRepository executionRepository, ExecutionCaseResultRepository caseResultRepository) {
        this.executionRepository = executionRepository;
        this.caseResultRepository = caseResultRepository;
    }

    /** 최신 차수부터. */
    public List<Round> list(String projectId) {
        return number(executionRepository.findByProjectIdOrderByCreatedAtDesc(projectId));
    }

    public RoundDetail detail(String projectId, Long executionId) {
        List<Round> rounds = list(projectId);
        Round round = rounds.stream().filter(r -> r.executionId().equals(executionId)).findFirst()
                .orElseThrow(() -> new ApiException(404, "차수를 찾을 수 없습니다: " + executionId));
        Map<Long, Integer> roundOf = new HashMap<>();
        rounds.forEach(r -> roundOf.put(r.executionId(), r.round()));

        List<RoundCase> cases = compare(caseResultRepository.findByExecutionIdOrderByIdAsc(executionId),
                caseResultRepository.findEarlierInProject(projectId, executionId), roundOf);
        Map<String, Integer> changes = new LinkedHashMap<>();
        for (String change : List.of(NEW_FAIL, STILL_FAIL, FIXED, STILL_PASS, FIRST_RUN, SKIPPED)) {
            changes.put(change, 0);
        }
        cases.forEach(c -> changes.merge(c.change(), 1, Integer::sum));
        Integer previous = round.round() > 1 ? round.round() - 1 : null;
        return new RoundDetail(round, previous, changes, cases);
    }

    /** 실행 목록(어떤 순서든)에 차수를 매겨 최신부터 돌려준다. */
    static List<Round> number(List<Execution> executions) {
        List<Execution> ran = executions.stream()
                .filter(e -> e.getStatus() != ExecutionStatus.SCHEDULED)
                .sorted((a, b) -> Long.compare(a.getId(), b.getId()))
                .toList();
        List<Round> rounds = new ArrayList<>();
        for (int i = ran.size() - 1; i >= 0; i--) {
            Execution e = ran.get(i);
            rounds.add(new Round(i + 1, e.getId(), e.getStatus().name(), titleOf(e), e.getSource(),
                    e.getStartedAt(), e.getFinishedAt(), e.getDurationMs(),
                    orZero(e.getTotalTests()), orZero(e.getPassedTests()), orZero(e.getFailedTests()),
                    orZero(e.getSkippedTests())));
        }
        return rounds;
    }

    /**
     * @param current 이번 차수의 케이스 결과
     * @param earlier 앞선 차수들의 결과(건너뜀 제외), 최신 실행부터
     */
    static List<RoundCase> compare(List<ExecutionCaseResult> current, List<ExecutionCaseResult> earlier,
                                   Map<Long, Integer> roundOf) {
        Map<String, ExecutionCaseResult> last = new HashMap<>();
        for (ExecutionCaseResult r : earlier) {
            if (!SKIPPED.equals(r.getStatus())) {
                last.putIfAbsent(keyOf(r), r);
            }
        }
        List<RoundCase> cases = new ArrayList<>();
        for (ExecutionCaseResult r : current) {
            ExecutionCaseResult before = SKIPPED.equals(r.getStatus()) ? null : last.get(keyOf(r));
            String change = changeOf(r.getStatus(), before == null ? null : before.getStatus());
            cases.add(new RoundCase(r.getSpecPath(), r.getCaseTitle(), r.getStatus(), r.getErrorMessage(), change,
                    before == null ? null : roundOf.get(before.getExecutionId())));
        }
        return cases;
    }

    private static String changeOf(String now, String before) {
        if (SKIPPED.equals(now)) return SKIPPED;
        boolean failed = "FAILED".equals(now);
        if (before == null) return FIRST_RUN;
        boolean failedBefore = "FAILED".equals(before);
        if (failed) return failedBefore ? STILL_FAIL : NEW_FAIL;
        return failedBefore ? FIXED : STILL_PASS;
    }

    private static String keyOf(ExecutionCaseResult r) {
        return r.getSpecPath() + "\n" + r.getCaseTitle();
    }

    private static String titleOf(Execution e) {
        if (e.getCaseTitle() != null && !e.getCaseTitle().isBlank()) return e.getCaseTitle();
        if (e.getSpecPath() != null && !e.getSpecPath().isBlank()) return e.getSpecPath();
        if (e.getGrepFilter() != null && !e.getGrepFilter().isBlank()) return e.getGrepFilter();
        return "전체 실행";
    }

    private static int orZero(Integer value) {
        return value == null ? 0 : value;
    }
}
