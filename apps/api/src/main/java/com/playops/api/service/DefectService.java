package com.playops.api.service;

import com.playops.api.dto.DefectDtos.Defect;
import com.playops.api.dto.DefectDtos.DefectResponse;
import com.playops.api.dto.DefectDtos.DefectRun;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.TestSuiteResponse;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.TestSuite;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.TestSuiteRepository;
import com.playops.api.service.PlanService.Tracked;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * 통합 결함 리스트(F-4, #80). 결함 = 사용 중 계획 항목의 실패. 결함 테이블 없이 계획 표와 같은 결과 매칭(PlanService.tracked)으로 계산한다.
 * 미해결 수가 계획 표 요약의 "실패" 수와 같다 (둘 다 사용 중 항목의 최근 결과가 실패인 것).
 */
@Service
public class DefectService {

    private static final Logger log = LoggerFactory.getLogger(DefectService.class);

    public static final String OPEN = "OPEN";
    public static final String RESOLVED = "RESOLVED";
    /** Playwright 오류 메시지에 섞인 터미널 색 코드 */
    private static final Pattern ANSI = Pattern.compile("\u001B\\[[0-9;]*m");
    /** executions.grep_filter · spec_path 칸 길이 (V1 VARCHAR(500), ai_ro 뷰가 써서 넓히지 않는다) */
    private static final int MAX_COLUMN = 500;

    private final PlanService planService;
    private final SiteCoverageService coverageService;
    private final TestSuiteRepository suiteRepository;
    private final ExecutionRepository executionRepository;
    private final ExecutionQueryService executionQueryService;

    public DefectService(PlanService planService, SiteCoverageService coverageService, TestSuiteRepository suiteRepository,
                         ExecutionRepository executionRepository, ExecutionQueryService executionQueryService) {
        this.planService = planService;
        this.coverageService = coverageService;
        this.suiteRepository = suiteRepository;
        this.executionRepository = executionRepository;
        this.executionQueryService = executionQueryService;
    }

    /** 필터는 모두 생략 가능: 상태(OPEN | RESOLVED) · 담당자 계정 · 스위트 · 화면(routeKey). 미해결 먼저, 최근 실행 순. */
    public DefectResponse list(String projectId, String status, Long assigneeUserId, Long suiteId, String screen) {
        if (status != null && !status.equals(OPEN) && !status.equals(RESOLVED)) {
            throw new ApiException(400, "상태는 OPEN 또는 RESOLVED 입니다.");
        }
        TestSuite suite = suiteId == null ? null : suiteRepository.findById(suiteId)
                .filter(s -> projectId.equals(s.getProjectId()))
                .orElseThrow(() -> new ApiException(404, "스위트를 찾을 수 없습니다."));
        List<String> suiteSpecs = suite == null ? List.of() : TestSuiteResponse.from(suite).specPaths();

        List<Defect> defects = new ArrayList<>();
        for (Tracked t : planService.tracked(projectId)) {
            PlanItem item = t.item();
            if (!item.enabled()) continue;
            if (assigneeUserId != null && !assigneeUserId.equals(item.assigneeUserId())) continue;
            if (suite != null && !inSuite(suiteSpecs, suite.getGrep(), item)) continue;
            Defect d = defectOf(item, t.history());
            if (d != null && (status == null || status.equals(d.status()))) defects.add(d);
        }
        if (!defects.isEmpty()) {
            List<SiteCoverageService.CoverageFlow> flows = flows(projectId);
            Map<Long, Long> rerunOf = new HashMap<>();
            executionRepository.findAllById(defects.stream().flatMap(d -> d.runs().stream()).map(DefectRun::executionId)
                            .distinct().toList())
                    .forEach(e -> { if (e.getRerunOf() != null) rerunOf.put(e.getId(), e.getRerunOf()); });
            defects = defects.stream().map(d -> d.withLinks(routesOf(d.specPath(), flows), d.runs().stream()
                    .map(r -> new DefectRun(r.executionId(), r.status(), r.at(), rerunOf.get(r.executionId())))
                    .toList())).toList();
        }
        if (screen != null && !screen.isBlank()) {
            defects = defects.stream().filter(d -> d.routeKeys().contains(screen)).toList();
        }
        defects = defects.stream().sorted(Comparator
                .comparing((Defect d) -> !OPEN.equals(d.status()))
                .thenComparing(Defect::lastExecutionId, Comparator.reverseOrder())
                .thenComparing(Defect::specPath)
                .thenComparing(Defect::title)).toList();
        int open = (int) defects.stream().filter(d -> OPEN.equals(d.status())).count();
        return new DefectResponse(defects, open, defects.size() - open);
    }

    /**
     * 결함 다시 실행(#82). items 가 비면 미해결 결함 전부, 있으면 고른 결함(해결된 것도 됨).
     * 파일로 좁히고 케이스 이름을 --grep 정규식으로 묶어 실행 하나로 돌린다. 원래 실행 = 고른 결함들이 마지막으로 실패한 실행 중 가장 최근.
     * 성공하면 결과로 계산하는 결함이 저절로 해결로 바뀐다.
     */
    public ExecutionResponse rerun(String projectId, List<ItemKey> items) {
        List<Defect> defects = list(projectId, null, null, null, null).defects();
        List<Defect> chosen;
        if (items == null || items.isEmpty()) {
            chosen = defects.stream().filter(d -> OPEN.equals(d.status())).toList();
        } else {
            chosen = new ArrayList<>();
            for (ItemKey k : items) {
                chosen.add(defects.stream()
                        .filter(d -> d.specPath().equals(k.specPath()) && d.grep().equals(k.grep())).findFirst()
                        .orElseThrow(() -> new ApiException(400, "결함 목록에 없는 케이스입니다: " + k.grep())));
            }
        }
        if (chosen.isEmpty()) throw new ApiException(400, "다시 실행할 결함이 없습니다.");
        String grep = String.join("|", chosen.stream().map(d -> escapeRegex(d.grep())).distinct().toList());
        List<String> specPaths = chosen.stream().map(Defect::specPath).distinct().toList();
        // 칸을 넘으면 막지 않고 넓혀서 돌린다: 이름이 넘치면 파일 단위, 파일 목록이 넘치면 사용 중 전체(이름으로 거름).
        // 더 많이 돌 뿐 결과는 맞다 — 사이트가 죽어 전부 실패했을 때 "실패만 다시 실행"이 막히지 않게.
        if (grep.length() > MAX_COLUMN) grep = null;
        if (String.join("\n", specPaths).length() > MAX_COLUMN) specPaths = List.of();
        Long rerunOf = chosen.stream().map(Defect::lastFailedExecutionId).max(Comparator.naturalOrder()).orElse(null);
        return executionQueryService.triggerRun(projectId, grep, null, specPaths,
                "결함 다시 실행 " + chosen.size() + "건", false, rerunOf);
    }

    /** 화면은 부가 정보라 확인 지도 계산이 실패해도 목록은 돌려준다. */
    private List<SiteCoverageService.CoverageFlow> flows(String projectId) {
        try {
            return coverageService.view(projectId).flows();
        } catch (RuntimeException e) {
            log.warn("결함 화면 계산 실패 (project={}): {}", projectId, e.getMessage());
            return List.of();
        }
    }

    // ── 규칙 (테스트용 package-private) ──

    /**
     * 결과 이력(최신 실행부터)으로 결함을 만든다. 실패한 적이 없으면 null.
     * 가장 최근의 연속 실패가 이번 결함이다. 그 뒤에 통과가 있으면 해결.
     */
    static Defect defectOf(PlanItem item, List<ExecutionCaseResult> newestFirst) {
        int latestFail = -1;
        for (int i = 0; i < newestFirst.size(); i++) {
            if ("FAILED".equals(newestFirst.get(i).getStatus())) {
                latestFail = i;
                break;
            }
        }
        if (latestFail < 0) return null;
        int firstFail = latestFail;
        while (firstFail + 1 < newestFirst.size() && "FAILED".equals(newestFirst.get(firstFail + 1).getStatus())) {
            firstFail++;
        }
        ExecutionCaseResult first = newestFirst.get(firstFail);
        ExecutionCaseResult lastFailed = newestFirst.get(latestFail);
        ExecutionCaseResult last = newestFirst.get(0);
        ExecutionCaseResult resolved = latestFail > 0 ? newestFirst.get(latestFail - 1) : null;
        List<DefectRun> runs = new ArrayList<>();
        for (int i = firstFail; i >= 0; i--) {
            ExecutionCaseResult r = newestFirst.get(i);
            runs.add(new DefectRun(r.getExecutionId(), r.getStatus(), r.getCreatedAt(), null));
            if (r == resolved) break;
        }
        return new Defect(item.specPath(), item.grep(), item.title(), item.describePath(),
                resolved == null ? OPEN : RESOLVED,
                item.assignee(), item.assigneeUserId(), firstFail - latestFail + 1,
                first.getExecutionId(), first.getCreatedAt(),
                last.getExecutionId(), last.getCreatedAt(),
                resolved == null ? null : resolved.getExecutionId(), resolved == null ? null : resolved.getCreatedAt(),
                lastFailed.getErrorMessage() == null ? null : ANSI.matcher(lastFailed.getErrorMessage()).replaceAll(""),
                List.of(), runs);
    }

    /** 이 파일을 지나는 흐름들의 화면, 지나는 순서대로 중복 없이. 경로는 뒷부분이 같으면 같은 파일로 본다. */
    static List<String> routesOf(String specPath, List<SiteCoverageService.CoverageFlow> flows) {
        Set<String> out = new LinkedHashSet<>();
        flows.stream().filter(f -> samePath(f.specPath(), specPath))
                .flatMap(f -> f.steps().stream())
                .map(SiteCoverageService.FlowStep::routeKey)
                .filter(Objects::nonNull)
                .forEach(out::add);
        return List.copyOf(out);
    }

    /** 웹 lib/plan.ts inSuite 와 같은 규칙: 파일이 스위트에 있고, grep 이 있으면 "파일 묶음 제목"이 맞아야 한다. */
    static boolean inSuite(List<String> specPaths, String grep, PlanItem item) {
        if (specPaths.stream().noneMatch(p -> samePath(p, item.specPath()))) return false;
        if (grep == null || grep.isBlank()) return true;
        String full = String.join(" ", List.of(item.specPath(), item.describePath(), item.title()).stream()
                .filter(s -> s != null && !s.isEmpty()).toList());
        try {
            return Pattern.compile(grep).matcher(full).find();
        } catch (PatternSyntaxException e) {
            return full.contains(grep);
        }
    }

    /** Playwright --grep 은 JS 정규식이라 웹 lib/plan.ts escapeRegex 와 같은 글자를 이스케이프한다. */
    static String escapeRegex(String s) {
        return s.replaceAll("[.*+?^${}()|\\[\\]\\\\]", "\\\\$0");
    }

    static boolean samePath(String a, String b) {
        if (a == null || b == null || a.isEmpty() || b.isEmpty()) return false;
        return a.equals(b) || a.endsWith("/" + b) || b.endsWith("/" + a);
    }
}
