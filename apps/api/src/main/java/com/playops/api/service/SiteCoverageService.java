package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.Project;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.entity.SiteAnalysisRun;
import com.playops.api.entity.SiteEdge;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteAnalysisRunRepository;
import com.playops.api.repository.SiteEdgeRepository;
import com.playops.api.repository.SiteNodeEditRepository;
import com.playops.api.repository.SiteNodeRepository;
import com.playops.api.util.ProjectEnvVariables;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 구조 탭 "확인 지도". 화면마다 어디까지 확인됐고 어디서 막혔는지, 테스트 흐름이 어느 화면까지 갔는지 모은다.
 * 계약: docs/design/structure-coverage-contract.md
 *
 * 한 번 요청에 저장소를 몇 번만 읽는다 (화면 · 제외 표시 · 전환 · 테스트 출처 · 마지막 실행 결과 · 마지막 사이트 탐색).
 * 판정 규칙은 CoverageRules 에 있다.
 */
@Service
public class SiteCoverageService {

    /** spec 첫 test 제목을 찾으려고 읽는 앞부분 크기. */
    private static final int TITLE_READ_BYTES = 64 * 1024;

    private final ProjectService projectService;
    private final FileStorageService fileStorageService;
    private final SiteNodeRepository nodeRepository;
    private final SiteNodeEditRepository editRepository;
    private final SiteEdgeRepository edgeRepository;
    private final ScenarioOriginRepository originRepository;
    private final ExecutionCaseResultRepository caseResultRepository;
    private final SiteAnalysisRunRepository runRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SiteCoverageService(ProjectService projectService, FileStorageService fileStorageService,
                               SiteNodeRepository nodeRepository, SiteNodeEditRepository editRepository,
                               SiteEdgeRepository edgeRepository, ScenarioOriginRepository originRepository,
                               ExecutionCaseResultRepository caseResultRepository,
                               SiteAnalysisRunRepository runRepository) {
        this.projectService = projectService;
        this.fileStorageService = fileStorageService;
        this.nodeRepository = nodeRepository;
        this.editRepository = editRepository;
        this.edgeRepository = edgeRepository;
        this.originRepository = originRepository;
        this.caseResultRepository = caseResultRepository;
        this.runRepository = runRepository;
    }

    // ---------------------------------------------------------------- 응답 형태 (계약의 Coverage)

    public record Coverage(Summary summary, List<CoverageNode> nodes, List<CoverageEdge> edges, List<CoverageFlow> flows) {}

    public record Summary(int screens, int tested, int observed, int unseen, int blocked, int flows, Instant lastRunAt) {}

    public record CoverageNode(String routeKey, String state, Counts counts, List<CoverageIssue> issues) {}

    public record Counts(int passed, int failed, int observed, int unseen, int total) {}

    public record CoverageIssue(String kind, String message, String selector, String specPath, Long executionId,
                                Instant at, String action) {}

    public record CoverageEdge(String from, String to, String state) {}

    public record CoverageFlow(String specPath, String title, String source, String lastStatus, Instant lastRunAt,
                               Long executionId, List<FlowStep> steps) {}

    public record FlowStep(String routeKey, String state, String message) {}

    // ---------------------------------------------------------------- 계산

    public Coverage view(String projectId) {
        Project project = projectService.getProject(projectId);
        Map<String, String> env = ProjectEnvVariables.parse(project.getEnvVariables());

        Set<String> excluded = new HashSet<>();
        for (SiteNodeEdit edit : editRepository.findByProjectId(projectId)) {
            if (edit.isExcluded()) {
                excluded.add(edit.getRouteKey());
            }
        }
        // 지도에 있는 화면: 제외했거나 마지막 분석에서 사라진(stale) 화면은 세지 않는다.
        Map<String, SiteNode> nodes = new LinkedHashMap<>();
        Map<String, List<Map<String, Object>>> elementsByRoute = new HashMap<>();
        Map<String, Set<String>> keysByRoute = new LinkedHashMap<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            if (node.isStale() || excluded.contains(node.getRouteKey())) {
                continue;
            }
            nodes.put(node.getRouteKey(), node);
            List<Map<String, Object>> elements = readElements(node.getElements());
            elementsByRoute.put(node.getRouteKey(), elements);
            Set<String> keys = new LinkedHashSet<>();
            elements.forEach(element -> keys.addAll(SiteMapPromptService.keysOf(element)));
            keysByRoute.put(node.getRouteKey(), keys);
        }

        // ---- 흐름
        List<ScenarioOrigin> origins = originRepository.findByProjectId(projectId);
        Map<String, List<ExecutionCaseResult>> latestBySpec = latestResults(projectId, origins);
        Map<String, List<CoverageIssue>> issues = new LinkedHashMap<>();
        Set<String> passedRoutes = new HashSet<>();
        Set<String> notReachedRoutes = new LinkedHashSet<>();
        Map<String, String> edgeStates = new LinkedHashMap<>();
        List<CoverageFlow> flows = new ArrayList<>();
        Instant lastRunAt = null;
        for (ScenarioOrigin origin : origins) {
            List<String> stored = readStrings(origin.getRouteKeys());
            List<String> routes = stored.isEmpty()
                    ? CoverageRules.inferRoutes(readStrings(origin.getSelectorKeys()), keysByRoute)
                    : stored;
            String source = sourceOf(origin, stored);

            List<ExecutionCaseResult> latest = latestFor(origin.getSpecPath(), latestBySpec);
            String status = CoverageRules.RUN_NEVER;
            Long executionId = null;
            Instant at = null;
            String error = null;
            for (ExecutionCaseResult result : latest) {
                executionId = result.getExecutionId();
                if (result.getCreatedAt() != null && (at == null || result.getCreatedAt().isAfter(at))) {
                    at = result.getCreatedAt();
                }
                if ("FAILED".equals(result.getStatus())) {
                    status = CoverageRules.RUN_FAILED;
                    if (error == null) {
                        error = result.getErrorMessage();
                    }
                } else if ("PASSED".equals(result.getStatus()) && !CoverageRules.RUN_FAILED.equals(status)) {
                    status = CoverageRules.RUN_PASSED;
                }
            }
            if (at != null && (lastRunAt == null || at.isAfter(lastRunAt))) {
                lastRunAt = at;
            }

            CoverageRules.Explained explained = CoverageRules.RUN_FAILED.equals(status) ? CoverageRules.explain(error) : null;
            int failedIndex = explained == null ? -1 : CoverageRules.failedStepIndex(routes, explained.key(), keysByRoute);
            List<CoverageRules.Step> steps = CoverageRules.flowSteps(routes, status,
                    failedIndex, explained == null ? null : explained.message());

            String failedRoute = null;
            for (int i = 0; i < steps.size(); i++) {
                CoverageRules.Step step = steps.get(i);
                switch (step.state()) {
                    case CoverageRules.STEP_PASSED -> passedRoutes.add(step.routeKey());
                    case CoverageRules.STEP_FAILED -> failedRoute = step.routeKey();
                    case CoverageRules.STEP_NOT_REACHED -> notReachedRoutes.add(step.routeKey());
                    default -> { }
                }
                if (i > 0) {
                    addFlowEdge(edgeStates, nodes, steps.get(i - 1), step, source);
                }
            }
            if (explained != null) {
                // 지나간 화면을 모르는 흐름이면 실패한 셀렉터가 있는 화면을 지도 전체에서 찾는다.
                if (failedRoute == null && explained.key() != null) {
                    failedRoute = keysByRoute.entrySet().stream()
                            .filter(entry -> entry.getValue().contains(explained.key()))
                            .map(Map.Entry::getKey).findFirst().orElse(null);
                }
                if (failedRoute != null) {
                    String action = CoverageRules.ISSUE_OPEN_FAILED.equals(explained.kind()) ? "RERUN"
                            : ScenarioOrigin.SOURCE_RECORDED.equals(source) ? "RECORD_AGAIN" : "FIX_WITH_AI";
                    addIssue(issues, failedRoute, new CoverageIssue(explained.kind(), explained.message(),
                            explained.selector(), origin.getSpecPath(), executionId, at, action));
                }
            }
            flows.add(new CoverageFlow(origin.getSpecPath(), titleOf(projectId, origin.getSpecPath()), source, status,
                    at, executionId, steps.stream().map(s -> new FlowStep(s.routeKey(), s.state(), s.message())).toList()));
        }
        flows.sort(Comparator.comparing(CoverageFlow::lastRunAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(CoverageFlow::specPath));

        // ---- 사이트 탐색 경고 · 로그인
        boolean hasLogin = env.get("LOGIN_ID") != null && !env.get("LOGIN_ID").isBlank();
        runRepository.findFirstByProjectIdAndFrameworkOrderByIdDesc(projectId, SiteAnalysisService.URL_FRAMEWORK)
                .filter(run -> !SiteAnalysisRun.RUNNING.equals(run.getStatus()))
                .ifPresent(run -> addWarningIssues(issues, run, nodes, elementsByRoute, project, env, hasLogin));
        if (!hasLogin) {
            for (SiteNode node : nodes.values()) {
                String route = node.getRouteKey();
                boolean alreadyLogin = issues.getOrDefault(route, List.of()).stream()
                        .anyMatch(issue -> CoverageRules.ISSUE_LOGIN_REQUIRED.equals(issue.kind()));
                // 통과한 테스트가 이미 지나간 화면은 로그인 방법이 따로 있는 것이라 막힌 것으로 보지 않는다.
                if (Boolean.TRUE.equals(node.getAuthRequired()) && !alreadyLogin && !passedRoutes.contains(route)) {
                    addIssue(issues, route, new CoverageIssue(CoverageRules.ISSUE_LOGIN_REQUIRED,
                            "로그인이 필요한 화면입니다. 로그인 계정을 등록하세요", null, null, null, null, "SET_LOGIN"));
                }
            }
        }
        // 앞에서 멈춰 닿지 못한 화면. 다른 흐름이 지나갔으면 안내하지 않는다.
        for (String route : notReachedRoutes) {
            if (nodes.containsKey(route) && !passedRoutes.contains(route) && !issues.containsKey(route)) {
                addIssue(issues, route, new CoverageIssue(CoverageRules.ISSUE_NOT_REACHED,
                        "앞 화면에서 테스트가 멈춰 여기까지 오지 못했습니다", null, null, null, null, "NONE"));
            }
        }

        // ---- 화면
        List<CoverageNode> coverageNodes = new ArrayList<>();
        int tested = 0;
        int observed = 0;
        int unseen = 0;
        int blocked = 0;
        for (SiteNode node : nodes.values()) {
            String route = node.getRouteKey();
            Counts counts = countsOf(elementsByRoute.get(route));
            List<CoverageIssue> mine = issues.getOrDefault(route, List.of());
            String state = CoverageRules.screenState(mine.stream().map(CoverageIssue::kind).toList(),
                    passedRoutes.contains(route) || counts.passed() > 0,
                    counts.observed() > 0 || CoverageRules.seenOrigin(node.getOrigin()));
            switch (state) {
                case CoverageRules.SCREEN_TESTED -> tested++;
                case CoverageRules.SCREEN_OBSERVED -> observed++;
                case CoverageRules.SCREEN_BLOCKED -> blocked++;
                default -> unseen++;
            }
            coverageNodes.add(new CoverageNode(route, state, counts, mine));
        }

        // ---- 전환: 지도의 전환에 흐름이 지나간 전환을 더한다.
        Map<String, String> edges = new LinkedHashMap<>();
        for (SiteEdge edge : edgeRepository.findByProjectId(projectId)) {
            SiteNode from = nodes.get(edge.getFromRouteKey());
            if (from == null || !nodes.containsKey(edge.getToRouteKey())) {
                continue;
            }
            String key = edge.getFromRouteKey() + "\n" + edge.getToRouteKey();
            String state = CoverageRules.seenOrigin(from.getOrigin()) ? CoverageRules.EDGE_OBSERVED : CoverageRules.EDGE_UNKNOWN;
            edges.merge(key, state, CoverageRules::strongerEdge);
        }
        edgeStates.forEach((key, state) -> edges.merge(key, state, CoverageRules::strongerEdge));
        List<CoverageEdge> coverageEdges = new ArrayList<>();
        edges.forEach((key, state) -> {
            int cut = key.indexOf('\n');
            coverageEdges.add(new CoverageEdge(key.substring(0, cut), key.substring(cut + 1), state));
        });

        Summary summary = new Summary(nodes.size(), tested, observed, unseen, blocked, flows.size(), lastRunAt);
        return new Coverage(summary, coverageNodes, coverageEdges, flows);
    }

    /** 흐름의 앞뒤 단계로 전환 상태를 정한다. 닿지 못한 전환은 알 수 없으므로 더하지 않는다. */
    private static void addFlowEdge(Map<String, String> edgeStates, Map<String, SiteNode> nodes,
                                    CoverageRules.Step prev, CoverageRules.Step next, String source) {
        if (prev.routeKey().equals(next.routeKey()) || !nodes.containsKey(prev.routeKey())
                || !nodes.containsKey(next.routeKey())) {
            return;
        }
        String state = null;
        if (CoverageRules.STEP_PASSED.equals(prev.state()) && CoverageRules.STEP_PASSED.equals(next.state())) {
            state = CoverageRules.EDGE_TESTED;
        } else if (CoverageRules.STEP_PASSED.equals(prev.state()) && CoverageRules.STEP_FAILED.equals(next.state())) {
            state = CoverageRules.EDGE_FAILED;
        } else if (ScenarioOrigin.SOURCE_RECORDED.equals(source)) {
            state = CoverageRules.EDGE_OBSERVED; // 녹화는 실제 브라우저로 지나간 전환이다.
        }
        if (state != null) {
            edgeStates.merge(prev.routeKey() + "\n" + next.routeKey(), state, CoverageRules::strongerEdge);
        }
    }

    /** RECORDED · PATH(구조에서 화면을 골라 만든 테스트) · GENERATED(화면을 고르지 않은 AI 생성) · OTHER. */
    static String sourceOf(ScenarioOrigin origin, List<String> storedRoutes) {
        if (origin.getSource() != null) {
            return ScenarioOrigin.SOURCE_RECORDED.equals(origin.getSource()) ? "RECORDED" : "OTHER";
        }
        return storedRoutes.isEmpty() ? "GENERATED" : "PATH";
    }

    private void addWarningIssues(Map<String, List<CoverageIssue>> issues, SiteAnalysisRun run,
                                  Map<String, SiteNode> nodes, Map<String, List<Map<String, Object>>> elementsByRoute,
                                  Project project, Map<String, String> env, boolean hasLogin) {
        Instant at = run.getFinishedAt() != null ? run.getFinishedAt() : run.getStartedAt();
        for (String warning : readStrings(run.getWarnings())) {
            CoverageRules.WarningIssue read = CoverageRules.readWarning(warning);
            if (read == null) {
                continue;
            }
            String route = switch (read.kind()) {
                case CoverageRules.ISSUE_LOGIN_REQUIRED -> loginRoute(nodes, elementsByRoute, env, project);
                case CoverageRules.ISSUE_OPEN_FAILED -> openedRoute(read.url(), nodes);
                default -> entryRoute(nodes, project);
            };
            if (route == null) {
                continue;
            }
            String action = read.action();
            // 계정을 이미 넣었다면 다시 탐색하면 된다. (로그인 실패는 계정을 고쳐야 하므로 그대로 둔다.)
            if (hasLogin && "SET_LOGIN".equals(action) && read.message().startsWith("로그인이 필요해")) {
                action = "RERUN";
            }
            CoverageIssue issue = new CoverageIssue(read.kind(), read.message(), null, null, null, at, action);
            if (!issues.getOrDefault(route, List.of()).contains(issue)) {
                addIssue(issues, route, issue);
            }
        }
    }

    /** 로그인 화면: 비밀번호 입력칸이 있는 화면 → LOGIN_PATH 화면 → 경로에 login 이 든 화면 → 첫 화면. */
    static String loginRoute(Map<String, SiteNode> nodes, Map<String, List<Map<String, Object>>> elementsByRoute,
                             Map<String, String> env, Project project) {
        for (String route : nodes.keySet()) {
            for (Map<String, Object> element : elementsByRoute.getOrDefault(route, List.of())) {
                if (element.get("type") instanceof String type && "password".equalsIgnoreCase(type)) {
                    return route;
                }
            }
        }
        String loginPath = pathOf(env.get("LOGIN_PATH"));
        if (loginPath != null && nodes.containsKey(loginPath)) {
            return loginPath;
        }
        for (String route : nodes.keySet()) {
            String lower = route.toLowerCase();
            if (lower.contains("login") || lower.contains("signin") || lower.contains("sign-in")) {
                return route;
            }
        }
        return entryRoute(nodes, project);
    }

    /** 탐색을 시작한 화면: baseUrl 의 경로 → / → 첫 화면. */
    static String entryRoute(Map<String, SiteNode> nodes, Project project) {
        String base = pathOf(project.getBaseUrl());
        if (base != null && nodes.containsKey(base)) {
            return base;
        }
        if (nodes.containsKey("/")) {
            return "/";
        }
        return nodes.isEmpty() ? null : nodes.keySet().iterator().next();
    }

    /** 사이트 탐색 화면 키는 경로+쿼리다. 같은 키가 없으면 경로만 맞춰 본다. */
    static String openedRoute(String url, Map<String, SiteNode> nodes) {
        if (url == null) {
            return null;
        }
        try {
            URI uri = URI.create(url);
            String path = normalizePath(uri.getRawPath());
            String withQuery = uri.getRawQuery() == null ? path : path + "?" + uri.getRawQuery();
            if (nodes.containsKey(withQuery)) {
                return withQuery;
            }
            return nodes.containsKey(path) ? path : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String pathOf(String urlOrPath) {
        if (urlOrPath == null || urlOrPath.isBlank()) {
            return null;
        }
        try {
            return normalizePath(URI.create(urlOrPath.trim()).getRawPath());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String normalizePath(String path) {
        if (path == null || path.isEmpty()) {
            return "/";
        }
        String p = (path.startsWith("/") ? path : "/" + path).replaceAll("/+$", "");
        return p.isEmpty() ? "/" : p;
    }

    private static void addIssue(Map<String, List<CoverageIssue>> issues, String route, CoverageIssue issue) {
        issues.computeIfAbsent(route, k -> new ArrayList<>()).add(issue);
    }

    static Counts countsOf(List<Map<String, Object>> elements) {
        int passed = 0;
        int failed = 0;
        int observed = 0;
        int total = elements == null ? 0 : elements.size();
        for (Map<String, Object> element : elements == null ? List.<Map<String, Object>>of() : elements) {
            Object v = element.get("verification");
            if ("PASSED".equals(v)) {
                passed++;
            } else if ("FAILED".equals(v)) {
                failed++;
            } else if ("OBSERVED".equals(v)) {
                observed++;
            }
        }
        return new Counts(passed, failed, observed, total - passed - failed - observed, total);
    }

    // ---------------------------------------------------------------- 실행 결과

    /**
     * 모든 흐름의 마지막 실행 결과를 한 쿼리로 가져와 리포트 spec 경로별로 묶는다.
     * 리포트 경로는 testDir 기준이라 저장된 경로의 뒷부분만 같을 수 있어, 뒷부분 후보를 모두 묻는다.
     */
    private Map<String, List<ExecutionCaseResult>> latestResults(String projectId, List<ScenarioOrigin> origins) {
        Set<String> paths = new LinkedHashSet<>();
        origins.forEach(origin -> paths.addAll(suffixes(origin.getSpecPath())));
        Map<String, List<ExecutionCaseResult>> bySpec = new HashMap<>();
        if (paths.isEmpty()) {
            return bySpec;
        }
        for (ExecutionCaseResult result : caseResultRepository.findLatestBySpecPaths(projectId, paths)) {
            bySpec.computeIfAbsent(result.getSpecPath(), k -> new ArrayList<>()).add(result);
        }
        return bySpec;
    }

    /** 이 spec 의 마지막 실행 결과. 뒷부분 후보 중 가장 최근 실행의 결과만 쓴다. */
    static List<ExecutionCaseResult> latestFor(String specPath, Map<String, List<ExecutionCaseResult>> bySpec) {
        List<ExecutionCaseResult> all = new ArrayList<>();
        for (String suffix : suffixes(specPath)) {
            all.addAll(bySpec.getOrDefault(suffix, List.of()));
        }
        Long latest = all.stream().map(ExecutionCaseResult::getExecutionId).filter(java.util.Objects::nonNull)
                .max(Long::compare).orElse(null);
        return latest == null ? List.of() : all.stream().filter(r -> latest.equals(r.getExecutionId())).toList();
    }

    static List<String> suffixes(String path) {
        List<String> suffixes = new ArrayList<>();
        if (path == null) {
            return suffixes;
        }
        suffixes.add(path);
        for (int i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) {
            suffixes.add(path.substring(i + 1));
        }
        return suffixes;
    }

    // ---------------------------------------------------------------- 흐름 이름

    /** spec 의 첫 test 제목. 파일을 못 읽으면 파일 이름. */
    private String titleOf(String projectId, String specPath) {
        try {
            Path file = fileStorageService.resolveFile(projectId, specPath);
            if (Files.isRegularFile(file)) {
                try (InputStream in = Files.newInputStream(file)) {
                    String head = new String(in.readNBytes(TITLE_READ_BYTES), StandardCharsets.UTF_8);
                    String title = CoverageRules.firstTestTitle(head);
                    if (title != null) {
                        return title;
                    }
                }
            }
        } catch (IOException | RuntimeException e) {
            // 읽지 못하면 파일 이름을 쓴다.
        }
        return CoverageRules.fileName(specPath);
    }

    private List<String> readStrings(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
        }
    }

    private List<Map<String, Object>> readElements(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
        }
    }
}
