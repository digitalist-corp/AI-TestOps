package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Project;
import com.playops.api.entity.SiteAnalysisRun;
import com.playops.api.entity.SiteEdge;
import com.playops.api.entity.SiteLayout;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteAnalysisRunRepository;
import com.playops.api.repository.SiteEdgeRepository;
import com.playops.api.repository.SiteLayoutRepository;
import com.playops.api.repository.SiteNodeEditRepository;
import com.playops.api.repository.SiteNodeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 프로젝트의 화면 목록을 만든다. 길은 두 가지다.
 *
 * - 코드 분석(origin=CODE): 앱 소스 저장소를 읽는다. 브라우저를 띄우지 않고 파일만 읽으므로 러너 컨테이너를
 *   쓰지 않고 이 프로세스에서 돈다. (저장소 복제만 기존의 격리 컨테이너에 맡긴다.)
 * - 사이트 탐색(origin=SITE): 소스 저장소 없이 대상 사이트 주소(baseUrl)만으로, AI Runner 의 analyze.js 가
 *   실제 브라우저로 화면을 열어 요소를 모으고 셀렉터가 그 요소 하나만 가리키는지 확인한다. LLM 을 쓰지 않는다.
 */
@Service
public class SiteAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(SiteAnalysisService.class);
    private static final Pattern SHA = Pattern.compile("^[0-9a-f]{40,64}$");

    /** 사이트 탐색 실행의 framework 값. 코드 분석(NEXT, REACT_ROUTER)과 구조 탭에서 구분한다. */
    public static final String URL_FRAMEWORK = "URL";
    public static final String ORIGIN_SITE = "SITE";
    public static final String ORIGIN_CODE = "CODE";

    /** 사이트 탐색 상한. 등록 직후 첫 테스트는 빠르게, 구조 탭에서 고른 전체 탐색은 넓게 돈다. */
    public record UrlLimits(int maxPages, int maxDepth, int timeoutMs) {}
    public static final UrlLimits QUICK_LIMITS = new UrlLimits(5, 1, 45_000);
    public static final UrlLimits FULL_LIMITS = new UrlLimits(20, 3, 180_000);

    /** 사이트 탐색 결과 요약. mode 는 DOM · VISUAL_REQUIRED · ERROR 중 하나다. */
    public record UrlOutcome(String mode, int pages, int verifiedSelectors, List<String> warnings, String errorMessage) {
        public boolean usable() {
            return "DOM".equals(mode) && pages > 0;
        }
    }

    private final ProjectService projectService;
    private final ProjectRepository projectRepository;
    private final GitRepositoryService gitRepositoryService;
    private final DockerRunnerService dockerRunnerService;
    private final SecretCipherService secretCipherService;
    private final PlayOpsProperties properties;
    private final ScreenFinder screenFinder;
    private final ScreenExtractor screenExtractor;
    private final SiteEdgeRepository edgeRepository;
    private final ScenarioOriginRepository originRepository;
    private final SiteLayoutRepository layoutRepository;
    private final SiteAnalysisRunRepository runRepository;
    private final SiteNodeRepository nodeRepository;
    private final SiteNodeEditRepository editRepository;
    private final AiRunnerDockerService aiRunnerDockerService;
    private final LoginSessionService loginSessionService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SiteAnalysisService(ProjectService projectService, ProjectRepository projectRepository,
                               GitRepositoryService gitRepositoryService, DockerRunnerService dockerRunnerService,
                               SecretCipherService secretCipherService, PlayOpsProperties properties,
                               ScreenFinder screenFinder, ScreenExtractor screenExtractor,
                               SiteAnalysisRunRepository runRepository, SiteNodeRepository nodeRepository,
                               SiteNodeEditRepository editRepository, SiteEdgeRepository edgeRepository,
                               ScenarioOriginRepository originRepository, SiteLayoutRepository layoutRepository,
                               AiRunnerDockerService aiRunnerDockerService, LoginSessionService loginSessionService) {
        this.aiRunnerDockerService = aiRunnerDockerService;
        this.loginSessionService = loginSessionService;
        this.originRepository = originRepository;
        this.layoutRepository = layoutRepository;
        this.projectService = projectService;
        this.projectRepository = projectRepository;
        this.gitRepositoryService = gitRepositoryService;
        this.dockerRunnerService = dockerRunnerService;
        this.secretCipherService = secretCipherService;
        this.properties = properties;
        this.screenFinder = screenFinder;
        this.screenExtractor = screenExtractor;
        this.edgeRepository = edgeRepository;
        this.runRepository = runRepository;
        this.nodeRepository = nodeRepository;
        this.editRepository = editRepository;
    }

    // ---------------------------------------------------------------- 응답 형태

    /** tokenSet 만 돌려주고 토큰 값은 응답에 싣지 않는다. */
    public record Source(String url, String branch, boolean tokenSet, boolean usesProjectRepository, String siteUrl) {}

    public record Analysis(String status, String commitSha, String framework, boolean partial, int screenCount,
                           int processedCount, int llmCalls, Long etaSeconds,
                           List<String> warnings, String errorMessage, Instant startedAt, Instant finishedAt) {}

    /** 목록 화면의 진행 배지용. 진행 중인 분석만 내준다. */
    public record Running(String projectId, int screenCount, int processedCount, Long etaSeconds) {}

    public record Node(String routeKey, String title, String sourceFile, String origin, boolean stale,
                       int elementCount, boolean excluded, String note, String url, boolean hasScreenshot) {}

    public record Edge(String from, String to, String kind, String label, String selector) {}

    /**
     * 여러 화면을 감싸는 공용 영역(상단 메뉴, 사이드바). routeKeys 의 화면 어디서든 links 의 화면으로 갈 수 있다.
     * 화면마다 전환으로 복제하지 않고 따로 내준다.
     */
    public record Layout(String sourceFile, List<String> routeKeys, int elementCount, List<Map<String, Object>> links) {}

    public record SiteMap(String projectId, Source source, Analysis analysis, List<Node> nodes, List<Edge> edges,
                          List<Layout> layouts) {}

    /** 화면 하나의 상세. elements 는 저장된 JSON 을 그대로 내준다. */
    public record NodeDetail(Node node, List<Map<String, Object>> elements, List<Edge> edges,
                             List<Map<String, Object>> forms) {}

    public record NodeEditRequest(Boolean excluded, String note) {}

    public record SourceRequest(String url, String branch, String token) {}

    // ---------------------------------------------------------------- 조회 · 설정

    public SiteMap view(String projectId) {
        Project project = projectService.getProject(projectId);
        Map<String, SiteNodeEdit> edits = new HashMap<>();
        for (SiteNodeEdit edit : editRepository.findByProjectId(projectId)) {
            edits.put(edit.getRouteKey(), edit);
        }
        List<Node> nodes = new ArrayList<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            SiteNodeEdit edit = edits.get(node.getRouteKey());
            nodes.add(toNode(node, edit));
        }
        Analysis analysis = runRepository.findFirstByProjectIdOrderByIdDesc(projectId)
                .map(run -> new Analysis(run.getStatus(), run.getCommitSha(), run.getFramework(), run.isPartial(),
                        run.getScreenCount(), run.getProcessedCount(), run.getLlmCalls(), etaSeconds(run, Instant.now()),
                        readStrings(run.getWarnings()), run.getErrorMessage(),
                        run.getStartedAt(), run.getFinishedAt()))
                .orElse(new Analysis("NONE", null, null, false, 0, 0, 0, null, List.of(), null, null, null));
        List<Layout> layouts = layoutRepository.findByProjectId(projectId).stream()
                .map(layout -> new Layout(layout.getSourceFile(), readStrings(layout.getRouteKeys()),
                        readElements(layout.getElements()).size(), readElements(layout.getLinks())))
                .toList();
        return new SiteMap(projectId, sourceOf(project), analysis, nodes, edgesOf(projectId, null), layouts);
    }

    public List<Running> running() {
        Instant now = Instant.now();
        return runRepository.findByStatus(SiteAnalysisRun.RUNNING).stream()
                .map(run -> new Running(run.getProjectId(), run.getScreenCount(), run.getProcessedCount(), etaSeconds(run, now)))
                .toList();
    }

    /**
     * 남은 시간(초). 화면을 하나라도 읽은 뒤에만 낸다 — 그 전에는 화면이 몇 개인지, 하나에 얼마나 걸리는지 몰라
     * 숫자를 지어내게 된다. 화면 하나에 걸린 평균 시간을 남은 화면 수에 곱하고, 마지막 화면을 읽은 뒤
     * 흐른 시간을 뺀다. 그래서 다음 화면을 기다리는 동안에도 숫자가 줄어든다.
     */
    static Long etaSeconds(SiteAnalysisRun run, Instant now) {
        int done = run.getProcessedCount();
        int total = run.getScreenCount();
        if (!SiteAnalysisRun.RUNNING.equals(run.getStatus()) || done <= 0 || total <= done) {
            return null;
        }
        Instant progressAt = run.getProgressAt() != null ? run.getProgressAt() : now;
        double perScreenMs = (double) java.time.Duration.between(run.getStartedAt(), progressAt).toMillis() / done;
        long sinceProgressMs = java.time.Duration.between(progressAt, now).toMillis();
        return Math.max(1, Math.round((perScreenMs * (total - done) - sinceProgressMs) / 1000));
    }

    private Node toNode(SiteNode node, SiteNodeEdit edit) {
        return new Node(node.getRouteKey(), node.getTitle(), node.getSourceFile(), node.getOrigin(),
                node.isStale(), readElements(node.getElements()).size(),
                edit != null && edit.isExcluded(), edit != null ? edit.getNote() : null,
                node.getUrl(), node.getScreenshot() != null);
    }

    private List<Edge> edgesOf(String projectId, String routeKey) {
        List<Edge> edges = new ArrayList<>();
        for (SiteEdge edge : edgeRepository.findByProjectId(projectId)) {
            if (routeKey == null || routeKey.equals(edge.getFromRouteKey()) || routeKey.equals(edge.getToRouteKey())) {
                edges.add(new Edge(edge.getFromRouteKey(), edge.getToRouteKey(), edge.getKind(),
                        edge.getLabel(), edge.getSelector()));
            }
        }
        return edges;
    }

    public NodeDetail viewNode(String projectId, String routeKey) {
        SiteNode node = findNode(projectId, routeKey);
        return new NodeDetail(toNode(node, findEdit(projectId, routeKey)),
                readElements(node.getElements()), edgesOf(projectId, routeKey), readElements(node.getForms()));
    }

    /** 제외 표시와 메모. 분석 결과와 다른 테이블에 두므로 다시 분석해도 남는다. */
    public NodeDetail editNode(String projectId, String routeKey, NodeEditRequest request) {
        findNode(projectId, routeKey);
        SiteNodeEdit edit = findEdit(projectId, routeKey);
        if (edit == null) {
            edit = new SiteNodeEdit();
            edit.setProjectId(projectId);
            edit.setRouteKey(routeKey);
        }
        if (request.excluded() != null) {
            edit.setExcluded(request.excluded());
        }
        if (request.note() != null) {
            String note = request.note().trim();
            if (note.length() > 500) {
                throw new ApiException(400, "메모는 500자까지 쓸 수 있습니다.");
            }
            edit.setNote(note.isEmpty() ? null : note);
        }
        editRepository.save(edit);
        return viewNode(projectId, routeKey);
    }

    private SiteNode findNode(String projectId, String routeKey) {
        return nodeRepository.findByProjectIdOrderByRouteKey(projectId).stream()
                .filter(node -> node.getRouteKey().equals(routeKey))
                .findFirst()
                .orElseThrow(() -> new ApiException(404, "화면을 찾을 수 없습니다: " + routeKey));
    }

    private SiteNodeEdit findEdit(String projectId, String routeKey) {
        return editRepository.findByProjectId(projectId).stream()
                .filter(edit -> edit.getRouteKey().equals(routeKey))
                .findFirst()
                .orElse(null);
    }

    /** url 을 비우면 연결을 끊는다. token 은 null 이면 그대로 두고, 빈 문자열이면 지운다 (프로젝트 저장소 설정과 같은 규칙). */
    public void updateSource(String projectId, SourceRequest request) {
        Project project = projectService.getProject(projectId);
        String url = request.url() == null ? "" : request.url().trim();
        if (url.isBlank()) {
            project.setSourceRepositoryUrl(null);
            project.setSourceRepositoryBranch(null);
            project.setSourceRepositoryTokenEncrypted(null);
        } else {
            gitRepositoryService.validateAndNormalize(url);
            project.setSourceRepositoryUrl(url);
            project.setSourceRepositoryBranch(gitRepositoryService.validateBranch(request.branch()));
            if (request.token() != null) {
                project.setSourceRepositoryTokenEncrypted(secretCipherService.encrypt(request.token()));
            }
        }
        projectRepository.save(project);
    }

    private Source sourceOf(Project project) {
        boolean own = hasOwnSource(project);
        return new Source(
                own ? project.getSourceRepositoryUrl() : null,
                own ? project.getSourceRepositoryBranch() : null,
                own && project.getSourceRepositoryTokenEncrypted() != null,
                !own && project.isRepositoryConnected(),
                project.getBaseUrl());
    }

    private static boolean hasOwnSource(Project project) {
        return project.getSourceRepositoryUrl() != null && !project.getSourceRepositoryUrl().isBlank();
    }

    // ---------------------------------------------------------------- 분석 실행

    /** 실행 기록을 만들고 돌려준다. 실제 분석은 호출자가 {@link #runAsync(Long)} 로 따로 시작한다 (@Async 는 자기 호출에서 동작하지 않는다). */
    public SiteAnalysisRun start(String projectId) {
        Project project = projectService.getProject(projectId);
        if (!hasOwnSource(project) && !project.isRepositoryConnected()) {
            throw new ApiException(400, "분석할 소스 저장소가 없습니다. 소스 저장소를 연결하거나 사이트 주소로 탐색하세요.");
        }
        if (runRepository.existsByProjectIdAndStatus(projectId, SiteAnalysisRun.RUNNING)) {
            throw new ApiException(409, "이미 분석이 진행 중입니다.");
        }
        SiteAnalysisRun run = new SiteAnalysisRun();
        run.setProjectId(projectId);
        return runRepository.save(run);
    }

    @Async("aiJobExecutor")
    public void runAsync(Long runId) {
        SiteAnalysisRun run = runRepository.findById(runId).orElse(null);
        if (run == null) {
            return;
        }
        try {
            Project project = projectService.getProject(run.getProjectId());
            Path source = prepareSource(project);
            String commit = readCommitSha(source);
            ScreenFinder.Result found = screenFinder.find(source);

            run.setCommitSha(commit);
            run.setFramework(found.framework());
            run.setPartial(found.partial());
            run.setWarnings(objectMapper.writeValueAsString(found.warnings()));
            if (found.framework() == null) {
                fail(run, found.warnings().isEmpty() ? "화면을 찾지 못했습니다." : found.warnings().get(0));
                return;
            }
            Map<String, SiteNode> nodes = mergeNodes(run.getProjectId(), found.screens(), commit);
            run.setScreenCount(found.screens().size());
            runRepository.save(run);

            List<String> warnings = new ArrayList<>(found.warnings());
            int layoutCalls = readLayouts(project, source, found, nodes, warnings);
            readScreens(run, project, source, found, nodes, warnings, layoutCalls);
            rebuildEdges(run.getProjectId(), nodes);
            run.setWarnings(objectMapper.writeValueAsString(warnings));
            run.setStatus(SiteAnalysisRun.COMPLETED);
            run.setFinishedAt(Instant.now());
            runRepository.save(run);
        } catch (Exception e) {
            log.warn("구조 분석 실패 (project={}): {}", run.getProjectId(), e.getMessage());
            fail(run, e.getMessage());
        }
    }

    // ---------------------------------------------------------------- 사이트 탐색 (URL)

    /** 실행 기록을 만든다. 실제 탐색은 {@link #runByUrlAsync} 또는 {@link #executeUrl} 로 따로 한다. */
    public SiteAnalysisRun startByUrl(String projectId) {
        Project project = projectService.getProject(projectId);
        if (project.getBaseUrl() == null || project.getBaseUrl().isBlank()) {
            throw new ApiException(400, "탐색할 사이트 주소(baseUrl)가 없습니다. 프로젝트 설정에서 대상 주소를 먼저 입력하세요.");
        }
        if (runRepository.existsByProjectIdAndStatus(projectId, SiteAnalysisRun.RUNNING)) {
            throw new ApiException(409, "이미 분석이 진행 중입니다.");
        }
        SiteAnalysisRun run = new SiteAnalysisRun();
        run.setProjectId(projectId);
        run.setFramework(URL_FRAMEWORK);
        return runRepository.save(run);
    }

    @Async("aiJobExecutor")
    public void runByUrlAsync(Long runId, UrlLimits limits) {
        runRepository.findById(runId).ifPresent(run -> executeUrl(run, limits));
    }

    /** 첫 테스트 생성처럼 탐색 결과를 기다려야 하는 곳에서 부른다. 이미 다른 분석이 돌고 있으면 기다리지 않고 건너뛴다. */
    public UrlOutcome analyzeByUrl(String projectId, UrlLimits limits) {
        SiteAnalysisRun run;
        try {
            run = startByUrl(projectId);
        } catch (ApiException e) {
            return new UrlOutcome("ERROR", 0, 0, List.of(), e.getMessage());
        }
        return executeUrl(run, limits);
    }

    /** 테스트 생성에 쓸 화면 정보(코드 분석이든 사이트 탐색이든)가 하나라도 있는지. */
    public boolean hasUsableNodes(String projectId) {
        return nodeRepository.findByProjectIdOrderByRouteKey(projectId).stream().anyMatch(node -> !node.isStale());
    }

    UrlOutcome executeUrl(SiteAnalysisRun run, UrlLimits limits) {
        Path jobDir = siteAnalysisDir(run.getProjectId()).resolve("run-" + run.getId());
        try {
            Project project = projectService.getProject(run.getProjectId());
            Files.createDirectories(jobDir);
            Map<String, Object> job = new LinkedHashMap<>();
            job.put("jobId", run.getId());
            job.put("baseUrl", project.getBaseUrl());
            job.put("seedUrls", codeRouteSeeds(run.getProjectId()));
            job.put("limits", Map.of("maxPages", limits.maxPages(), "maxDepth", limits.maxDepth(),
                    "timeoutMs", limits.timeoutMs()));
            // 로그인 선행 시나리오가 만든 세션이 있으면 로그인 뒤 화면까지 본다. 컨테이너에는 작업 폴더만 보이므로 복사해 넘긴다.
            Path storageState = loginSessionService.storageStateFile(run.getProjectId());
            if (Files.isRegularFile(storageState)) {
                Files.copy(storageState, jobDir.resolve("state.json"), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                job.put("auth", Map.of("storageStatePath", dockerRunnerService.directoryContainerPath(jobDir) + "/state.json"));
            }

            Map<String, Object> result = aiRunnerDockerService.runSiteAnalysisJob(
                    project, jobDir, job, limits.timeoutMs() / 1000 + 120);
            if (!"COMPLETED".equals(result.get("status"))) {
                String error = result.get("error") instanceof String e ? e : "사이트 탐색에 실패했습니다.";
                fail(run, error);
                return new UrlOutcome("ERROR", 0, 0, List.of(), error);
            }
            UrlOutcome outcome = applyUrlResult(run.getProjectId(), result, "run-" + run.getId() + "/result/");
            run.setScreenCount(outcome.pages());
            run.setProcessedCount(outcome.pages());
            run.setPartial(!"DOM".equals(outcome.mode()));
            run.setWarnings(objectMapper.writeValueAsString(outcome.warnings()));
            run.setStatus(SiteAnalysisRun.COMPLETED);
            run.setFinishedAt(Instant.now());
            runRepository.save(run);
            deleteOtherRunDirs(run.getProjectId(), jobDir);
            return outcome;
        } catch (Exception e) {
            log.warn("사이트 탐색 실패 (project={}): {}", run.getProjectId(), e.getMessage());
            fail(run, e.getMessage());
            return new UrlOutcome("ERROR", 0, 0, List.of(), e.getMessage());
        } finally {
            try {
                Files.deleteIfExists(jobDir.resolve("state.json"));
            } catch (IOException ignored) {
                // 세션 파일 정리 실패는 다음 탐색 때 덮어쓴다.
            }
        }
    }

    /**
     * analyze.js 의 result.json 을 화면 · 전환으로 저장한다. 화면 키는 실제로 연 주소의 경로다.
     * 이번에 다시 보지 못한 사이트 탐색 화면은 stale 로 표시하고, 코드 분석 화면은 건드리지 않는다.
     *
     * @param screenshotPrefix siteAnalysisDir 기준 스크린샷 폴더 (끝에 / 포함)
     */
    @SuppressWarnings("unchecked")
    UrlOutcome applyUrlResult(String projectId, Map<String, Object> result, String screenshotPrefix) throws IOException {
        String mode = result.get("mode") instanceof String m ? m : "DOM";
        List<String> warnings = new ArrayList<>();
        if (result.get("warnings") instanceof List<?> list) {
            list.forEach(w -> warnings.add(String.valueOf(w)));
        }
        List<Map<String, Object>> rawNodes = result.get("nodes") instanceof List<?> list
                ? (List<Map<String, Object>>) list : List.of();
        List<Map<String, Object>> rawEdges = result.get("edges") instanceof List<?> list
                ? (List<Map<String, Object>>) list : List.of();

        Map<String, String> routeById = new HashMap<>();
        Map<String, Map<String, Object>> byRoute = new LinkedHashMap<>();
        for (Map<String, Object> raw : rawNodes) {
            String route = raw.get("path") instanceof String p && !p.isBlank() ? p : "/";
            routeById.put(String.valueOf(raw.get("id")), route);
            byRoute.putIfAbsent(route, raw); // 쿼리만 다른 같은 화면은 처음 본 것을 쓴다.
        }

        Map<String, SiteNode> existing = new HashMap<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            existing.put(node.getRouteKey(), node);
        }
        List<SiteNode> toSave = new ArrayList<>();
        int verified = 0;
        for (Map.Entry<String, Map<String, Object>> entry : byRoute.entrySet()) {
            Map<String, Object> raw = entry.getValue();
            SiteNode node = existing.remove(entry.getKey());
            if (node == null) {
                node = new SiteNode();
                node.setProjectId(projectId);
                node.setRouteKey(entry.getKey());
            }
            List<Map<String, Object>> elements = new ArrayList<>();
            if (raw.get("elements") instanceof List<?> list) {
                for (Object item : list) {
                    Map<String, Object> element = siteElement((Map<String, Object>) item);
                    if ("OBSERVED".equals(element.get("verification"))) {
                        verified++;
                    }
                    elements.add(element);
                }
            }
            List<Map<String, Object>> links = new ArrayList<>();
            for (Map<String, Object> edge : rawEdges) {
                String from = routeById.get(String.valueOf(edge.get("from")));
                String to = edge.get("to") == null ? null : routeById.get(String.valueOf(edge.get("to")));
                if (entry.getKey().equals(from) && to != null && !to.equals(from)) {
                    Map<String, Object> link = new LinkedHashMap<>();
                    link.put("to", to);
                    link.put("label", edge.get("label"));
                    link.put("selector", edge.get("selector"));
                    links.add(link);
                }
            }
            node.setOrigin(ORIGIN_SITE);
            node.setUrl(raw.get("url") instanceof String u ? u : null);
            if (raw.get("title") instanceof String title && !title.isBlank()) {
                node.setTitle(title.length() > 300 ? title.substring(0, 300) : title);
            }
            node.setElements(objectMapper.writeValueAsString(elements));
            node.setLinks(objectMapper.writeValueAsString(links));
            node.setForms(objectMapper.writeValueAsString(raw.get("forms") instanceof List<?> f ? f : List.of()));
            node.setAriaSnapshot(raw.get("ariaSnapshot") instanceof String aria ? aria : null);
            node.setScreenshot(raw.get("screenshot") instanceof String shot ? screenshotPrefix + shot : null);
            node.setContentHash(null); // 코드 분석이 같은 화면을 다시 만나면 LLM 으로 다시 읽게 한다.
            node.setStale(false);
            toSave.add(node);
        }
        for (SiteNode gone : existing.values()) {
            if (ORIGIN_SITE.equals(gone.getOrigin()) && !"VISUAL_REQUIRED".equals(mode)) {
                gone.setStale(true);
                gone.setScreenshot(null); // 지난 실행 폴더는 지운다.
                toSave.add(gone);
            }
        }
        nodeRepository.saveAll(toSave);

        // 이번에 본 화면에서 나가는 전환만 다시 만든다. 코드 분석의 전환은 그대로 둔다.
        edgeRepository.deleteAll(edgeRepository.findByProjectId(projectId).stream()
                .filter(edge -> byRoute.containsKey(edge.getFromRouteKey()))
                .toList());
        List<SiteEdge> edges = new ArrayList<>();
        for (SiteNode node : toSave) {
            if (node.isStale()) {
                continue;
            }
            for (Map<String, Object> link : readElements(node.getLinks())) {
                SiteEdge edge = new SiteEdge();
                edge.setProjectId(projectId);
                edge.setFromRouteKey(node.getRouteKey());
                edge.setToRouteKey(String.valueOf(link.get("to")));
                edge.setLabel(link.get("label") instanceof String label && label.length() <= 300 ? label : null);
                edge.setSelector(link.get("selector") instanceof String selector ? selector : null);
                edges.add(edge);
            }
        }
        edgeRepository.saveAll(edges);
        return new UrlOutcome(mode, byRoute.size(), verified, warnings, null);
    }

    /**
     * analyze.js 의 요소를 코드 분석 요소와 같은 모양으로 맞춘다. 실제 화면에서 정확히 하나만 가리키는 것을
     * 확인한 셀렉터는 OBSERVED, 순번(.nth)에 기대는 셀렉터는 duplicate 로 표시한다.
     */
    static Map<String, Object> siteElement(Map<String, Object> raw) {
        Map<String, Object> element = new LinkedHashMap<>();
        Object role = raw.get("role");
        element.put("kind", role != null ? role : raw.get("tag"));
        for (String key : List.of("idx", "tag", "type", "role", "name", "label", "placeholder", "text", "testId",
                "href", "scope", "selector", "selectorKind", "required", "inForm")) {
            Object value = raw.get(key);
            if (value != null && !"".equals(value)) {
                element.put(key, value);
            }
        }
        boolean fragile = Boolean.TRUE.equals(raw.get("fragile"));
        if (fragile) {
            element.put("duplicate", true);
        }
        boolean unique = Boolean.TRUE.equals(raw.get("unique"));
        element.put("verification", raw.get("selector") != null && unique && !fragile ? "OBSERVED" : "UNVERIFIED");
        return element;
    }

    /** 코드 분석에서 찾은 화면 중 경로 변수가 없는 것. 링크로 닿지 않는 화면도 열어 보게 시작점으로 넘긴다. */
    private List<String> codeRouteSeeds(String projectId) {
        return nodeRepository.findByProjectIdOrderByRouteKey(projectId).stream()
                .filter(node -> ORIGIN_CODE.equals(node.getOrigin()) && !node.isStale())
                .map(SiteNode::getRouteKey)
                .filter(route -> route.startsWith("/") && !route.contains(":") && !route.contains("[") && !route.contains("*"))
                .limit(20)
                .toList();
    }

    private java.util.Set<String> siteRouteKeys(String projectId) {
        java.util.Set<String> keys = new java.util.HashSet<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            if (ORIGIN_SITE.equals(node.getOrigin())) {
                keys.add(node.getRouteKey());
            }
        }
        return keys;
    }

    public Path siteAnalysisDir(String projectId) {
        return Path.of(properties.storageRoot(), "site-analysis", projectId).toAbsolutePath().normalize();
    }

    /** 화면 스크린샷 파일. 저장된 경로가 탐색 폴더 밖을 가리키면 거부한다. */
    public Path screenshotFile(String projectId, String routeKey) {
        SiteNode node = findNode(projectId, routeKey);
        if (node.getScreenshot() == null) {
            throw new ApiException(404, "이 화면은 스크린샷이 없습니다.");
        }
        Path base = siteAnalysisDir(projectId);
        Path file = base.resolve(node.getScreenshot()).normalize();
        if (!file.startsWith(base) || !Files.isRegularFile(file)) {
            throw new ApiException(404, "스크린샷 파일을 찾을 수 없습니다.");
        }
        return file;
    }

    private void deleteOtherRunDirs(String projectId, Path keep) {
        try (var dirs = Files.list(siteAnalysisDir(projectId))) {
            for (Path dir : dirs.filter(Files::isDirectory).filter(d -> !d.equals(keep)).toList()) {
                try (var walk = Files.walk(dir)) {
                    walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
                }
            }
        } catch (IOException e) {
            log.debug("지난 사이트 탐색 폴더 정리 실패 (project={}): {}", projectId, e.getMessage());
        }
    }

    /** 프로젝트를 지울 때 그 프로젝트의 구조 데이터도 지운다. 같은 id 로 다시 만들었을 때 옛 화면이 보이면 안 된다. */
    public void forget(String projectId) {
        edgeRepository.deleteAll(edgeRepository.findByProjectId(projectId));
        nodeRepository.deleteAll(nodeRepository.findByProjectIdOrderByRouteKey(projectId));
        editRepository.deleteAll(editRepository.findByProjectId(projectId));
        originRepository.deleteAll(originRepository.findByProjectId(projectId));
        layoutRepository.deleteAll(layoutRepository.findByProjectId(projectId));
        runRepository.deleteAll(runRepository.findByProjectId(projectId));
        deleteOtherRunDirs(projectId, null);
    }

    /** 서버가 꺼지면서 끝나지 못한 실행을 정리한다. 그대로 두면 "이미 진행 중"으로 막혀 다시 분석할 수 없다. */
    public void failInterruptedRuns() {
        for (SiteAnalysisRun run : runRepository.findByStatus(SiteAnalysisRun.RUNNING)) {
            fail(run, "서버가 다시 시작되어 분석이 중단되었습니다. 다시 실행하세요.");
        }
    }

    private void fail(SiteAnalysisRun run, String message) {
        run.setStatus(SiteAnalysisRun.FAILED);
        run.setErrorMessage(message);
        run.setFinishedAt(Instant.now());
        runRepository.save(run);
    }

    /**
     * 찾은 화면을 저장된 화면과 맞춘다. routeKey 가 같으면 같은 화면으로 보고 갱신하고,
     * 이번에 나오지 않은 화면은 지우지 않고 stale 로만 표시한다 (메모와 테스트 연결을 지킨다).
     */
    Map<String, SiteNode> mergeNodes(String projectId, List<ScreenFinder.Screen> screens, String commit) {
        Map<String, SiteNode> existing = new HashMap<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            existing.put(node.getRouteKey(), node);
        }
        List<SiteNode> toSave = new ArrayList<>();
        for (ScreenFinder.Screen screen : screens) {
            SiteNode node = existing.remove(screen.routeKey());
            if (node == null) {
                node = new SiteNode();
                node.setProjectId(projectId);
                node.setRouteKey(screen.routeKey());
                node.setFirstSeenCommit(commit);
            }
            node.setSourceFile(screen.sourceFile());
            node.setOrigin(ORIGIN_CODE);
            node.setLastSeenCommit(commit);
            node.setStale(false);
            toSave.add(node);
        }
        for (SiteNode gone : existing.values()) {
            if (ORIGIN_SITE.equals(gone.getOrigin())) {
                continue; // 사이트 탐색으로 찾은 화면은 코드에 없어도 실제로 열렸던 화면이다.
            }
            gone.setStale(true);
            toSave.add(gone);
        }
        nodeRepository.saveAll(toSave);
        Map<String, SiteNode> current = new LinkedHashMap<>();
        for (SiteNode node : toSave) {
            if (!node.isStale()) {
                current.put(node.getRouteKey(), node);
            }
        }
        return current;
    }

    /**
     * 화면을 감싸는 공용 레이아웃(상단 메뉴, 사이드바)을 읽는다. 레이아웃 파일 하나에 한 번만 읽고,
     * 그 레이아웃이 감싸는 화면 목록과 함께 저장한다. 화면과 같은 방식으로 묶음이 같으면 건너뛴다.
     *
     * @return LLM 을 부른 횟수
     */
    private int readLayouts(Project project, Path source, ScreenFinder.Result found,
                            Map<String, SiteNode> nodes, List<String> warnings) throws IOException {
        Map<String, List<String>> routesByLayout = new LinkedHashMap<>();
        for (ScreenFinder.Screen screen : found.screens()) {
            if (!nodes.containsKey(screen.routeKey())) {
                continue;
            }
            for (String layoutFile : screen.layoutFiles()) {
                routesByLayout.computeIfAbsent(layoutFile, key -> new ArrayList<>()).add(screen.routeKey());
            }
        }
        Map<String, SiteLayout> existing = new HashMap<>();
        for (SiteLayout layout : layoutRepository.findByProjectId(project.getProjectId())) {
            existing.put(layout.getSourceFile(), layout);
        }
        List<String> knownRoutes = new ArrayList<>(nodes.keySet());
        int llmCalls = 0;
        for (Map.Entry<String, List<String>> entry : routesByLayout.entrySet()) {
            SiteLayout layout = existing.remove(entry.getKey());
            if (layout == null) {
                layout = new SiteLayout();
                layout.setProjectId(project.getProjectId());
                layout.setSourceFile(entry.getKey());
            }
            layout.setRouteKeys(objectMapper.writeValueAsString(entry.getValue()));
            Map<String, String> bundle = screenExtractor.bundle(source, found.appRoot(), entry.getKey());
            String hash = screenExtractor.hash(bundle);
            if (!bundle.isEmpty() && !hash.equals(layout.getContentHash())) {
                try {
                    llmCalls++;
                    ScreenExtractor.Extraction extraction = screenExtractor.extract(null,
                            project.getProjectId(), "여러 화면에 공통으로 보이는 영역 (" + entry.getKey() + ")", knownRoutes, bundle);
                    List<Map<String, Object>> elements = extraction.elements();
                    for (Map<String, Object> element : elements) {
                        SelectorBuilder.apply(element);
                        element.put("verification", "UNVERIFIED");
                    }
                    SelectorBuilder.markDuplicates(elements);
                    List<Map<String, Object>> links = new ArrayList<>();
                    for (Map<String, Object> link : extraction.links()) {
                        Map<String, Object> withSelector = new LinkedHashMap<>(link);
                        withSelector.put("selector", selectorForLabel(elements, link.get("label")));
                        links.add(withSelector);
                    }
                    layout.setElements(objectMapper.writeValueAsString(elements));
                    layout.setLinks(objectMapper.writeValueAsString(links));
                    layout.setContentHash(hash);
                } catch (RuntimeException e) {
                    warnings.add(entry.getKey() + " 공용 영역을 읽지 못했습니다: " + e.getMessage());
                }
            }
            layoutRepository.save(layout);
        }
        layoutRepository.deleteAll(existing.values()); // 더는 어떤 화면도 감싸지 않는 레이아웃
        return llmCalls;
    }

    /**
     * 화면마다 파일 묶음을 LLM 에 보여 주고 요소를 채운다. 묶음이 지난번과 같으면 부르지 않는다.
     * 한 화면에서 실패해도 나머지는 계속하고, 그 화면은 이전 내용을 그대로 둔다.
     */
    private void readScreens(SiteAnalysisRun run, Project project, Path source, ScreenFinder.Result found,
                             Map<String, SiteNode> nodes, List<String> warnings, int callsSoFar) throws IOException {
        List<String> knownRoutes = new ArrayList<>(nodes.keySet());
        int llmCalls = callsSoFar;
        int processed = 0;
        for (SiteNode node : nodes.values()) {
            Map<String, String> bundle = screenExtractor.bundle(source, found.appRoot(), node.getSourceFile());
            String hash = screenExtractor.hash(bundle);
            if (!bundle.isEmpty() && !hash.equals(node.getContentHash())) {
                try {
                    llmCalls++;
                    ScreenExtractor.Extraction extraction = screenExtractor.extract(
                            null, project.getProjectId(), node.getRouteKey(), knownRoutes, bundle);
                    applyExtraction(node, extraction, hash);
                    nodeRepository.save(node);
                } catch (RuntimeException e) {
                    warnings.add(node.getRouteKey() + " 화면의 요소를 읽지 못했습니다: " + e.getMessage());
                }
            }
            run.setProcessedCount(++processed);
            run.setLlmCalls(llmCalls);
            runRepository.save(run);
        }
    }

    /** 셀렉터를 조립하고, 이전 분석에서 확인된 셀렉터의 확인 상태는 이어받는다. */
    void applyExtraction(SiteNode node, ScreenExtractor.Extraction extraction, String hash) throws IOException {
        Map<String, Object> previousStatus = new HashMap<>();
        for (Map<String, Object> old : readElements(node.getElements())) {
            if (old.get("selector") instanceof String selector && old.get("verification") != null) {
                previousStatus.put(selector, old.get("verification"));
            }
        }
        List<Map<String, Object>> elements = extraction.elements();
        for (Map<String, Object> element : elements) {
            SelectorBuilder.apply(element);
        }
        SelectorBuilder.markDuplicates(elements);
        for (Map<String, Object> element : elements) {
            element.put("verification", previousStatus.getOrDefault(String.valueOf(element.get("selector")), "UNVERIFIED"));
        }
        node.setTitle(extraction.title());
        node.setAuthRequired(extraction.authRequired());
        node.setElements(objectMapper.writeValueAsString(elements));
        node.setLinks(objectMapper.writeValueAsString(extraction.links()));
        node.setContentHash(hash);
    }

    /** 전환은 화면에 저장된 링크에서 매번 다시 만든다. 그래야 LLM 을 건너뛴 화면의 전환도 빠지지 않는다. */
    private void rebuildEdges(String projectId, Map<String, SiteNode> nodes) {
        java.util.Set<String> siteRoutes = siteRouteKeys(projectId); // 사이트 탐색이 만든 전환은 남긴다.
        edgeRepository.deleteAll(edgeRepository.findByProjectId(projectId).stream()
                .filter(edge -> !siteRoutes.contains(edge.getFromRouteKey()))
                .toList());
        List<SiteEdge> edges = new ArrayList<>();
        for (SiteNode node : nodes.values()) {
            Map<String, SiteEdge> byTarget = new LinkedHashMap<>();
            for (Map<String, Object> link : readElements(node.getLinks())) {
                if (!(link.get("to") instanceof String to) || to.equals(node.getRouteKey()) || !nodes.containsKey(to)) {
                    continue;
                }
                SiteEdge edge = new SiteEdge();
                edge.setProjectId(projectId);
                edge.setFromRouteKey(node.getRouteKey());
                edge.setToRouteKey(to);
                String label = link.get("label") instanceof String value ? value : null;
                edge.setLabel(label);
                edge.setSelector(selectorForLabel(readElements(node.getElements()), label));
                byTarget.putIfAbsent(to, edge); // 같은 두 화면 사이의 링크는 하나로 합친다.
            }
            edges.addAll(byTarget.values());
        }
        edgeRepository.saveAll(edges);
    }

    /** 링크의 글자와 이름이 같은 요소가 있으면 그 셀렉터를 붙인다. */
    private static String selectorForLabel(List<Map<String, Object>> elements, Object label) {
        if (!(label instanceof String)) {
            return null;
        }
        for (Map<String, Object> element : elements) {
            if (label.equals(element.get("name")) || label.equals(element.get("text"))) {
                return element.get("selector") instanceof String selector ? selector : null;
            }
        }
        return null;
    }

    /** 소스 저장소가 따로 연결돼 있으면 복제해 오고, 아니면 이미 받아 둔 프로젝트 폴더를 읽는다. */
    private Path prepareSource(Project project) throws IOException {
        if (!hasOwnSource(project)) {
            return projectService.getProjectPath(project.getProjectId());
        }
        Path dir = Path.of(properties.storageRoot(), "source", project.getProjectId()).toAbsolutePath().normalize();
        Files.createDirectories(dir);
        gitRepositoryService.cloneInto(
                project.getProjectId(),
                project.getSourceRepositoryUrl(),
                project.getSourceRepositoryBranch(),
                secretCipherService.decrypt(project.getSourceRepositoryTokenEncrypted()),
                dockerRunnerService.directoryContainerPath(dir),
                dockerRunnerService.directoryVolumeArgs(dir));
        return dir;
    }

    /** git 을 실행하지 않고 .git 안의 파일에서 현재 커밋을 읽는다. 저장소가 아니면 null. */
    static String readCommitSha(Path repoRoot) {
        try {
            Path gitDir = repoRoot.resolve(".git");
            Path headFile = gitDir.resolve("HEAD");
            if (!Files.isRegularFile(headFile)) {
                return null;
            }
            String head = Files.readString(headFile, StandardCharsets.UTF_8).trim();
            if (!head.startsWith("ref:")) {
                return SHA.matcher(head).matches() ? head : null;
            }
            String ref = head.substring(4).trim();
            Path refFile = gitDir.resolve(ref).normalize();
            if (refFile.startsWith(gitDir) && Files.isRegularFile(refFile)) {
                String sha = Files.readString(refFile, StandardCharsets.UTF_8).trim();
                return SHA.matcher(sha).matches() ? sha : null;
            }
            Path packed = gitDir.resolve("packed-refs");
            if (Files.isRegularFile(packed)) {
                for (String line : Files.readAllLines(packed, StandardCharsets.UTF_8)) {
                    if (line.endsWith(" " + ref)) {
                        String sha = line.substring(0, line.indexOf(' '));
                        return SHA.matcher(sha).matches() ? sha : null;
                    }
                }
            }
        } catch (IOException ignored) {
            // 커밋을 못 읽어도 분석은 계속한다.
        }
        return null;
    }

    private List<Map<String, Object>> readElements(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
        }
    }

    private List<String> readStrings(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
        }
    }
}
