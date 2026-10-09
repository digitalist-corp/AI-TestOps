package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Project;
import com.playops.api.entity.SiteAnalysisRun;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.SiteAnalysisRunRepository;
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
    private final SiteAnalysisRunRepository runRepository;
    private final SiteNodeRepository nodeRepository;
    private final SiteNodeEditRepository editRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SiteAnalysisService(ProjectService projectService, ProjectRepository projectRepository,
                               GitRepositoryService gitRepositoryService, DockerRunnerService dockerRunnerService,
                               SecretCipherService secretCipherService, PlayOpsProperties properties,
                               ScreenFinder screenFinder, SiteAnalysisRunRepository runRepository,
                               SiteNodeRepository nodeRepository, SiteNodeEditRepository editRepository) {
        this.projectService = projectService;
        this.projectRepository = projectRepository;
        this.gitRepositoryService = gitRepositoryService;
        this.dockerRunnerService = dockerRunnerService;
        this.secretCipherService = secretCipherService;
        this.properties = properties;
        this.screenFinder = screenFinder;
        this.runRepository = runRepository;
        this.nodeRepository = nodeRepository;
        this.editRepository = editRepository;
    }

    // ---------------------------------------------------------------- 응답 형태

    /** tokenSet 만 돌려주고 토큰 값은 응답에 싣지 않는다. */
    public record Source(String url, String branch, boolean tokenSet, boolean usesProjectRepository) {}

    public record Analysis(String status, String commitSha, String framework, boolean partial, int screenCount,
                           List<String> warnings, String errorMessage, Instant startedAt, Instant finishedAt) {}

    public record Node(String routeKey, String title, String sourceFile, String origin, boolean stale,
                       int elementCount, boolean excluded, String note) {}

    public record SiteMap(String projectId, Source source, Analysis analysis, List<Node> nodes) {}

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
            nodes.add(new Node(node.getRouteKey(), node.getTitle(), node.getSourceFile(), node.getOrigin(),
                    node.isStale(), readList(node.getElements()).size(),
                    edit != null && edit.isExcluded(), edit != null ? edit.getNote() : null));
        }
        Analysis analysis = runRepository.findFirstByProjectIdOrderByIdDesc(projectId)
                .map(run -> new Analysis(run.getStatus(), run.getCommitSha(), run.getFramework(), run.isPartial(),
                        run.getScreenCount(), readStrings(run.getWarnings()), run.getErrorMessage(),
                        run.getStartedAt(), run.getFinishedAt()))
                .orElse(new Analysis("NONE", null, null, false, 0, List.of(), null, null, null));
        return new SiteMap(projectId, sourceOf(project), analysis, nodes);
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
            mergeNodes(run.getProjectId(), found.screens(), commit);
            run.setScreenCount(found.screens().size());
            run.setStatus(SiteAnalysisRun.COMPLETED);
            run.setFinishedAt(Instant.now());
            runRepository.save(run);
        } catch (Exception e) {
            log.warn("구조 분석 실패 (project={}): {}", run.getProjectId(), e.getMessage());
            fail(run, e.getMessage());
        }
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
    void mergeNodes(String projectId, List<ScreenFinder.Screen> screens, String commit) {
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

    private List<Object> readList(String json) {
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
