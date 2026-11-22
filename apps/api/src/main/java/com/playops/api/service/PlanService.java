package com.playops.api.service;

import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.dto.PlanDtos.PlanSummary;
import com.playops.api.dto.PlanDtos.ScreenProgress;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.PlanEntry;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.PlanEntryRepository;
import com.playops.api.repository.ScenarioCaseSettingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Consumer;
import java.util.stream.Stream;

import static com.playops.api.dto.PlanDtos.UNWRITTEN;
import static com.playops.api.dto.PlanDtos.WRITTEN;

/**
 * 테스트 계획 표(F-1). 한 줄 = 계획 행(plan_items) 하나, 또는 계획 행이 없는 테스트 케이스(TEST 노드) 하나.
 * 계획 행은 테스트가 없어도 있다(미작성). 테스트에 연결되면 계획 칸은 케이스의 scenario_case_settings 행으로 옮겨 가고,
 * 그 뒤로는 케이스 행이 원본이다. 케이스 키는 (파일 경로, grep) — 테스트 제목이 바뀌면 다른 항목이 된다.
 */
@Service
public class PlanService {

    private static final Logger log = LoggerFactory.getLogger(PlanService.class);
    private static final String TEST = "TEST";
    private static final Set<String> PRIORITIES = Set.of("HIGH", "MEDIUM", "LOW");
    static final int MAX_TITLE = 200;

    private final PlaywrightScenarioService scenarioService;
    private final ScenarioCaseSettingRepository settingRepository;
    private final ExecutionCaseResultRepository caseResultRepository;
    private final ProjectService projectService;
    private final ProjectMemberService memberService;
    private final PlanEntryRepository entryRepository;
    private final AiJobRepository aiJobRepository;
    private final SiteCoverageService coverageService;

    public PlanService(PlaywrightScenarioService scenarioService,
                       ScenarioCaseSettingRepository settingRepository,
                       ExecutionCaseResultRepository caseResultRepository,
                       ProjectService projectService,
                       ProjectMemberService memberService,
                       PlanEntryRepository entryRepository,
                       AiJobRepository aiJobRepository,
                       SiteCoverageService coverageService) {
        this.scenarioService = scenarioService;
        this.settingRepository = settingRepository;
        this.caseResultRepository = caseResultRepository;
        this.projectService = projectService;
        this.memberService = memberService;
        this.entryRepository = entryRepository;
        this.aiJobRepository = aiJobRepository;
        this.coverageService = coverageService;
    }

    /** 계획 항목과 그 결과 이력(최신 실행부터, 실행마다 하나). 계획 표와 결함 리스트(#80)가 같은 매칭을 쓴다. 미작성 행은 이력이 비어 있다. */
    public record Tracked(PlanItem item, List<ExecutionCaseResult> history) {}

    /** AI 생성 · 클릭 녹화가 계획 행의 테스트를 쓰는 파일 */
    public static String planSpecPath(long planId) {
        return "tests/plan/plan-" + planId + ".spec.ts";
    }

    public static boolean unwritten(PlanItem item) {
        return UNWRITTEN.equals(item.stage());
    }

    public PlanResponse get(String projectId) {
        List<PlanItem> items = sort(tracked(projectId).stream().map(Tracked::item).toList());
        return new PlanResponse(items, summarize(items), screens(items, flowsFor(projectId, items)));
    }

    public List<Tracked> tracked(String projectId) {
        Map<String, ScenarioCaseSetting> settings = new HashMap<>();
        for (ScenarioCaseSetting s : settingRepository.findByProjectId(projectId)) {
            if (TEST.equals(s.getNodeType())) settings.put(key(s.getSpecPath(), s.getGrepFilter()), s);
        }
        List<PlanItem> cases = flatten(scenarioService.analyze(projectId));
        List<PlanEntry> entries = entryRepository.findByProjectIdOrderByIdAsc(projectId);
        Set<String> justLinked = autoLink(projectId, entries, cases, settings);

        Set<String> caseKeys = new HashSet<>();
        cases.forEach(c -> caseKeys.add(key(c.specPath(), c.grep())));
        Map<String, PlanEntry> linked = new HashMap<>();
        List<PlanEntry> open = new ArrayList<>();
        for (PlanEntry e : entries) {
            if (e.isLinked() && caseKeys.contains(key(e.getSpecPath(), e.getGrepFilter()))) {
                linked.put(key(e.getSpecPath(), e.getGrepFilter()), e);
            } else {
                open.add(e); // 미연결, 또는 연결된 테스트가 사라진 행 — 미작성으로 보인다
            }
        }
        Map<Long, String> names = memberService.namesOf(Stream.concat(
                settings.values().stream().map(ScenarioCaseSetting::getUpdatedBy),
                entries.stream().map(PlanEntry::getUpdatedBy)).toList());
        Map<Long, String> jobStatus = jobStatuses(open);
        // ponytail: 프로젝트의 모든 케이스 결과를 읽는다. 이력이 수만 건이 되면 케이스별 마지막 결과만 고르는 쿼리로 바꾼다.
        Map<String, List<ExecutionCaseResult>> results =
                byLeaf(caseResultRepository.findEarlierInProject(projectId, Long.MAX_VALUE));

        List<Tracked> out = new ArrayList<>(cases.stream().map(item -> {
            ScenarioCaseSetting s = settings.get(key(item.specPath(), item.grep()));
            PlanEntry e = linked.get(key(item.specPath(), item.grep()));
            // 방금 자동 연결한 케이스는 트리를 읽은 뒤에 사용 여부가 바뀌었을 수 있다
            boolean enabled = justLinked.contains(key(item.specPath(), item.grep()))
                    ? item.parentEnabled() && s.getEnabled() : item.enabled();
            List<ExecutionCaseResult> history = historyFor(item, results);
            ExecutionCaseResult r = history.isEmpty() ? null : history.get(0);
            ExecutionCaseResult prev = history.size() < 2 ? null : history.get(1);
            DefectService.FailureStreak defect = enabled ? DefectService.failureStreak(history) : null;
            return new Tracked(new PlanItem(item.specPath(), item.grep(), item.title(), item.describePath(), item.line(),
                    enabled, item.parentEnabled(),
                    s != null ? s.getSortOrder() : null,
                    s != null ? s.getAssignee() : null,
                    s != null ? s.getAssigneeUserId() : null,
                    s != null ? s.getDueDate() : null,
                    s != null ? s.getPriority() : null,
                    r != null ? r.getStatus() : null,
                    r != null ? r.getCreatedAt() : null,
                    prev != null ? prev.getStatus() : null,
                    prev != null ? prev.getCreatedAt() : null,
                    defect != null ? defect.status() : null,
                    defect != null ? defect.failCount() : 0,
                    s != null && s.getUpdatedBy() != null ? names.get(s.getUpdatedBy()) : null,
                    s != null ? s.getUpdatedAt() : null,
                    e != null ? e.getId() : null, WRITTEN,
                    e != null ? e.getScreenRouteKey() : null,
                    e != null ? e.getExpected() : null,
                    null, null), history);
        }).toList());
        for (PlanEntry e : open) {
            // 연결된 테스트가 사라진 행은 연결이 남아 있는 동안 케이스 행이 계획 칸의 원본이다
            ScenarioCaseSetting s = e.isLinked() ? settings.get(key(e.getSpecPath(), e.getGrepFilter())) : null;
            String status = e.getAiJobId() == null ? null : jobStatus.get(e.getAiJobId());
            out.add(new Tracked(unwrittenItem(e, s, names, status), List.of()));
        }
        return out;
    }

    /** 미작성 행. 테스트 자리(경로 · grep · 묶음)는 비우고 제목은 계획 제목. s 가 있으면 계획 칸은 s 에서 읽는다. */
    static PlanItem unwrittenItem(PlanEntry e, ScenarioCaseSetting s, Map<Long, String> names, String aiJobStatus) {
        Long updatedBy = s != null ? s.getUpdatedBy() : e.getUpdatedBy();
        return new PlanItem("", "", e.getTitle(), "", 0,
                s != null ? s.getEnabled() : e.getEnabled(), true,
                s != null ? s.getSortOrder() : e.getSortOrder(),
                s != null ? s.getAssignee() : e.getAssignee(),
                s != null ? s.getAssigneeUserId() : e.getAssigneeUserId(),
                s != null ? s.getDueDate() : e.getDueDate(),
                s != null ? s.getPriority() : e.getPriority(),
                null, null, null, null, null, 0,
                updatedBy != null ? names.get(updatedBy) : null,
                s != null ? s.getUpdatedAt() : e.getUpdatedAt(),
                e.getId(), UNWRITTEN, e.getScreenRouteKey(), e.getExpected(),
                e.getAiJobId(), aiJobStatus);
    }

    private Map<Long, String> jobStatuses(List<PlanEntry> entries) {
        List<Long> ids = entries.stream().map(PlanEntry::getAiJobId).filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<Long, String> out = new HashMap<>();
        for (AiJob job : aiJobRepository.findAllById(ids)) {
            if (job.getStatus() != null) out.put(job.getId(), job.getStatus().name());
        }
        return out;
    }

    // ── 연결 ──

    /**
     * 자동 연결: 미연결 계획 행의 제목과 같은 제목(마지막 제목, 앞뒤 공백 무시)의 케이스가 다른 계획 행에 연결되지 않은 것 중 딱 하나면 잇는다.
     * 여럿이면 그 계획 행의 AI 생성 파일(tests/plan/plan-{id}.spec.ts)에 있는 것이 하나일 때만. 사람이 끊은 행(autoLink=false)은 건너뛴다.
     */
    private Set<String> autoLink(String projectId, List<PlanEntry> entries, List<PlanItem> cases,
                                 Map<String, ScenarioCaseSetting> settings) {
        Set<String> linkedNow = new HashSet<>();
        Set<String> caseKeys = new HashSet<>();
        cases.forEach(c -> caseKeys.add(key(c.specPath(), c.grep())));
        Set<String> taken = new HashSet<>();
        for (PlanEntry e : entries) {
            if (e.isLinked()) taken.add(key(e.getSpecPath(), e.getGrepFilter()));
        }
        for (PlanEntry e : entries) {
            if (!e.getAutoLink() || (e.isLinked() && caseKeys.contains(key(e.getSpecPath(), e.getGrepFilter())))) continue;
            PlanItem match = autoLinkTarget(e, cases, taken);
            if (match == null) continue;
            ScenarioCaseSetting row = link(projectId, e, match.specPath(), match.grep());
            settings.put(key(row.getSpecPath(), row.getGrepFilter()), row);
            taken.add(key(match.specPath(), match.grep()));
            linkedNow.add(key(match.specPath(), match.grep()));
        }
        return linkedNow;
    }

    static PlanItem autoLinkTarget(PlanEntry e, List<PlanItem> cases, Set<String> taken) {
        String title = e.getTitle() == null ? "" : e.getTitle().trim();
        List<PlanItem> candidates = cases.stream()
                .filter(c -> title.equals(c.title() == null ? "" : c.title().trim()))
                .filter(c -> !taken.contains(key(c.specPath(), c.grep())))
                .toList();
        if (candidates.size() == 1) return candidates.get(0);
        if (candidates.isEmpty() || e.getId() == null) return null;
        String own = planSpecPath(e.getId());
        List<PlanItem> inOwnFile = candidates.stream().filter(c -> DefectService.samePath(c.specPath(), own)).toList();
        return inOwnFile.size() == 1 ? inOwnFile.get(0) : null;
    }

    /**
     * 계획 행을 케이스에 잇는다: 계획 칸을 케이스 행으로 복사한다. 이미 다른 케이스에 이어져 있었으면 그 케이스 행의 계획 칸을 옮긴다.
     * "한 케이스는 한 계획에만"은 부르는 쪽이 확인한다.
     */
    @Transactional
    public ScenarioCaseSetting link(String projectId, PlanEntry e, String specPath, String grep) {
        ScenarioCaseSetting row = row(projectId, specPath, grep);
        ScenarioCaseSetting old = e.isLinked()
                ? settingRepository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(projectId, TEST, e.getSpecPath(), e.getGrepFilter())
                        .orElse(null)
                : null;
        if (old == null) {
            row.setEnabled(e.getEnabled());
            row.setSortOrder(e.getSortOrder());
            row.setAssignee(e.getAssignee());
            row.setAssigneeUserId(e.getAssigneeUserId());
            row.setDueDate(e.getDueDate());
            row.setPriority(e.getPriority());
        } else if (old != row) {
            row.setEnabled(old.getEnabled());
            row.setSortOrder(old.getSortOrder());
            row.setAssignee(old.getAssignee());
            row.setAssigneeUserId(old.getAssigneeUserId());
            row.setDueDate(old.getDueDate());
            row.setPriority(old.getPriority());
        }
        settingRepository.save(row);
        e.setSpecPath(row.getSpecPath());
        e.setGrepFilter(row.getGrepFilter());
        e.setAutoLink(true); // 사람이 다시 이었으면 자동 연결도 다시 켠다
        entryRepository.save(e);
        return row;
    }

    /** 연결을 끊는다: 케이스 행의 계획 칸을 계획 행으로 되돌려 복사한다. 다시 자동으로 붙지 않게 autoLink 를 끈다. */
    @Transactional
    public void unlink(String projectId, PlanEntry e) {
        if (!e.isLinked()) return;
        settingRepository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(projectId, TEST, e.getSpecPath(), e.getGrepFilter())
                .ifPresent(s -> {
                    e.setEnabled(s.getEnabled());
                    e.setSortOrder(s.getSortOrder());
                    e.setAssignee(s.getAssignee());
                    e.setAssigneeUserId(s.getAssigneeUserId());
                    e.setDueDate(s.getDueDate());
                    e.setPriority(s.getPriority());
                });
        e.setSpecPath(null);
        e.setGrepFilter(null);
        e.setAutoLink(false);
        entryRepository.save(e);
    }

    public PlanEntry entry(String projectId, Long planId) {
        if (planId == null) throw new ApiException(400, "계획 행 id 가 필요합니다.");
        return entryRepository.findByIdAndProjectId(planId, projectId)
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "계획 행을 찾을 수 없습니다."));
    }

    // ── 계획 칸 쓰기 ──

    public void patch(String projectId, ItemPatch patch) {
        String priority = checkPriority(patch.priority());
        String assignee = blankToNull(patch.assignee());
        if (assignee != null && assignee.length() > 100) {
            throw new ApiException(400, "담당자는 100자까지 쓸 수 있습니다.");
        }
        projectService.getProject(projectId);
        if (patch.assigneeUserId() != null) assignee = assigneeName(projectId, patch.assigneeUserId());
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
            int order = i;
            apply(projectId, keys.get(i), s -> s.setSortOrder(order), e -> e.setSortOrder(order));
        }
    }

    @Transactional
    public void setEnabled(String projectId, List<ItemKey> keys, boolean enabled) {
        projectService.getProject(projectId);
        for (ItemKey k : keys) {
            apply(projectId, k, s -> s.setEnabled(enabled), e -> e.setEnabled(enabled));
        }
    }

    /** planId 만 있으면 계획 행(연결돼 있으면 그 케이스 행), 아니면 케이스 행을 고친다. 케이스 순서와 계획 순서는 같은 축이다. */
    private void apply(String projectId, ItemKey k, Consumer<ScenarioCaseSetting> onCase, Consumer<PlanEntry> onEntry) {
        if (k.planId() != null && (k.specPath() == null || k.specPath().isBlank())) {
            PlanEntry e = entry(projectId, k.planId());
            if (!e.isLinked()) {
                onEntry.accept(e);
                entryRepository.save(e);
                return;
            }
            k = new ItemKey(e.getSpecPath(), e.getGrepFilter());
        }
        ScenarioCaseSetting s = row(projectId, k.specPath(), k.grep());
        onCase.accept(s);
        settingRepository.save(s);
    }

    /** 담당자는 이 프로젝트의 멤버여야 한다. 표시 이름(없으면 아이디)을 돌려준다. */
    public String assigneeName(String projectId, Long userId) {
        Member member = memberService.list(projectId).stream()
                .filter(m -> m.userId().equals(userId)).findFirst()
                .orElseThrow(() -> new ApiException(400, "VALIDATION_ERROR", "담당자는 이 프로젝트의 멤버 중에서 고르세요."));
        return member.displayName() != null && !member.displayName().isBlank() ? member.displayName() : member.username();
    }

    static String checkPriority(String priority) {
        String p = blankToNull(priority);
        if (p != null && !PRIORITIES.contains(p)) {
            throw new ApiException(400, "우선순위는 HIGH, MEDIUM, LOW 중 하나입니다.");
        }
        return p;
    }

    /** 계획 제목 = 테스트 제목. Playwright grep 으로 정확히 고르므로 '@'(태그) · 줄바꿈은 받지 않는다. */
    static String checkTitle(String title) {
        String t = title == null ? "" : title.trim();
        if (t.isEmpty()) throw new ApiException(400, "VALIDATION_ERROR", "계획 제목을 입력하세요.");
        if (t.length() > MAX_TITLE) throw new ApiException(400, "VALIDATION_ERROR", "계획 제목은 200자까지 쓸 수 있습니다.");
        if (t.contains("@") || t.contains("\n") || t.contains("\r")) {
            throw new ApiException(400, "VALIDATION_ERROR", "계획 제목에는 '@'와 줄바꿈을 쓸 수 없습니다.");
        }
        return t;
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
    static String checkPath(String specPath) {
        if (specPath == null || specPath.isBlank()) throw new ApiException(400, "Invalid spec path");
        String p = specPath.replace('\\', '/').trim();
        if (p.startsWith("/") || p.contains("../") || p.equals("..") || p.startsWith("-")) {
            throw new ApiException(400, "Invalid spec path");
        }
        return p;
    }

    /** 화면은 부가 정보라 확인 지도 계산이 실패해도 계획 표는 돌려준다. 화면 없는 작성됨 행이 없으면 흐름을 읽지 않는다. */
    private List<SiteCoverageService.CoverageFlow> flowsFor(String projectId, List<PlanItem> items) {
        boolean needed = items.stream().anyMatch(i -> i.enabled() && i.screenRouteKey() == null && !i.specPath().isEmpty());
        if (!needed) return List.of();
        try {
            SiteCoverageService.Coverage coverage = coverageService.view(projectId);
            return coverage == null || coverage.flows() == null ? List.of() : coverage.flows();
        } catch (RuntimeException e) {
            log.warn("계획 화면 계산 실패 (project={}): {}", projectId, e.getMessage());
            return List.of();
        }
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
                        null, null, null, null, null, null, null, null, null, null, 0, null, null));
            } else {
                List<String> next = new ArrayList<>(describes);
                next.add(n.title());
                walk(spec, n.children(), on, next, out);
            }
        }
    }

    /** 순서를 정한 항목이 앞(케이스 순서와 계획 순서는 같은 축), 나머지는 미작성 행(계획 행 id 순) → 파일 경로 → 줄 번호. */
    static List<PlanItem> sort(List<PlanItem> items) {
        return items.stream().sorted(Comparator
                .comparing(PlanItem::sortOrder, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(i -> !unwritten(i))
                .thenComparing(PlanItem::specPath)
                .thenComparingInt(PlanItem::line)
                .thenComparing(PlanItem::planId, Comparator.nullsLast(Comparator.naturalOrder()))).toList();
    }

    /**
     * 미작성 행도 계획이므로 total · enabled · completionRate 의 분모에 들어간다.
     * notRun 은 작성됨인데 결과가 없는 것만 센다 (미작성은 unwritten 으로 따로).
     */
    static PlanSummary summarize(List<PlanItem> items) {
        List<PlanItem> on = items.stream().filter(PlanItem::enabled).toList();
        int unwritten = (int) on.stream().filter(PlanService::unwritten).count();
        int written = on.size() - unwritten;
        int passed = (int) on.stream().filter(i -> "PASSED".equals(i.lastStatus())).count();
        int failed = (int) on.stream().filter(i -> "FAILED".equals(i.lastStatus())).count();
        int notRun = written - passed - failed;
        double writtenRate = on.isEmpty() ? 0.0 : (double) written / on.size();
        double rate = on.isEmpty() ? 0.0 : (double) passed / on.size();
        return new PlanSummary(items.size(), on.size(), items.size() - on.size(), unwritten, written, writtenRate,
                passed, failed, notRun, rate);
    }

    /** 사용 중 행의 화면별 진척. 화면 = 계획 행의 화면, 없으면 그 테스트가 지나는 흐름의 첫 화면, 둘 다 없으면 뺀다. 처음 나온 순서. */
    static List<ScreenProgress> screens(List<PlanItem> items, List<SiteCoverageService.CoverageFlow> flows) {
        Map<String, int[]> counts = new LinkedHashMap<>(); // planned, written, passed, failed
        for (PlanItem i : items) {
            if (!i.enabled()) continue;
            String screen = i.screenRouteKey();
            if (screen == null && !i.specPath().isEmpty()) {
                List<String> routes = DefectService.routesOf(i.specPath(), flows);
                screen = routes.isEmpty() ? null : routes.get(0);
            }
            if (screen == null) continue;
            int[] c = counts.computeIfAbsent(screen, k -> new int[4]);
            c[0]++;
            if (!unwritten(i)) c[1]++;
            if ("PASSED".equals(i.lastStatus())) c[2]++;
            if ("FAILED".equals(i.lastStatus())) c[3]++;
        }
        return counts.entrySet().stream()
                .map(en -> new ScreenProgress(en.getKey(), en.getValue()[0], en.getValue()[1], en.getValue()[2], en.getValue()[3]))
                .toList();
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

    static String key(String specPath, String name) {
        return specPath + "\n" + name;
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
