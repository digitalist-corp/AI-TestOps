package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.dto.RunnerCleanupRequest;
import com.playops.api.dto.RunnerCleanupResponse;
import com.playops.api.dto.RunnerContainerResponse;
import com.playops.api.dto.ProjectRequest;
import com.playops.api.dto.ProjectResponse;
import com.playops.api.entity.DockerStatus;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.PackageManager;
import com.playops.api.entity.Project;
import com.playops.api.entity.RunnerActivity;
import com.playops.api.entity.RunnerLifecycle;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.util.ProjectEnvVariables;
import com.playops.api.util.RuntimeVersions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ProjectService {

    private static final Logger log = LoggerFactory.getLogger(ProjectService.class);

    private final ProjectRepository projectRepository;
    private final ExecutionRepository executionRepository;
    private final PlayOpsProperties properties;
    private final DockerRunnerService dockerRunnerService;
    private final PlaywrightTemplateService templateService;
    private final GitRepositoryService gitRepositoryService;
    private final SecretCipherService secretCipherService;

    public ProjectService(
            ProjectRepository projectRepository,
            ExecutionRepository executionRepository,
            PlayOpsProperties properties,
            DockerRunnerService dockerRunnerService,
            PlaywrightTemplateService templateService,
            GitRepositoryService gitRepositoryService,
            SecretCipherService secretCipherService
    ) {
        this.projectRepository = projectRepository;
        this.executionRepository = executionRepository;
        this.properties = properties;
        this.dockerRunnerService = dockerRunnerService;
        this.templateService = templateService;
        this.gitRepositoryService = gitRepositoryService;
        this.secretCipherService = secretCipherService;
    }

    public List<ProjectResponse> findAll() {
        return findAll(null);
    }

    public List<ProjectResponse> findAll(User currentUser) {
        return projectRepository.findAll().stream()
                .filter(p -> canAccess(p, currentUser))
                .sorted((a, b) -> {
                    int orderA = a.getDisplayOrder() != null ? a.getDisplayOrder() : 0;
                    int orderB = b.getDisplayOrder() != null ? b.getDisplayOrder() : 0;
                    if (orderA != orderB) {
                        return Integer.compare(orderA, orderB);
                    }
                    return a.getProjectName().compareToIgnoreCase(b.getProjectName());
                })
                .map(this::toResponse)
                .toList();
    }

    public ProjectResponse findById(String projectId) {
        return findById(projectId, null);
    }

    public ProjectResponse findById(String projectId, User currentUser) {
        Project project = getProjectForUser(projectId, currentUser);
        return toResponse(project);
    }

    public boolean canAccess(Project project, User user) {
        if (user == null || user.getRole() == UserRole.ADMIN) {
            return true;
        }
        return project.getOwnerUserId() == null || project.getOwnerUserId().equals(user.getId());
    }

    public Project getProjectForUser(String projectId, User user) {
        Project project = getProject(projectId);
        if (!canAccess(project, user)) {
            throw new ApiException(403, "FORBIDDEN", "해당 프로젝트에 접근할 권한이 없습니다.");
        }
        return project;
    }

    @Transactional
    public ProjectResponse create(ProjectRequest request) {
        return create(request, null);
    }

    @Transactional
    public ProjectResponse create(ProjectRequest request, User currentUser) {
        validateProjectId(request.projectId());
        if (projectRepository.existsByProjectId(request.projectId())) {
            throw new ApiException(409, "PROJECT_ID_EXISTS", "Project already exists: " + request.projectId());
        }

        Project project = new Project();
        project.setProjectId(request.projectId());
        if (currentUser != null) {
            project.setOwnerUserId(currentUser.getId());
        }
        applyRequest(project, request);
        applyRepositoryFields(project, request);

        try {
            Files.createDirectories(getProjectPath(project.getProjectId()));
        } catch (IOException e) {
            throw new ApiException(500, "Failed to create project directory: " + e.getMessage());
        }

        boolean hasRepository = project.isRepositoryConnected();
        boolean scaffold = !hasRepository
                && (request.scaffoldOnCreate() == null || request.scaffoldOnCreate());
        if (scaffold) {
            String templateId = templateService.resolveTemplateId(request.templateId());
            templateService.scaffold(
                    getProjectPath(project.getProjectId()),
                    project,
                    templateId,
                    false
            );
        }

        Project saved = projectRepository.save(project);

        if (hasRepository) {
            cloneRepositorySafely(saved, request.templateId());
        }

        if (Boolean.TRUE.equals(saved.getDockerEnabled())
                && saved.getRunnerLifecycle() == RunnerLifecycle.PERSISTENT) {
            try {
                dockerRunnerService.startRunner(saved);
            } catch (Exception e) {
                log.warn("Docker Runner start skipped or failed (Docker Desktop not running or local mode): {}", e.getMessage());
            }
            saved = projectRepository.save(saved);
        }

        return toResponse(saved);
    }

    private void cloneRepositorySafely(Project project, String requestedTemplateId) {
        try {
            String token = secretCipherService.decrypt(project.getRepositoryTokenEncrypted());
            gitRepositoryService.cloneRepository(project, token);

            // clone된 레포에 Playwright 설정이 이미 있으면 아무 것도 안 하고, 없으면(순수 앱 소스 레포)
            // 템플릿의 Playwright 관련 파일만 병합한다 — 기존 앱 소스는 건드리지 않는다.
            String templateId = templateService.resolveTemplateId(requestedTemplateId);
            boolean merged = templateService.ensurePlaywrightScaffold(
                    getProjectPath(project.getProjectId()), project, templateId);
            if (merged) {
                dockerRunnerService.logOperation(project.getProjectId(),
                        "[playops] 클론된 레포에 Playwright 설정이 없어 기본 템플릿(" + templateId + ")을 병합했습니다.");
            }
        } catch (Exception e) {
            log.warn("GitHub repository clone skipped or failed for project {}: {}", project.getProjectId(), e.getMessage());
        }
    }

    @Transactional
    public ProjectResponse update(String projectId, ProjectRequest request) {
        return update(projectId, request, null);
    }

    @Transactional
    public ProjectResponse update(String projectId, ProjectRequest request, User currentUser) {
        Project project = getProjectForUser(projectId, currentUser);
        if (request.version() != null && !request.version().equals(project.getVersion())) {
            throw new ApiException(409, "VERSION_CONFLICT", "프로젝트 설정이 다른 요청에 의해 먼저 변경되었습니다.");
        }
        boolean wasDockerEnabled = Boolean.TRUE.equals(project.getDockerEnabled());
        RunnerLifecycle previousLifecycle = project.getRunnerLifecycle();
        DockerStatus previousDockerStatus = dockerRunnerService.getStatus(project);
        String previousNodeVersion = project.getNodeVersion();
        String previousPlaywrightVersion = project.getPlaywrightVersion();
        applyRequest(project, request);
        boolean recloneRepository = applyRepositoryFields(project, request);

        boolean runtimeChanged = !sameText(previousNodeVersion, project.getNodeVersion())
                || !sameText(previousPlaywrightVersion, project.getPlaywrightVersion());

        if (runtimeChanged) {
            resetInstalledModules(project.getProjectId());
        }

        if (!Boolean.TRUE.equals(project.getDockerEnabled()) && wasDockerEnabled) {
            dockerRunnerService.removeRunner(project);
        } else if (Boolean.TRUE.equals(project.getDockerEnabled())
                && previousLifecycle == RunnerLifecycle.PERSISTENT
                && project.getRunnerLifecycle() == RunnerLifecycle.EPHEMERAL) {
            dockerRunnerService.removeRunner(project);
        } else if (Boolean.TRUE.equals(project.getDockerEnabled())
                && project.getRunnerLifecycle() == RunnerLifecycle.PERSISTENT
                && previousDockerStatus == DockerStatus.RUNNING
                && runtimeChanged) {
            dockerRunnerService.removeRunner(project);
        }

        Project saved = projectRepository.save(project);
        if (recloneRepository) {
            cloneRepositorySafely(saved, request.templateId());
        }
        return toResponse(saved);
    }

    @Transactional
    public void delete(String projectId) {
        delete(projectId, null);
    }

    @Transactional
    public void delete(String projectId, User currentUser) {
        Project project = getProjectForUser(projectId, currentUser);
        boolean activeExec = executionRepository.existsByProjectIdAndStatusIn(
                projectId,
                List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED)
        );
        if (activeExec) {
            throw new ApiException(409, "ACTIVE_JOB_EXISTS", "실행 중인 테스트가 있어 프로젝트를 삭제할 수 없습니다.");
        }
        dockerRunnerService.removeRunner(project);
        projectRepository.delete(project);

        try {
            Path path = getProjectPath(projectId);
            if (Files.exists(path)) {
                deleteRecursively(path);
            }
        } catch (IOException e) {
            throw new ApiException(500, "Failed to delete project files: " + e.getMessage());
        }
    }

    @Transactional
    public ProjectResponse startDocker(String projectId) {
        Project project = getProject(projectId);
        project.setDockerEnabled(true);
        dockerRunnerService.startRunner(project);
        return toResponse(projectRepository.save(project));
    }

    @Transactional
    public ProjectResponse stopDocker(String projectId) {
        Project project = getProject(projectId);
        dockerRunnerService.stopRunner(project);
        return toResponse(projectRepository.save(project));
    }

    public DockerStatus getDockerStatus(String projectId) {
        Project project = getProject(projectId);
        return dockerRunnerService.getStatus(project);
    }

    @Transactional
    public List<RunnerContainerResponse> reconcileDockerRunners() {
        List<DockerRunnerService.RunnerContainer> containers = dockerRunnerService.listRunnerContainers();
        Map<String, DockerRunnerService.RunnerContainer> containersByProject = containers.stream()
                .filter(container -> container.projectId() != null && !container.projectId().isBlank())
                .collect(Collectors.toMap(
                        DockerRunnerService.RunnerContainer::projectId,
                        Function.identity(),
                        (first, ignored) -> first
                ));

        List<Project> projects = projectRepository.findAll();
        for (Project project : projects) {
            DockerRunnerService.RunnerContainer container = containersByProject.get(project.getProjectId());
            if (container == null) {
                project.setDockerContainerId(null);
                if (Boolean.TRUE.equals(project.getDockerEnabled())) {
                    project.setDockerStatus(DockerStatus.STOPPED);
                }
                continue;
            }

            if (container.dockerStatus() == DockerStatus.RUNNING) {
                project.setDockerEnabled(true);
            }
            project.setDockerContainerId(shortContainerId(container.containerId()));
            project.setDockerStatus(container.dockerStatus());
        }
        projectRepository.saveAll(projects);
        return listRunnerContainers();
    }

    public List<RunnerContainerResponse> listRunnerContainers() {
        Map<String, Project> projectsById = projectRepository.findAll().stream()
                .collect(Collectors.toMap(Project::getProjectId, Function.identity()));
        return dockerRunnerService.listRunnerContainers().stream()
                .map(container -> toRunnerContainerResponse(container, projectsById.get(container.projectId())))
                .toList();
    }

    public List<RunnerContainerResponse> listDockerContainers() {
        Map<String, Project> projectsById = projectRepository.findAll().stream()
                .collect(Collectors.toMap(Project::getProjectId, Function.identity()));
        return dockerRunnerService.listDockerContainers().stream()
                .map(container -> toRunnerContainerResponse(container, projectsById.get(container.projectId())))
                .toList();
    }

    @Transactional
    public RunnerCleanupResponse cleanupRunnerContainers(RunnerCleanupRequest request) {
        List<DockerRunnerService.RunnerContainer> current = dockerRunnerService.listDockerContainers();
        Set<String> requestedNames = request != null && request.containerNames() != null
                ? new HashSet<>(request.containerNames())
                : Set.of();
        boolean onlyUnused = request == null || !Boolean.FALSE.equals(request.onlyUnused());

        List<String> removed = new ArrayList<>();
        List<String> skipped = new ArrayList<>();

        Map<String, Project> projectsById = projectRepository.findAll().stream()
                .collect(Collectors.toMap(Project::getProjectId, Function.identity()));

        for (DockerRunnerService.RunnerContainer runner : current) {
            Project project = runner.projectId() != null && !runner.projectId().isBlank()
                    ? projectsById.get(runner.projectId())
                    : null;
            boolean selected = !requestedNames.isEmpty() && requestedNames.contains(runner.name());
            boolean active = project != null && executionRepository.existsByProjectIdAndStatusIn(
                    project.getProjectId(),
                    List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED)
            );
            boolean runnerContainer = runner.name().startsWith("playops-runner-");
            boolean buildIntermediate = isBuildIntermediateContainer(runner);
            boolean unusedRunner = runnerContainer
                    && (project == null || !Boolean.TRUE.equals(project.getDockerEnabled()));
            boolean unused = unusedRunner || buildIntermediate;

            if (requestedNames.isEmpty() && onlyUnused && !unused) {
                continue;
            }
            if (!requestedNames.isEmpty() && (!selected || (!runnerContainer && !buildIntermediate))) {
                continue;
            }
            if (active || runner.dockerStatus() == DockerStatus.RUNNING) {
                skipped.add(runner.name() + " (active execution)");
                continue;
            }

            dockerRunnerService.removeDockerContainer(runner.name());
            removed.add(runner.name());

            if (project != null) {
                Project cleanupProject = project;
                cleanupProject.setDockerContainerId(null);
                cleanupProject.setDockerStatus(Boolean.TRUE.equals(cleanupProject.getDockerEnabled())
                            ? DockerStatus.STOPPED
                            : DockerStatus.NOT_CONFIGURED);
                projectRepository.save(cleanupProject);
            }
        }

        return new RunnerCleanupResponse(removed, skipped);
    }

    public RunnerActivity getRunnerActivity(Project project, DockerStatus dockerStatus) {
        if (dockerStatus != DockerStatus.RUNNING) {
            return RunnerActivity.UNAVAILABLE;
        }
        boolean busy = executionRepository.existsByProjectIdAndStatusIn(
                project.getProjectId(),
                List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED)
        );
        return busy ? RunnerActivity.TESTING : RunnerActivity.IDLE;
    }

    public void ensureDockerRunnerRunning(Project project) {
        DockerStatus status = dockerRunnerService.getStatus(project);
        if (status != DockerStatus.RUNNING) {
            // 일회용 러너는 사용자가 미리 컨테이너를 만들지 않는다.
            // 테스트 실행 요청이 들어온 순간 생성하고, 실행 종료 후 cleanupEphemeralRunner에서 삭제한다.
            if (Boolean.TRUE.equals(project.getDockerEnabled())
                    && project.getRunnerLifecycle() == RunnerLifecycle.EPHEMERAL) {
                dockerRunnerService.startRunner(project);
                projectRepository.save(project);
                return;
            }
            throw new ApiException(
                    409,
                    "상주 Docker Runner가 중지되어 있습니다. 러너를 시작한 뒤 다시 실행하세요."
            );
        }
    }

    @Transactional
    public void cleanupEphemeralRunner(Project project) {
        if (project.getRunnerLifecycle() != RunnerLifecycle.EPHEMERAL) {
            return;
        }
        boolean active = executionRepository.existsByProjectIdAndStatusIn(
                project.getProjectId(),
                List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED)
        );
        if (active) {
            return;
        }
        dockerRunnerService.stopRunner(project);
        projectRepository.save(project);
    }

    public Project getProject(String projectId) {
        return projectRepository.findById(projectId)
                .orElseThrow(() -> new ApiException(404, "Project not found: " + projectId));
    }

    public Path getProjectPath(String projectId) {
        return Path.of(properties.projectsRoot(), projectId);
    }

    private ProjectResponse toResponse(Project project) {
        DockerStatus dockerStatus = dockerRunnerService.getStatus(project);
        return ProjectResponse.from(
                project,
                dockerStatus,
                getRunnerActivity(project, dockerStatus),
                executionRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getProjectId()).orElse(null)
        );
    }

    private RunnerContainerResponse toRunnerContainerResponse(
            DockerRunnerService.RunnerContainer container,
            Project project
    ) {
        boolean known = project != null;
        boolean active = known && executionRepository.existsByProjectIdAndStatusIn(
                project.getProjectId(),
                List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED)
        );
        boolean dockerEnabled = known && Boolean.TRUE.equals(project.getDockerEnabled());
        boolean reconnectable = known
                && container.dockerStatus() == DockerStatus.RUNNING
                && (!dockerEnabled || project.getDockerContainerId() == null
                || !shortContainerId(container.containerId()).equals(project.getDockerContainerId()));

        return new RunnerContainerResponse(
                container.name(),
                shortContainerId(container.containerId()),
                container.image(),
                container.dockerStatus(),
                containerType(container),
                container.projectId(),
                known,
                dockerEnabled,
                known ? project.getServerType() : null,
                active,
                reconnectable,
                (container.name().startsWith("playops-runner-") || isBuildIntermediateContainer(container))
                        && !active
                        && container.dockerStatus() != DockerStatus.RUNNING,
                container.cpuPercent(),
                container.memoryUsage(),
                container.memoryPercent(),
                container.netIo(),
                container.blockIo(),
                container.createdAt(),
                "",
                container.uptime()
        );
    }

    private String containerType(DockerRunnerService.RunnerContainer container) {
        String name = container.name();
        if (name == null) {
            return "OTHER";
        }
        if (name.startsWith("playops-runner-")) {
            return "RUNNER";
        }
        if (isBuildIntermediateContainer(container)) {
            return "BUILD";
        }
        if (name.contains("postgres") || name.contains("db")) {
            return "DB";
        }
        if (name.startsWith("playops-")) {
            return "PLAYOPS";
        }
        return "OTHER";
    }

    private boolean isBuildIntermediateContainer(DockerRunnerService.RunnerContainer container) {
        String image = container.image() != null ? container.image() : "";
        String name = container.name() != null ? container.name() : "";
        return container.dockerStatus() == DockerStatus.STOPPED
                && container.projectId().isBlank()
                && (image.startsWith("sha256:")
                || image.equals("<none>")
                || name.startsWith("sha256:"));
    }

    private String shortContainerId(String containerId) {
        if (containerId == null) {
            return null;
        }
        return containerId.substring(0, Math.min(12, containerId.length()));
    }

    private void applyRequest(Project project, ProjectRequest request) {
        validateExecutionEnvironment(request);
        if (request.projectName() != null) {
            project.setProjectName(request.projectName());
        }
        if (request.displayOrder() != null) {
            project.setDisplayOrder(request.displayOrder());
        }
        if (request.serverType() != null) {
            project.setServerType(request.serverType());
        }
        if (request.description() != null) {
            project.setDescription(request.description());
        }
        if (request.testPurpose() != null) {
            project.setTestPurpose(request.testPurpose());
        }
        if (request.managerName() != null) {
            project.setManagerName(request.managerName());
        }
        if (request.managerContact() != null) {
            project.setManagerContact(request.managerContact());
        }
        if (request.nodeVersion() != null) {
            project.setNodeVersion(RuntimeVersions.NODE_VERSION);
        }
        if (request.playwrightVersion() != null) {
            project.setPlaywrightVersion(RuntimeVersions.PLAYWRIGHT_VERSION);
        }
        if (request.packageManager() != null) {
            project.setPackageManager(request.packageManager());
            if (request.installCommand() == null) {
                project.setInstallCommand(defaultInstallCommand(request.packageManager()));
            }
        }
        if (request.installCommand() != null) {
            project.setInstallCommand(request.installCommand().trim());
        }
        if (request.testCommand() != null) {
            project.setTestCommand(request.testCommand().trim());
        }
        if (request.workingDirectory() != null) {
            project.setWorkingDirectory(request.workingDirectory().trim());
        }
        if (request.envVariables() != null) {
            ProjectEnvVariables.validate(request.envVariables());
            project.setEnvVariables(request.envVariables());
        }
        if (request.loginEnvRequired() != null) {
            project.setLoginEnvRequired(request.loginEnvRequired());
        }
        if (request.loginSetupSpecPath() != null) {
            String trimmed = request.loginSetupSpecPath().trim();
            project.setLoginSetupSpecPath(trimmed.isBlank() ? null : trimmed);
        }
        if (request.storageStateMaxAgeMinutes() != null) {
            project.setStorageStateMaxAgeMinutes(request.storageStateMaxAgeMinutes());
        }
        if (request.timeout() != null) {
            project.setTimeout(request.timeout());
        }
        if (request.parallelLimit() != null) {
            project.setParallelLimit(request.parallelLimit());
        }
        if (request.baseUrl() != null) {
            project.setBaseUrl(request.baseUrl().trim());
        }
        if (request.runnerLifecycle() != null) {
            project.setRunnerLifecycle(request.runnerLifecycle());
        }
        if (request.dockerEnabled() != null) {
            project.setDockerEnabled(request.dockerEnabled());
            if (!request.dockerEnabled()) {
                project.setDockerStatus(DockerStatus.NOT_CONFIGURED);
            }
        }
    }

    /**
     * GitHub 연동 필드를 적용한다. repositoryToken은 write-only이며 즉시 암호화해 저장하고,
     * 평문은 리턴하지 않는다 (재 clone이 필요하면 caller가 saved 엔티티에서 다시 복호화해서 사용).
     * @return true면 caller가 이 저장 이후 저장소를 다시 clone해야 함을 의미한다.
     */
    private boolean applyRepositoryFields(Project project, ProjectRequest request) {
        boolean reclone = false;

        if (request.repositoryUrl() != null) {
            String trimmed = request.repositoryUrl().trim();
            if (trimmed.isBlank()) {
                project.setRepositoryUrl(null);
                project.setRepositoryBranch(null);
                project.setRepositoryTokenEncrypted(null);
            } else {
                gitRepositoryService.validateAndNormalize(trimmed);
                boolean urlChanged = !trimmed.equals(project.getRepositoryUrl());
                project.setRepositoryUrl(trimmed);
                if (urlChanged) {
                    reclone = true;
                }
            }
        }

        if (request.repositoryBranch() != null) {
            String branch = gitRepositoryService.validateBranch(request.repositoryBranch());
            boolean branchChanged = !java.util.Objects.equals(branch, project.getRepositoryBranch());
            project.setRepositoryBranch(branch);
            if (branchChanged && project.isRepositoryConnected()) {
                reclone = true;
            }
        }

        if (request.repositoryToken() != null) {
            if (request.repositoryToken().isBlank()) {
                project.setRepositoryTokenEncrypted(null);
            } else {
                project.setRepositoryTokenEncrypted(secretCipherService.encrypt(request.repositoryToken()));
                if (project.isRepositoryConnected()) {
                    reclone = true;
                }
            }
        }

        return reclone && project.isRepositoryConnected();
    }

    private String defaultInstallCommand(PackageManager pm) {
        return switch (pm) {
            case NPM -> "npm install";
            case YARN -> "yarn install";
            case PNPM -> "pnpm install";
        };
    }

    private boolean sameText(String left, String right) {
        String l = left != null ? left.trim() : "";
        String r = right != null ? right.trim() : "";
        return l.equals(r);
    }

    private void resetInstalledModules(String projectId) {
        Path projectPath = getProjectPath(projectId).toAbsolutePath().normalize();
        Path projectsRoot = Path.of(properties.projectsRoot()).toAbsolutePath().normalize();
        Path nodeModules = projectPath.resolve("node_modules").normalize();

        if (!nodeModules.startsWith(projectsRoot)) {
            throw new ApiException(400, "프로젝트 의존성 경로가 안전한 저장소 범위를 벗어났습니다.");
        }
        if (!Files.exists(nodeModules)) {
            return;
        }

        try {
            deleteRecursively(nodeModules);
            log.info("Reset installed modules for project {} after runtime version change", projectId);
        } catch (IOException e) {
            throw new ApiException(500, "프로젝트 설치 모듈 초기화 실패: " + e.getMessage());
        }
    }

    private void validateExecutionEnvironment(ProjectRequest request) {
        if (request.nodeVersion() != null && !RuntimeVersions.isAllowedNodeVersion(request.nodeVersion())) {
            throw new ApiException(400, "Node version must be " + RuntimeVersions.NODE_VERSION);
        }
        if (request.playwrightVersion() != null && !RuntimeVersions.isAllowedPlaywrightVersion(request.playwrightVersion())) {
            throw new ApiException(400, "Playwright version must be " + RuntimeVersions.PLAYWRIGHT_VERSION);
        }
        if (request.installCommand() != null && request.installCommand().trim().isBlank()) {
            throw new ApiException(400, "Install command is required");
        }
        if (request.testCommand() != null && request.testCommand().trim().isBlank()) {
            throw new ApiException(400, "Test command is required");
        }
        if (request.workingDirectory() != null && request.workingDirectory().trim().isBlank()) {
            throw new ApiException(400, "Working directory is required");
        }
        if (request.timeout() != null && (request.timeout() < 1 || request.timeout() > 86400)) {
            throw new ApiException(400, "Timeout must be between 1 and 86400 seconds");
        }
        if (request.parallelLimit() != null && (request.parallelLimit() < 1 || request.parallelLimit() > 100)) {
            throw new ApiException(400, "Parallel limit must be between 1 and 100");
        }
        if (request.baseUrl() != null && !request.baseUrl().trim().isBlank()) {
            validateBaseUrl(request.baseUrl().trim());
        }
    }

    private void validateBaseUrl(String baseUrl) {
        try {
            URI uri = new URI(baseUrl);
            String scheme = uri.getScheme();
            if (scheme == null || uri.getHost() == null || (!scheme.equals("http") && !scheme.equals("https"))) {
                throw new ApiException(400, "Base URL must be an http or https URL");
            }
        } catch (URISyntaxException e) {
            throw new ApiException(400, "Base URL is invalid");
        }
    }

    private void validateProjectId(String projectId) {
        if (projectId == null || !projectId.matches("[a-z0-9][a-z0-9-]{1,98}[a-z0-9]")) {
            throw new ApiException(400, "Project ID must be 3-100 chars, lowercase alphanumeric and hyphens");
        }
    }

    private void deleteRecursively(Path path) throws IOException {
        if (Files.isDirectory(path)) {
            try (var entries = Files.list(path)) {
                for (Path entry : entries.toList()) {
                    deleteRecursively(entry);
                }
            }
        }
        Files.deleteIfExists(path);
    }
}
