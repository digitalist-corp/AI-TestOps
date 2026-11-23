package com.playops.api.dto;

import com.playops.api.entity.DockerStatus;
import com.playops.api.entity.ProjectStatus;

public record RunnerContainerResponse(
        String name,
        String containerId,
        String image,
        DockerStatus dockerStatus,
        String containerType,
        String projectId,
        String projectName,
        Boolean knownProject,
        Boolean dockerEnabled,
        ProjectStatus projectStatus,
        Boolean activeExecution,
        Boolean reconnectable,
        Boolean removable,
        String cpuPercent,
        String memoryUsage,
        String memoryPercent,
        String netIo,
        String blockIo,
        String createdAt,
        String startedAt,
        String uptime
) {}
