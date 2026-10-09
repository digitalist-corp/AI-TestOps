package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "projects")
public class Project {

    @Id
    @Column(name = "project_id", length = 100)
    private String projectId;

    @Column(name = "project_name", nullable = false, length = 200)
    private String projectName;

    @Column(name = "display_order")
    private Integer displayOrder = 0;

    @Enumerated(EnumType.STRING)
    @Column(name = "server_type", length = 20)
    private ProjectServerType serverType = ProjectServerType.DEV;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "test_purpose", columnDefinition = "TEXT")
    private String testPurpose;

    @Column(name = "manager_name", length = 100)
    private String managerName;

    @Column(name = "manager_contact", length = 200)
    private String managerContact;

    @Column(name = "node_version", length = 20)
    private String nodeVersion = "22";

    @Column(name = "playwright_version", length = 20)
    private String playwrightVersion = "1.53.0";

    @Enumerated(EnumType.STRING)
    @Column(name = "package_manager", length = 10)
    private PackageManager packageManager = PackageManager.NPM;

    @Column(name = "install_command", length = 500)
    private String installCommand = "npm install";

    @Column(name = "test_command", length = 500)
    private String testCommand = "npx playwright test --project=chromium";

    @Column(name = "working_directory", length = 500)
    private String workingDirectory = ".";

    @Column(name = "env_variables", columnDefinition = "TEXT")
    private String envVariables = "{}";

    @Column(name = "login_env_required")
    private Boolean loginEnvRequired = false;

    /** 로그인/설정 선행 시나리오로 지정한 spec 경로. null이면 기능 자체가 꺼진 상태 — 기존 실행 흐름은 그대로다. */
    @Column(name = "login_setup_spec_path", length = 500)
    private String loginSetupSpecPath;

    /** storageState(로그인 세션) 캐시를 재사용할 최대 시간(분). 이 시간이 지나면 다음 실행 때 선행 시나리오를 다시 돌린다. */
    @Column(name = "storage_state_max_age_minutes")
    private Integer storageStateMaxAgeMinutes = 720;

    @Column(name = "timeout")
    private Integer timeout = 300;

    @Column(name = "parallel_limit")
    private Integer parallelLimit = 1;

    @Column(name = "base_url", length = 500)
    private String baseUrl;

    @Column(name = "repository_url", length = 500)
    private String repositoryUrl;

    @Column(name = "repository_branch", length = 100)
    private String repositoryBranch;

    @Column(name = "repository_token_encrypted", columnDefinition = "TEXT")
    private String repositoryTokenEncrypted;

    /** 구조 분석이 읽을 앱 소스 저장소. 위의 repository* 는 Playwright 테스트 코드 저장소다. */
    @Column(name = "source_repository_url", length = 500)
    private String sourceRepositoryUrl;

    @Column(name = "source_repository_branch", length = 100)
    private String sourceRepositoryBranch;

    @Column(name = "source_repository_token_encrypted", columnDefinition = "TEXT")
    private String sourceRepositoryTokenEncrypted;

    @Enumerated(EnumType.STRING)
    @Column(name = "runner_lifecycle", length = 20)
    private RunnerLifecycle runnerLifecycle = RunnerLifecycle.PERSISTENT;

    @Column(name = "docker_enabled")
    private Boolean dockerEnabled = false;

    @Column(name = "docker_container_id", length = 100)
    private String dockerContainerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "docker_status", length = 20)
    private DockerStatus dockerStatus = DockerStatus.NOT_CONFIGURED;

    @Enumerated(EnumType.STRING)
    @Column(name = "ai_model_provider", length = 20)
    private AiModelProvider aiModelProvider = AiModelProvider.CLAUDE;

    @Column(name = "ai_auto_apply_enabled")
    private Boolean aiAutoApplyEnabled = false;

    @Column(name = "ai_auto_apply_max_changed_lines")
    private Integer aiAutoApplyMaxChangedLines = 30;

    @Column(name = "ai_auto_apply_max_changed_files")
    private Integer aiAutoApplyMaxChangedFiles = 2;

    @Column(name = "ai_allowed_path_globs", columnDefinition = "TEXT")
    private String aiAllowedPathGlobs = "[\"tests/**\"]";

    @Column(name = "ai_denied_path_globs", columnDefinition = "TEXT")
    private String aiDeniedPathGlobs = "[\"package.json\",\"playwright.config.ts\",\".env*\"]";

    /** 하네스 상한선 — 프로젝트가 위험을 얼마나 감수할지에 관한 값이라 프로젝트별로 조절 가능하다.
     *  (컨테이너 격리/자격증명 미노출/네트워크 제한 같은 보안 하한선은 이 값과 달리 프로젝트별로 바뀌지 않는다.) */
    @Column(name = "ai_max_iterations")
    private Integer aiMaxIterations = 5;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getProjectName() { return projectName; }
    public void setProjectName(String projectName) { this.projectName = projectName; }

    public Integer getDisplayOrder() { return displayOrder; }
    public void setDisplayOrder(Integer displayOrder) { this.displayOrder = displayOrder; }

    public ProjectServerType getServerType() { return serverType; }
    public void setServerType(ProjectServerType serverType) { this.serverType = serverType; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getTestPurpose() { return testPurpose; }
    public void setTestPurpose(String testPurpose) { this.testPurpose = testPurpose; }

    public String getManagerName() { return managerName; }
    public void setManagerName(String managerName) { this.managerName = managerName; }

    public String getManagerContact() { return managerContact; }
    public void setManagerContact(String managerContact) { this.managerContact = managerContact; }

    public String getNodeVersion() { return nodeVersion; }
    public void setNodeVersion(String nodeVersion) { this.nodeVersion = nodeVersion; }

    public String getPlaywrightVersion() { return playwrightVersion; }
    public void setPlaywrightVersion(String playwrightVersion) { this.playwrightVersion = playwrightVersion; }

    public PackageManager getPackageManager() { return packageManager; }
    public void setPackageManager(PackageManager packageManager) { this.packageManager = packageManager; }

    public String getInstallCommand() { return installCommand; }
    public void setInstallCommand(String installCommand) { this.installCommand = installCommand; }

    public String getLoginSetupSpecPath() { return loginSetupSpecPath; }
    public void setLoginSetupSpecPath(String loginSetupSpecPath) { this.loginSetupSpecPath = loginSetupSpecPath; }

    public Integer getStorageStateMaxAgeMinutes() { return storageStateMaxAgeMinutes; }
    public void setStorageStateMaxAgeMinutes(Integer storageStateMaxAgeMinutes) { this.storageStateMaxAgeMinutes = storageStateMaxAgeMinutes; }

    public String getTestCommand() { return testCommand; }
    public void setTestCommand(String testCommand) { this.testCommand = testCommand; }

    public String getWorkingDirectory() { return workingDirectory; }
    public void setWorkingDirectory(String workingDirectory) { this.workingDirectory = workingDirectory; }

    public String getEnvVariables() { return envVariables; }
    public void setEnvVariables(String envVariables) { this.envVariables = envVariables; }

    public Boolean getLoginEnvRequired() { return Boolean.TRUE.equals(loginEnvRequired); }
    public void setLoginEnvRequired(Boolean loginEnvRequired) { this.loginEnvRequired = Boolean.TRUE.equals(loginEnvRequired); }

    public Integer getTimeout() { return timeout; }
    public void setTimeout(Integer timeout) { this.timeout = timeout; }

    public Integer getParallelLimit() { return parallelLimit; }
    public void setParallelLimit(Integer parallelLimit) { this.parallelLimit = parallelLimit; }

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }

    public String getRepositoryUrl() { return repositoryUrl; }
    public void setRepositoryUrl(String repositoryUrl) { this.repositoryUrl = repositoryUrl; }

    public String getRepositoryBranch() { return repositoryBranch; }
    public void setRepositoryBranch(String repositoryBranch) { this.repositoryBranch = repositoryBranch; }

    public String getRepositoryTokenEncrypted() { return repositoryTokenEncrypted; }
    public void setRepositoryTokenEncrypted(String repositoryTokenEncrypted) { this.repositoryTokenEncrypted = repositoryTokenEncrypted; }

    public String getSourceRepositoryUrl() { return sourceRepositoryUrl; }
    public void setSourceRepositoryUrl(String sourceRepositoryUrl) { this.sourceRepositoryUrl = sourceRepositoryUrl; }
    public String getSourceRepositoryBranch() { return sourceRepositoryBranch; }
    public void setSourceRepositoryBranch(String sourceRepositoryBranch) { this.sourceRepositoryBranch = sourceRepositoryBranch; }
    public String getSourceRepositoryTokenEncrypted() { return sourceRepositoryTokenEncrypted; }
    public void setSourceRepositoryTokenEncrypted(String value) { this.sourceRepositoryTokenEncrypted = value; }
    public boolean isRepositoryConnected() { return repositoryUrl != null && !repositoryUrl.isBlank(); }

    public RunnerLifecycle getRunnerLifecycle() {
        return runnerLifecycle != null ? runnerLifecycle : RunnerLifecycle.PERSISTENT;
    }
    public void setRunnerLifecycle(RunnerLifecycle runnerLifecycle) {
        this.runnerLifecycle = runnerLifecycle != null ? runnerLifecycle : RunnerLifecycle.PERSISTENT;
    }

    public Boolean getDockerEnabled() { return dockerEnabled; }
    public void setDockerEnabled(Boolean dockerEnabled) { this.dockerEnabled = dockerEnabled; }

    public String getDockerContainerId() { return dockerContainerId; }
    public void setDockerContainerId(String dockerContainerId) { this.dockerContainerId = dockerContainerId; }

    public DockerStatus getDockerStatus() { return dockerStatus; }
    public void setDockerStatus(DockerStatus dockerStatus) { this.dockerStatus = dockerStatus; }

    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public AiModelProvider getAiModelProvider() {
        return aiModelProvider != null ? aiModelProvider : AiModelProvider.CLAUDE;
    }
    public void setAiModelProvider(AiModelProvider aiModelProvider) {
        this.aiModelProvider = aiModelProvider != null ? aiModelProvider : AiModelProvider.CLAUDE;
    }

    public Boolean getAiAutoApplyEnabled() { return Boolean.TRUE.equals(aiAutoApplyEnabled); }
    public void setAiAutoApplyEnabled(Boolean aiAutoApplyEnabled) { this.aiAutoApplyEnabled = Boolean.TRUE.equals(aiAutoApplyEnabled); }

    public Integer getAiAutoApplyMaxChangedLines() { return aiAutoApplyMaxChangedLines; }
    public void setAiAutoApplyMaxChangedLines(Integer aiAutoApplyMaxChangedLines) { this.aiAutoApplyMaxChangedLines = aiAutoApplyMaxChangedLines; }

    public Integer getAiAutoApplyMaxChangedFiles() { return aiAutoApplyMaxChangedFiles; }
    public void setAiAutoApplyMaxChangedFiles(Integer aiAutoApplyMaxChangedFiles) { this.aiAutoApplyMaxChangedFiles = aiAutoApplyMaxChangedFiles; }

    public String getAiAllowedPathGlobs() { return aiAllowedPathGlobs; }
    public void setAiAllowedPathGlobs(String aiAllowedPathGlobs) { this.aiAllowedPathGlobs = aiAllowedPathGlobs; }

    public String getAiDeniedPathGlobs() { return aiDeniedPathGlobs; }
    public void setAiDeniedPathGlobs(String aiDeniedPathGlobs) { this.aiDeniedPathGlobs = aiDeniedPathGlobs; }

    public Integer getAiMaxIterations() { return aiMaxIterations != null ? aiMaxIterations : 5; }
    public void setAiMaxIterations(Integer aiMaxIterations) { this.aiMaxIterations = aiMaxIterations; }
}
