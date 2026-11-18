package com.playops.api.service;

import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.dto.PlanDtos.PlanSummary;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ScenarioCaseSettingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 테스트 계획 표(F-1). 계획 항목 = 테스트 케이스(TEST 노드) 하나.
 * 계획 칸은 사용 여부와 같은 scenario_case_settings 행에 있다. 키는 (파일 경로, grep) — 테스트 제목이 바뀌면 다른 항목이 된다.
 */
@Service
public class PlanService {

    private static final String TEST = "TEST";
    private static final Set<String> PRIORITIES = Set.of("HIGH", "MEDIUM", "LOW");

    private final PlaywrightScenarioService scenarioService;
    private final ScenarioCaseSettingRepository settingRepository;
    private final ExecutionCaseResultRepository caseResultRepository;
    private final ProjectService projectService;
    private final ProjectMemberService memberService;

    public PlanService(PlaywrightScenarioService scenarioService,
                       ScenarioCaseSettingRepository settingRepository,
                       ExecutionCaseResultRepository caseResultRepository,
                       ProjectService projectService,
                       ProjectMemberService memberService) {
        this.scenarioService = scenarioService;
        this.settingRepository = settingRepository;
        this.caseResultRepository = caseResultRepository;
        this.projectService = projectService;
        this.memberService = memberService;
    }

    /** 계획 항목과 그 결과 이력(최신 실행부터, 실행마다 하나). 계획 표와 결함 리스트(#80)가 같은 매칭을 쓴다. */
    public record Tracked(PlanItem item, List<ExecutionCaseResult> history) {}

    public PlanResponse get(String projectId) {
        List<PlanItem> items = sort(tracked(projectId).stream().map(Tracked::item).toList());
        return new PlanResponse(items, summarize(items));
    }

    public List<Tracked> tracked(String projectId) {
        Map<String, ScenarioCaseSetting> settings = new HashMap<>();
        for (ScenarioCaseSetting s : settingRepository.findByProjectId(projectId)) {
            if (TEST.equals(s.getNodeType())) settings.put(key(s.getSpecPath(), s.getGrepFilter()), s);
        }
        // ponytail: 프로젝트의 모든 케이스 결과를 읽는다. 이력이 수만 건이 되면 케이스별 마지막 결과만 고르는 쿼리로 바꾼다.
        Map<Long, String> names = memberService.namesOf(settings.values().stream().map(ScenarioCaseSetting::getUpdatedBy).toList());
        Map<String, List<ExecutionCaseResult>> results =
                byLeaf(caseResultRepository.findEarlierInProject(projectId, Long.MAX_VALUE));

        return flatten(scenarioService.analyze(projectId)).stream().map(item -> {
            ScenarioCaseSetting s = settings.get(key(item.specPath(), item.grep()));
            List<ExecutionCaseResult> history = historyFor(item, results);
            ExecutionCaseResult r = history.isEmpty() ? null : history.get(0);
            return new Tracked(new PlanItem(item.specPath(), item.grep(), item.title(), item.describePath(), item.line(),
                    item.enabled(), item.parentEnabled(),
                    s != null ? s.getSortOrder() : null,
                    s != null ? s.getAssignee() : null,
                    s != null ? s.getAssigneeUserId() : null,
                    s != null ? s.getDueDate() : null,
                    s != null ? s.getPriority() : null,
                    r != null ? r.getStatus() : null,
                    r != null ? r.getCreatedAt() : null,
                    s != null && s.getUpdatedBy() != null ? names.get(s.getUpdatedBy()) : null,
                    s != null ? s.getUpdatedAt() : null), history);
        }).toList();
    }

    public void patch(String projectId, ItemPatch patch) {
        String priority = blankToNull(patch.priority());
        if (priority != null && !PRIORITIES.contains(priority)) {
            throw new ApiException(400, "우선순위는 HIGH, MEDIUM, LOW 중 하나입니다.");
        }
        String assignee = blankToNull(patch.assignee());
        if (assignee != null && assignee.length() > 100) {
            throw new ApiException(400, "담당자는 100자까지 쓸 수 있습니다.");
        }
        projectService.getProject(projectId);
        if (patch.assigneeUserId() != null) {
            Member member = memberService.list(projectId).stream()
                    .filter(m -> m.userId().equals(patch.assigneeUserId())).findFirst()
                    .orElseThrow(() -> new ApiException(400, "VALIDATION_ERROR", "담당자는 이 프로젝트의 멤버 중에서 고르세요."));
            assignee = member.displayName() != null && !member.displayName().isBlank() ? member.displayName() : member.username();
        }
        ScenarioCaseSetting s = row(projectId, patch.specPath(), patch.grep());
        if (patch.enabled() != null) s.setEnabled(patch.enabled());
        s.setAssigneeUserId(patch.assigneeUserId());
        s.setAssignee(assignee);
        s.setDueDate(patch.dueDate());
        s.setPriority(priority);
        settingRepository.save(s);
    }

    @Transactional
    public void reorder(String projectId, List<ItemKey> keys) {
        projectService.getProject(projectId);
        for (int i = 0; i < keys.size(); i++) {
            ScenarioCaseSetting s = row(projectId, keys.get(i).specPath(), keys.get(i).grep());
            s.setSortOrder(i);
            settingRepository.save(s);
        }
    }

    @Transactional
    public void setEnabled(String projectId, List<ItemKey> keys, boolean enabled) {
        projectService.getProject(projectId);
        for (ItemKey k : keys) {
            ScenarioCaseSetting s = row(projectId, k.specPath(), k.grep());
            s.setEnabled(enabled);
            settingRepository.save(s);
        }
    }

    /** TEST 행을 찾고, 없으면 "사용 · 계획 칸 비어 있음" 행을 만든다. */
    private ScenarioCaseSetting row(String projectId, String specPath, String grep) {
        String path = checkPath(specPath);
        if (grep == null || grep.isBlank()) throw new ApiException(400, "Invalid scenario grep");
        return settingRepository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(projectId, TEST, path, grep)
                .orElseGet(() -> {
                    ScenarioCaseSetting s = new ScenarioCaseSetting();
                    s.setProjectId(projectId);
                    s.setNodeType(TEST);
                    s.setSpecPath(path);
                    s.setGrepFilter(grep);
                    s.setEnabled(true);
                    return s;
                });
    }

    /** PlaywrightScenarioService.updateUsage 와 같은 경로 규칙. */
    private static String checkPath(String specPath) {
        if (specPath == null || specPath.isBlank()) throw new ApiException(400, "Invalid spec path");
        String p = specPath.replace('\\', '/').trim();
        if (p.startsWith("/") || p.contains("../") || p.equals("..") || p.startsWith("-")) {
            throw new ApiException(400, "Invalid spec path");
        }
        return p;
    }

    // ── 규칙 (테스트용 package-private) ──

    /** TEST 노드만 펼친다. 사용 여부 = 파일 · 상위 묶음 · 자기 자신이 모두 사용일 때. 계획 칸 · 결과는 비어 있다. */
    static List<PlanItem> flatten(ScenarioTreeResponse tree) {
        List<PlanItem> out = new ArrayList<>();
        for (ScenarioSpecFile spec : tree.specs()) {
            walk(spec.path(), spec.cases(), spec.enabled(), List.of(), out);
        }
        return out;
    }

    private static void walk(String spec, List<ScenarioCaseNode> nodes, boolean enabled, List<String> describes,
                             List<PlanItem> out) {
        for (ScenarioCaseNode n : nodes) {
            boolean on = enabled && n.enabled();
            if (TEST.equals(n.type())) {
                out.add(new PlanItem(spec, n.grep(), n.title(), String.join(" > ", describes), n.line(), on, enabled,
                        null, null, null, null, null, null, null, null, null));
            } else {
                List<String> next = new ArrayList<>(describes);
                next.add(n.title());
                walk(spec, n.children(), on, next, out);
            }
        }
    }

    /** 순서를 정한 항목이 앞, 나머지는 파일 경로 → 줄 번호. */
    static List<PlanItem> sort(List<PlanItem> items) {
        return items.stream().sorted(Comparator
                .comparing(PlanItem::sortOrder, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(PlanItem::specPath)
                .thenComparingInt(PlanItem::line)).toList();
    }

    static PlanSummary summarize(List<PlanItem> items) {
        List<PlanItem> on = items.stream().filter(PlanItem::enabled).toList();
        int passed = (int) on.stream().filter(i -> "PASSED".equals(i.lastStatus())).count();
        int failed = (int) on.stream().filter(i -> "FAILED".equals(i.lastStatus())).count();
        int notRun = on.size() - passed - failed;
        double rate = on.isEmpty() ? 0.0 : (double) passed / on.size();
        return new PlanSummary(items.size(), on.size(), items.size() - on.size(), passed, failed, notRun, rate);
    }

    /** 결과를 (리포트 경로, 마지막 제목)으로 묶는다. 들어온 순서(최신 실행부터)를 지킨다. */
    static Map<String, List<ExecutionCaseResult>> byLeaf(List<ExecutionCaseResult> newestFirst) {
        Map<String, List<ExecutionCaseResult>> out = new HashMap<>();
        for (ExecutionCaseResult r : newestFirst) {
            out.computeIfAbsent(key(r.getSpecPath(), leaf(r.getCaseTitle())), k -> new ArrayList<>()).add(r);
        }
        return out;
    }

    /**
     * 계획 항목의 결과 이력, 최신 실행부터 실행마다 하나. 리포트 경로는 testDir 기준이라 저장 경로의 뒷부분과 맞춘다
     * (SiteCoverageService 와 같은 규칙). 같은 제목이 다른 묶음에 있으면 "묶음 > 제목"으로 끝나는 결과만 쓴다.
     * 한 실행에 결과가 여러 개면(브라우저별) 먼저 저장된 것.
     */
    static List<ExecutionCaseResult> historyFor(PlanItem item, Map<String, List<ExecutionCaseResult>> byLeaf) {
        String tail = item.describePath().isEmpty() ? null : " > " + item.describePath() + " > " + item.title();
        Map<Long, ExecutionCaseResult> byExecution = new TreeMap<>(Comparator.reverseOrder());
        for (String suffix : SiteCoverageService.suffixes(item.specPath())) {
            for (ExecutionCaseResult r : byLeaf.getOrDefault(key(suffix, item.title()), List.of())) {
                if (tail != null && (r.getCaseTitle() == null || !r.getCaseTitle().endsWith(tail))) continue;
                byExecution.putIfAbsent(r.getExecutionId(), r);
            }
        }
        return new ArrayList<>(byExecution.values());
    }

    private static String leaf(String title) {
        if (title == null) return "";
        String[] parts = title.split(" > ");
        return parts[parts.length - 1].trim();
    }

    private static String key(String specPath, String name) {
        return specPath + "\n" + name;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
