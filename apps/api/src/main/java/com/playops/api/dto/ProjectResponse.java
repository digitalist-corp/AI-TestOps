package com.playops.api.dto;

import com.playops.api.entity.DockerStatus;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.PackageManager;
import com.playops.api.entity.Project;
import com.playops.api.entity.ProjectServerType;
import com.playops.api.entity.RunnerActivity;
import com.playops.api.entity.RunnerLifecycle;

import java.math.BigDecimal;
import java.time.Instant;

public record ProjectResponse(
        String projectId,
        String projectName,
        Integer displayOrder,
        ProjectServerType serverType,
        String description,
        String testPurpose,
        String managerName,
        String managerContact,
        String nodeVersion,
        String playwrightVersion,
        PackageManager packageManager,
        String installCommand,
        String testCommand,
        String workingDirectory,
        String envVariables,
        Boolean loginEnvRequired,
        String loginSetupSpecPath,
        Integer storageStateMaxAgeMinutes,
        Integer timeout,
        Integer parallelLimit,
        String baseUrl,
        String repositoryUrl,
        String repositoryBranch,
        Boolean repositoryConnected,
        RunnerLifecycle runnerLifecycle,
        Boolean dockerEnabled,
        DockerStatus dockerStatus,
        RunnerActivity runnerActivity,
        String dockerContainerId,
        Long latestExecutionId,
        ExecutionStatus latestExecutionStatus,
        Instant latestExecutionAt,
        Long latestExecutionDurationMs,
        Long ownerUserId,
        BigDecimal monthlyAiBudgetUsd,
        Long version,
        Instant createdAt,
        Instant updatedAt
) {
    public static ProjectResponse from(Project project) {
        return from(project, project.getDockerStatus(), RunnerActivity.UNAVAILABLE, null);
    }

    public static ProjectResponse from(Project project, DockerStatus dockerStatus) {
        return from(project, dockerStatus, RunnerActivity.UNAVAILABLE, null);
    }

    public static ProjectResponse from(Project project, DockerStatus dockerStatus, RunnerActivity runnerActivity) {
        return from(project, dockerStatus, runnerActivity, null);
    }

    public static ProjectResponse from(
            Project project,
            DockerStatus dockerStatus,
            RunnerActivity runnerActivity,
            Execution latestExecution
    ) {
        Instant latestExecutionAt = null;
        if (latestExecution != null) {
            latestExecutionAt = latestExecution.getFinishedAt() != null
                    ? latestExecution.getFinishedAt()
                    : latestExecution.getStartedAt() != null
                    ? latestExecution.getStartedAt()
                    : latestExecution.getCreatedAt();
        }

        return new ProjectResponse(
                project.getProjectId(),
                project.getProjectName(),
                project.getDisplayOrder(),
                project.getServerType(),
                project.getDescription(),
                project.getTestPurpose(),
                project.getManagerName(),
                project.getManagerContact(),
                project.getNodeVersion(),
                project.getPlaywrightVersion(),
                project.getPackageManager(),
                project.getInstallCommand(),
                project.getTestCommand(),
                project.getWorkingDirectory(),
                project.getEnvVariables(),
                project.getLoginEnvRequired(),
                project.getLoginSetupSpecPath(),
                project.getStorageStateMaxAgeMinutes(),
                project.getTimeout(),
                project.getParallelLimit(),
                project.getBaseUrl(),
                project.getRepositoryUrl(),
                project.getRepositoryBranch(),
                project.isRepositoryConnected(),
                project.getRunnerLifecycle(),
                project.getDockerEnabled(),
                dockerStatus,
                runnerActivity,
                project.getDockerContainerId(),
                latestExecution != null ? latestExecution.getId() : null,
                latestExecution != null ? latestExecution.getStatus() : null,
                latestExecutionAt,
                latestExecution != null ? latestExecution.getDurationMs() : null,
                project.getOwnerUserId(),
                project.getMonthlyAiBudgetUsd(),
                project.getVersion(),
                project.getCreatedAt(),
                project.getUpdatedAt()
        );
    }
}
