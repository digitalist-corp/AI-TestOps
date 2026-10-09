package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Project;
import com.playops.api.entity.SiteAnalysisRun;
import com.playops.api.entity.SiteEdge;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteAnalysisRunRepository;
import com.playops.api.repository.SiteEdgeRepository;
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
 * 프로젝트의 앱 소스 저장소를 읽어 화면 목록을 만든다.
 *
 * 브라우저를 띄우지 않고 파일만 읽으므로 러너 컨테이너를 쓰지 않고 이 프로세스에서 돈다.
 * (저장소 복제만 기존의 격리 컨테이너에 맡긴다.)
 */
@Service
public class SiteAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(SiteAnalysisService.class);
    private static final Pattern SHA = Pattern.compile("^[0-9a-f]{40,64}$");

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
    private final SiteAnalysisRunRepository runRepository;
    private final SiteNodeRepository nodeRepository;
    private final SiteNodeEditRepository editRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SiteAnalysisService(ProjectService projectService, ProjectRepository projectRepository,
                               GitRepositoryService gitRepositoryService, DockerRunnerService dockerRunnerService,
                               SecretCipherService secretCipherService, PlayOpsProperties properties,
                               ScreenFinder screenFinder, ScreenExtractor screenExtractor,
                               SiteAnalysisRunRepository runRepository, SiteNodeRepository nodeRepository,
                               SiteNodeEditRepository editRepository, SiteEdgeRepository edgeRepository,
                               ScenarioOriginRepository originRepository) {
        this.originRepository = originRepository;
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
    public record Source(String url, String branch, boolean tokenSet, boolean usesProjectRepository) {}

    public record Analysis(String status, String commitSha, String framework, boolean partial, int screenCount,
                           int processedCount, int llmCalls, Long etaSeconds,
                           List<String> warnings, String errorMessage, Instant startedAt, Instant finishedAt) {}

    /** 목록 화면의 진행 배지용. 진행 중인 분석만 내준다. */
    public record Running(String projectId, int screenCount, int processedCount, Long etaSeconds) {}

    public record Node(String routeKey, String title, String sourceFile, String origin, boolean stale,
                       int elementCount, boolean excluded, String note) {}

    public record Edge(String from, String to, String kind, String label, String selector) {}

    public record SiteMap(String projectId, Source source, Analysis analysis, List<Node> nodes, List<Edge> edges) {}

    /** 화면 하나의 상세. elements 는 저장된 JSON 을 그대로 내준다. */
    public record NodeDetail(Node node, List<Map<String, Object>> elements, List<Edge> edges) {}

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
        return new SiteMap(projectId, sourceOf(project), analysis, nodes, edgesOf(projectId, null));
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
                edit != null && edit.isExcluded(), edit != null ? edit.getNote() : null);
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
                readElements(node.getElements()), edgesOf(projectId, routeKey));
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
                !own && project.isRepositoryConnected());
    }

    private static boolean hasOwnSource(Project project) {
        return project.getSourceRepositoryUrl() != null && !project.getSourceRepositoryUrl().isBlank();
    }

    // ---------------------------------------------------------------- 분석 실행

    /** 실행 기록을 만들고 돌려준다. 실제 분석은 호출자가 {@link #runAsync(Long)} 로 따로 시작한다 (@Async 는 자기 호출에서 동작하지 않는다). */
    public SiteAnalysisRun start(String projectId) {
        Project project = projectService.getProject(projectId);
        if (!hasOwnSource(project) && !project.isRepositoryConnected()) {
            throw new ApiException(400, "분석할 소스 저장소가 없습니다. 소스 저장소를 먼저 연결하세요.");
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
            readScreens(run, project, source, found, nodes, warnings);
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

    /** 프로젝트를 지울 때 그 프로젝트의 구조 데이터도 지운다. 같은 id 로 다시 만들었을 때 옛 화면이 보이면 안 된다. */
    public void forget(String projectId) {
        edgeRepository.deleteAll(edgeRepository.findByProjectId(projectId));
        nodeRepository.deleteAll(nodeRepository.findByProjectIdOrderByRouteKey(projectId));
        editRepository.deleteAll(editRepository.findByProjectId(projectId));
        originRepository.deleteAll(originRepository.findByProjectId(projectId));
        runRepository.deleteAll(runRepository.findByProjectId(projectId));
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
            node.setLastSeenCommit(commit);
            node.setStale(false);
            toSave.add(node);
        }
        for (SiteNode gone : existing.values()) {
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
     * 화면마다 파일 묶음을 LLM 에 보여 주고 요소를 채운다. 묶음이 지난번과 같으면 부르지 않는다.
     * 한 화면에서 실패해도 나머지는 계속하고, 그 화면은 이전 내용을 그대로 둔다.
     */
    private void readScreens(SiteAnalysisRun run, Project project, Path source, ScreenFinder.Result found,
                             Map<String, SiteNode> nodes, List<String> warnings) throws IOException {
        List<String> knownRoutes = new ArrayList<>(nodes.keySet());
        int llmCalls = 0;
        int processed = 0;
        for (SiteNode node : nodes.values()) {
            Map<String, String> bundle = screenExtractor.bundle(source, found.appRoot(), node.getSourceFile());
            String hash = screenExtractor.hash(bundle);
            if (!bundle.isEmpty() && !hash.equals(node.getContentHash())) {
                try {
                    llmCalls++;
                    ScreenExtractor.Extraction extraction = screenExtractor.extract(
                            project.getAiModelProvider(), project.getProjectId(), node.getRouteKey(), knownRoutes, bundle);
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
        edgeRepository.deleteAll(edgeRepository.findByProjectId(projectId));
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
                edge.setSelector(selectorForLabel(node, label));
                byTarget.putIfAbsent(to, edge); // 같은 두 화면 사이의 링크는 하나로 합친다.
            }
            edges.addAll(byTarget.values());
        }
        edgeRepository.saveAll(edges);
    }

    /** 링크의 글자와 이름이 같은 요소가 화면에 있으면 그 셀렉터를 전환에 붙인다. */
    private String selectorForLabel(SiteNode node, String label) {
        if (label == null) {
            return null;
        }
        for (Map<String, Object> element : readElements(node.getElements())) {
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
