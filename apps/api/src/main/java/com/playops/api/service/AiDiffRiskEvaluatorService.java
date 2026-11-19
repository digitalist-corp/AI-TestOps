package com.playops.api.service;

import com.playops.api.entity.Project;
import org.springframework.stereotype.Service;

import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * docs/ai-job-spec.md의 "Diff 위험도 평가"/"Assertion 약화 탐지 구현"을 실제 코드로 옮긴 것.
 * v1 AI Runner(ai-runner/run.js)는 unified diff가 아니라 파일별 "수정 전 전체 내용"과
 * "수정 후 전체 내용"을 그대로 주고받으므로, 여기서는 그 두 문자열을 파일마다 줄 단위로 직접 비교해 합산한다.
 * CODE_FIX가 대상 spec 파일뿐 아니라 그 spec이 import하는 관련 파일까지 함께 고칠 수 있으므로(멀티파일),
 * 평가는 항상 "이번 job이 건드린 파일 목록" 전체에 대해 수행한다 — 한 파일이라도 하드 게이트에 걸리면
 * job 전체가 NEEDS_REVIEW로 간다.
 * 판정 결과는 항상 "더 검토하는 쪽"으로 실패해야 한다 — 놓치는 것(false negative)이
 * 과탐(false positive)보다 훨씬 위험하기 때문이다 (문서의 정규식 탐지 원칙과 동일).
 */
@Service
public class AiDiffRiskEvaluatorService {

    private static final Pattern EXPECT_PATTERN = Pattern.compile("expect\\s*\\(");
    private static final Pattern SKIP_FIXME_PATTERN = Pattern.compile("\\.(skip|fixme)\\s*\\(");
    private static final Pattern ONLY_PATTERN = Pattern.compile("\\.only\\s*\\(");
    private static final Pattern WAIT_FOR_TIMEOUT_PATTERN = Pattern.compile("waitForTimeout\\s*\\(");
    /** 실제 사이트로 가는 길. 이게 줄거나 가짜 화면 · 가짜 응답이 생기면 테스트가 대상 사이트를 더는 보지 않는다 */
    private static final Pattern GOTO_PATTERN = Pattern.compile("\\.goto\\s*\\(");
    private static final Pattern FAKE_PAGE_PATTERN = Pattern.compile("setContent\\s*\\(|\\.fulfill\\s*\\(");

    /** 검증을 약하게 만드는 표시. 사람이 승인했어도 학습 기억(다음 루프의 예시)에는 넣지 않는다 (FailureService) */
    public static final List<String> WEAKENING_FLAGS =
            List.of("assertion_decreased", "skip_or_fixme_added", "only_added", "case_deleted", "target_bypassed");
    private static final Pattern TIMEOUT_VALUE_PATTERN = Pattern.compile("timeout\\s*:\\s*(\\d+)");
    private static final Pattern TEST_TITLE_PATTERN =
            Pattern.compile("test(?:\\.only|\\.skip)?\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]");

    /** "tests/support/**"처럼 여러 spec이 참조할 가능성이 높은 공유 리소스 경로. */
    private static final List<String> SHARED_RESOURCE_GLOBS = List.of("tests/support/**", "**/support/**", "**/fixtures/**");

    /** job이 건드린 파일 하나의 변경 전/후 전체 내용. */
    public record FileChange(String path, String beforeContent, String afterContent) {}

    public record Assessment(List<String> hardGateFlags, List<String> softNotes, int changedLines, int changedFiles) {
        public boolean hasHardGate() {
            return !hardGateFlags.isEmpty();
        }

        public boolean withinQuantitativeLimits(Project project) {
            int maxLines = project.getAiAutoApplyMaxChangedLines() != null ? project.getAiAutoApplyMaxChangedLines() : 30;
            int maxFiles = project.getAiAutoApplyMaxChangedFiles() != null ? project.getAiAutoApplyMaxChangedFiles() : 2;
            return changedLines <= maxLines && changedFiles <= maxFiles;
        }
    }

    /**
     * @param changes          이번 job이 건드린 파일들의 변경 전/후 전체 내용 (v1은 대상 spec 파일 1개뿐일 수도, 관련 파일 포함 여러 개일 수도 있음)
     * @param iterationsUsed   실제 사용한 반복 횟수
     * @param maxIterations    허용된 최대 반복 횟수
     */
    public Assessment evaluate(List<FileChange> changes, int iterationsUsed, int maxIterations) {
        List<String> flags = new ArrayList<>();
        List<String> softNotes = new ArrayList<>();
        int changedLines = 0;

        for (FileChange change : changes) {
            LineDiff diff = diffLines(change.beforeContent(), change.afterContent());

            int expectAdded = countMatches(diff.added, EXPECT_PATTERN);
            int expectRemoved = countMatches(diff.removed, EXPECT_PATTERN);
            if (expectRemoved > expectAdded) {
                flags.add("assertion_decreased(" + change.path() + ": expect " + expectRemoved + "->" + expectAdded + ")");
            }

            if (countMatches(diff.added, SKIP_FIXME_PATTERN) > 0) {
                flags.add("skip_or_fixme_added(" + change.path() + ")");
            }
            if (countMatches(diff.added, ONLY_PATTERN) > 0) {
                flags.add("only_added(" + change.path() + ")");
            }
            int gotoRemoved = countMatches(diff.removed, GOTO_PATTERN);
            int gotoAdded = countMatches(diff.added, GOTO_PATTERN);
            if (gotoRemoved > gotoAdded || countMatches(diff.added, FAKE_PAGE_PATTERN) > 0) {
                flags.add("target_bypassed(" + change.path() + ": page.goto " + gotoRemoved + "->" + gotoAdded
                        + ", setContent/route.fulfill " + countMatches(diff.added, FAKE_PAGE_PATTERN) + "개 추가)");
            }
            if (countMatches(diff.added, WAIT_FOR_TIMEOUT_PATTERN) > 0) {
                flags.add("wait_for_timeout_added(" + change.path() + ")");
            }

            changedLines += evaluateTimeoutIncrease(diff, change.path(), softNotes);

            Set<String> titlesBefore = extractTestTitles(change.beforeContent());
            Set<String> titlesAfter = extractTestTitles(change.afterContent());
            Set<String> deletedTitles = new LinkedHashSet<>(titlesBefore);
            deletedTitles.removeAll(titlesAfter);
            if (!deletedTitles.isEmpty()) {
                flags.add("case_deleted(" + change.path() + ": " + String.join(", ", deletedTitles) + ")");
            }

            if (matchesAny(change.path(), SHARED_RESOURCE_GLOBS)) {
                flags.add("shared_resource_touched(" + change.path() + ")");
            }

            changedLines += diff.added.size() + diff.removed.size();
        }

        if (iterationsUsed >= maxIterations) {
            flags.add("max_iterations_reached(" + iterationsUsed + "/" + maxIterations + ")");
        }

        return new Assessment(flags, softNotes, changedLines, changes.size());
    }

    private int evaluateTimeoutIncrease(LineDiff diff, String path, List<String> softNotes) {
        List<Integer> removedValues = extractTimeoutValues(diff.removed);
        List<Integer> addedValues = extractTimeoutValues(diff.added);
        if (addedValues.isEmpty()) {
            return 0;
        }
        int bonus = 0;
        for (int i = 0; i < addedValues.size(); i++) {
            int added = addedValues.get(i);
            Integer removed = i < removedValues.size() ? removedValues.get(i) : null;
            if (removed == null || added > removed) {
                bonus += 10;
                softNotes.add("timeout_increased(" + path + ": " + (removed == null ? "new" : removed) + "->" + added + ")");
            }
        }
        return bonus;
    }

    private List<Integer> extractTimeoutValues(List<String> lines) {
        List<Integer> values = new ArrayList<>();
        for (String line : lines) {
            Matcher m = TIMEOUT_VALUE_PATTERN.matcher(line);
            while (m.find()) {
                values.add(Integer.parseInt(m.group(1)));
            }
        }
        return values;
    }

    private Set<String> extractTestTitles(String content) {
        Set<String> titles = new LinkedHashSet<>();
        if (content == null) {
            return titles;
        }
        Matcher m = TEST_TITLE_PATTERN.matcher(content);
        while (m.find()) {
            titles.add(m.group(1));
        }
        return titles;
    }

    private int countMatches(List<String> lines, Pattern pattern) {
        int count = 0;
        for (String line : lines) {
            Matcher m = pattern.matcher(line);
            while (m.find()) {
                count++;
            }
        }
        return count;
    }

    private boolean matchesAny(String file, List<String> globs) {
        Path relative = Path.of(file);
        for (String glob : globs) {
            try {
                PathMatcher matcher = FileSystems.getDefault().getPathMatcher("glob:" + glob);
                if (matcher.matches(relative)) {
                    return true;
                }
            } catch (Exception ignored) {}
        }
        return false;
    }

    private record LineDiff(List<String> added, List<String> removed) {}

    /**
     * 표준 LCS 기반 줄 단위 diff. 테스트 spec 파일 하나 규모(수백 줄)를 가정한다.
     * 비정상적으로 큰 입력이 들어오면 O(n*m) DP 테이블 폭증을 피하기 위해, 정밀 비교 대신
     * "전부 바뀐 것으로" 보수적으로 처리한다 — 이 경우도 실패 방향은 "더 검토"로 향하므로 안전하다.
     */
    private LineDiff diffLines(String before, String after) {
        String[] a = before == null ? new String[0] : before.split("\n", -1);
        String[] b = after == null ? new String[0] : after.split("\n", -1);
        long cells = (long) (a.length + 1) * (b.length + 1);
        if (cells > 4_000_000L) {
            return new LineDiff(List.of(b), List.of(a));
        }

        int n = a.length;
        int m = b.length;
        int[][] dp = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                dp[i][j] = a[i].equals(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }

        List<String> added = new ArrayList<>();
        List<String> removed = new ArrayList<>();
        int i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i].equals(b[j])) {
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                removed.add(a[i]);
                i++;
            } else {
                added.add(b[j]);
                j++;
            }
        }
        while (i < n) {
            removed.add(a[i]);
            i++;
        }
        while (j < m) {
            added.add(b[j]);
            j++;
        }
        return new LineDiff(added, removed);
    }
}
