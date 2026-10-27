package com.playops.api.controller;

import com.playops.api.dto.AuthStateStatusResponse;
import com.playops.api.dto.DockerHostResourceResponse;
import com.playops.api.dto.ProjectRequest;
import com.playops.api.dto.ProjectResponse;
import com.playops.api.dto.RunnerCapacityRequest;
import com.playops.api.dto.RunnerCapacityResponse;
import com.playops.api.dto.RunnerCleanupRequest;
import com.playops.api.dto.RunnerCleanupResponse;
import com.playops.api.dto.RunnerContainerResponse;
import com.playops.api.dto.ScaffoldRequest;
import com.playops.api.dto.ScaffoldResponse;
import com.playops.api.dto.SiteCheckResponse;
import com.playops.api.entity.DockerStatus;
import com.playops.api.service.DockerRunnerService;
import com.playops.api.service.LoginSessionService;
import com.playops.api.service.PlaywrightTemplateService;
import com.playops.api.service.ProjectService;
import com.playops.api.service.RunnerCapacityService;
import com.playops.api.service.SiteAnalysisService;
import com.playops.api.service.SiteCheckService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectService projectService;
    private final PlaywrightTemplateService templateService;
    private final RunnerCapacityService runnerCapacityService;
    private final DockerRunnerService dockerRunnerService;
    private final LoginSessionService loginSessionService;
    private final SiteCheckService siteCheckService;
    private final SiteAnalysisService siteAnalysisService;
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ProjectController.class);

    public ProjectController(
            ProjectService projectService,
            PlaywrightTemplateService templateService,
            RunnerCapacityService runnerCapacityService,
            DockerRunnerService dockerRunnerService,
            LoginSessionService loginSessionService,
            SiteCheckService siteCheckService,
            SiteAnalysisService siteAnalysisService
    ) {
        this.projectService = projectService;
        this.templateService = templateService;
        this.runnerCapacityService = runnerCapacityService;
        this.dockerRunnerService = dockerRunnerService;
        this.loginSessionService = loginSessionService;
        this.siteCheckService = siteCheckService;
        this.siteAnalysisService = siteAnalysisService;
    }

    @GetMapping
    public List<ProjectResponse> list() {
        return projectService.findAll();
    }

    /** 등록 화면에서 대상 사이트 주소가 실제로 열리는지 확인한다. */
    @GetMapping("/site-check")
    public SiteCheckResponse siteCheck(@RequestParam String url) {
        return siteCheckService.check(url);
    }

    @GetMapping("/{projectId}")
    public ProjectResponse get(@PathVariable String projectId) {
        return projectService.findById(projectId);
    }

    @PostMapping
    public ProjectResponse create(@RequestBody ProjectRequest request) {
        ProjectResponse created = projectService.create(request);
        startSiteAnalysisIfSourceGiven(created.projectId(), request);
        return created;
    }

    /**
     * 소스 저장소를 함께 넣었으면 등록 직후 구조 분석을 뒤에서 시작한다.
     * 분석은 몇 분 걸릴 수 있어 등록을 붙잡지 않고, 분석이 시작되지 못해도 등록은 성공으로 둔다.
     */
    private void startSiteAnalysisIfSourceGiven(String projectId, ProjectRequest request) {
        if (request.sourceRepositoryUrl() == null || request.sourceRepositoryUrl().isBlank()) {
            return;
        }
        try {
            siteAnalysisService.updateSource(projectId, new SiteAnalysisService.SourceRequest(
                    request.sourceRepositoryUrl(), request.sourceRepositoryBranch(), request.sourceRepositoryToken()));
            siteAnalysisService.runAsync(siteAnalysisService.start(projectId).getId());
        } catch (RuntimeException e) {
            log.warn("등록 직후 구조 분석을 시작하지 못했습니다 (project={}): {}", projectId, e.getMessage());
        }
    }

    @PutMapping("/{projectId}")
    public ProjectResponse update(@PathVariable String projectId, @RequestBody ProjectRequest request) {
        return projectService.update(projectId, request);
    }

    @DeleteMapping("/{projectId}")
    public void delete(@PathVariable String projectId) {
        projectService.delete(projectId);
        siteAnalysisService.forget(projectId);
    }

    @PostMapping("/{projectId}/docker/start")
    public ProjectResponse startDocker(@PathVariable String projectId) {
        return projectService.startDocker(projectId);
    }

    @PostMapping("/{projectId}/docker/stop")
    public ProjectResponse stopDocker(@PathVariable String projectId) {
        return projectService.stopDocker(projectId);
    }

    @GetMapping("/docker/runners")
    public List<RunnerContainerResponse> listRunnerContainers() {
        return projectService.listRunnerContainers();
    }

    @GetMapping("/docker/containers")
    public List<RunnerContainerResponse> listDockerContainers() {
        return projectService.listDockerContainers();
    }

    @GetMapping("/docker/runner-capacity")
    public RunnerCapacityResponse runnerCapacity() {
        return runnerCapacityService.getCapacity();
    }

    @PutMapping("/docker/runner-capacity")
    public RunnerCapacityResponse updateRunnerCapacity(@RequestBody RunnerCapacityRequest request) {
        return runnerCapacityService.updateCapacity(request);
    }

    @GetMapping("/docker/host-resources")
    public DockerHostResourceResponse dockerHostResources() {
        return dockerRunnerService.getHostResources();
    }

    @PostMapping("/docker/runners/reconcile")
    public List<RunnerContainerResponse> reconcileRunnerContainers() {
        return projectService.reconcileDockerRunners();
    }

    @DeleteMapping("/docker/runners")
    public RunnerCleanupResponse cleanupRunnerContainers(@RequestBody(required = false) RunnerCleanupRequest request) {
        return projectService.cleanupRunnerContainers(request);
    }

    @GetMapping("/{projectId}/docker/status")
    public Map<String, Object> dockerStatus(@PathVariable String projectId) {
        var project = projectService.getProject(projectId);
        DockerStatus status = projectService.getDockerStatus(projectId);
        return Map.of(
                "projectId", projectId,
                "dockerEnabled", project.getDockerEnabled(),
                "runnerLifecycle", project.getRunnerLifecycle(),
                "dockerStatus", status,
                "runnerActivity", projectService.getRunnerActivity(project, status),
                "containerId", project.getDockerContainerId() != null ? project.getDockerContainerId() : ""
        );
    }

    @GetMapping("/{projectId}/docker/logs")
    public DockerRunnerService.RunnerOperationLog dockerLogs(@PathVariable String projectId) {
        projectService.getProject(projectId);
        return dockerRunnerService.operationLog(projectId);
    }

    @GetMapping("/{projectId}/auth-state")
    public AuthStateStatusResponse authState(@PathVariable String projectId) {
        return loginSessionService.status(projectService.getProject(projectId));
    }

    @DeleteMapping("/{projectId}/auth-state")
    public void clearAuthState(@PathVariable String projectId) {
        projectService.getProject(projectId); // 존재 검증
        loginSessionService.clear(projectId);
    }

    @PostMapping("/{projectId}/scaffold")
    public ScaffoldResponse scaffold(
            @PathVariable String projectId,
            @RequestBody(required = false) ScaffoldRequest request
    ) {
        var project = projectService.getProject(projectId);
        String templateId = templateService.resolveTemplateId(
                request != null ? request.templateId() : null
        );
        boolean overwrite = request != null && Boolean.TRUE.equals(request.overwrite());
        return templateService.scaffold(
                projectService.getProjectPath(projectId),
                project,
                templateId,
                overwrite
        );
    }
}
