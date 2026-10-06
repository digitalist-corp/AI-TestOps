package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.dto.DockerHostResourceResponse;
import com.playops.api.entity.DockerStatus;
import com.playops.api.entity.Project;
import com.playops.api.entity.RunnerLifecycle;
import com.playops.api.exception.ApiException;
import com.playops.api.util.RuntimeVersions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Pattern;

@Service
public class DockerRunnerService {

    private static final Logger log = LoggerFactory.getLogger(DockerRunnerService.class);
    private static final Pattern ANSI_ESCAPE_PATTERN = Pattern.compile("\\u001B\\[[;\\d]*[ -/]*[@-~]");
    private static final int MAX_OPERATION_LOG_LINES = 500;

    private final PlayOpsProperties properties;
    private final CommandRunner commandRunner;
    private final Map<String, Deque<String>> operationLogs = new ConcurrentHashMap<>();

    @Autowired
    public DockerRunnerService(PlayOpsProperties properties) {
        this(properties, DockerRunnerService::runProcessCommand);
    }

    DockerRunnerService(PlayOpsProperties properties, CommandRunner commandRunner) {
        this.properties = properties;
        this.commandRunner = commandRunner;
    }

    public void startRunner(Project project) {
        resetOperationLog(project.getProjectId());
        appendOperationLog(project.getProjectId(), "[playops] Docker Runner 시작 요청");
        if (!properties.dockerEnabled()) {
            project.setDockerStatus(DockerStatus.NOT_CONFIGURED);
            appendOperationLog(project.getProjectId(), "[playops] Docker 사용이 비활성화되어 있습니다.");
            log.warn("Docker is disabled. Set PLAYOPS_DOCKER_ENABLED=true and mount docker socket.");
            return;
        }

        String containerName = containerName(project.getProjectId());
        String image = runnerImage(project.getNodeVersion(), project.getPlaywrightVersion());
        appendOperationLog(project.getProjectId(), "[playops] 러너 컨테이너 확인: " + containerName);
        ExistingContainer existing = inspectExistingContainer(containerName);
        if (project.getRunnerLifecycle() == RunnerLifecycle.PERSISTENT
                && existing != null
                && image.equals(existing.image())) {
            startExistingRunner(project, containerName, existing);
            return;
        }

        removeContainerIfExists(containerName);
        ensureRunnerImage(project.getProjectId(), image, project.getNodeVersion(), project.getPlaywrightVersion());
        String containerWorkDir = containerWorkDir(project.getProjectId());

        List<String> command = new ArrayList<>();
        command.add("docker");
        command.add("run");
        command.add("-d");
        command.add("--name");
        command.add(containerName);
        command.add("--restart");
        command.add("unless-stopped");
        command.addAll(projectVolumeArgs(project.getProjectId()));
        command.add("--user");
        command.add("0");
        command.add("-w");
        command.add(containerWorkDir);
        command.add("-e");
        command.add("NODE_VERSION=" + RuntimeVersions.NODE_VERSION);
        // 러너 컨테이너 기본 bridge 네트워크에서도 AI-TestOps 자기 자신(host의 web 컨테이너 포트)에
        // baseUrl로 접근할 수 있도록 host-gateway를 뚫어준다. dogfooding 프로젝트(playops-self)가
        // http://host.docker.internal:{WEB_PORT}를 baseUrl로 쓰기 위한 전제 조건.
        command.add("--add-host");
        command.add("host.docker.internal:host-gateway");
        command.add(image);
        command.add("tail");
        command.add("-f");
        command.add("/dev/null");

        try {
            log.info("러너 컨테이너 생성을 시작합니다. container={}, image={}", containerName, image);
            appendOperationLog(project.getProjectId(), "[playops] 컨테이너 생성 시작: " + containerName);
            String containerId = parseContainerId(runCommand(project.getProjectId(), command, 60));
            project.setDockerContainerId(shortContainerId(containerId));
            project.setDockerStatus(DockerStatus.RUNNING);
            appendOperationLog(project.getProjectId(), "[playops] 컨테이너 시작 완료: " + project.getDockerContainerId());
            log.info("러너 컨테이너 생성 완료. project={}, container={}, containerId={}",
                    project.getProjectId(),
                    containerName,
                    project.getDockerContainerId()
            );
        } catch (Exception e) {
            project.setDockerStatus(DockerStatus.ERROR);
            appendOperationLog(project.getProjectId(), "[playops] Docker Runner 시작 실패: " + e.getMessage());
            log.error("러너 컨테이너 생성 실패. project={}, message={}", project.getProjectId(), e.getMessage());
            throw new ApiException(500, "Docker Runner 시작 실패: " + e.getMessage());
        }
    }

    public void stopRunner(Project project) {
        resetOperationLog(project.getProjectId());
        appendOperationLog(project.getProjectId(), "[playops] Docker Runner 중지 요청");
        String containerName = containerName(project.getProjectId());
        if (project.getRunnerLifecycle() == RunnerLifecycle.EPHEMERAL) {
            removeRunner(project);
            return;
        }

        ExistingContainer existing = inspectExistingContainer(containerName);
        try {
            if (existing != null && existing.running()) {
                appendOperationLog(project.getProjectId(), "[playops] 컨테이너 중지 시작: " + containerName);
                runCommand(project.getProjectId(), List.of("docker", "stop", containerName), 30);
                appendOperationLog(project.getProjectId(), "[playops] 컨테이너 중지 완료: " + containerName);
            } else {
                appendOperationLog(project.getProjectId(), "[playops] 실행 중인 컨테이너가 없습니다.");
            }
        } catch (Exception e) {
            appendOperationLog(project.getProjectId(), "[playops] 컨테이너가 이미 중지되었거나 찾을 수 없습니다: " + e.getMessage());
            log.debug("Container {} not running or already stopped", containerName);
        }
        project.setDockerContainerId(existing != null ? shortContainerId(existing.id()) : null);
        project.setDockerStatus(
                Boolean.TRUE.equals(project.getDockerEnabled())
                        ? DockerStatus.STOPPED
                        : DockerStatus.NOT_CONFIGURED
        );
    }

    public void removeRunner(Project project) {
        String containerName = containerName(project.getProjectId());
        appendOperationLog(project.getProjectId(), "[playops] 러너 컨테이너 삭제: " + containerName);
        removeContainerIfExists(containerName);
        project.setDockerContainerId(null);
        project.setDockerStatus(
                Boolean.TRUE.equals(project.getDockerEnabled())
                        ? DockerStatus.STOPPED
                        : DockerStatus.NOT_CONFIGURED
        );
    }

    public void restartRunner(Project project) {
        stopRunner(project);
        if (Boolean.TRUE.equals(project.getDockerEnabled())) {
            startRunner(project);
        }
    }

    public DockerStatus getStatus(Project project) {
        if (!Boolean.TRUE.equals(project.getDockerEnabled())) {
            return DockerStatus.NOT_CONFIGURED;
        }
        if (!properties.dockerEnabled()) {
            return DockerStatus.NOT_CONFIGURED;
        }

        String containerName = containerName(project.getProjectId());
        try {
            String output = runCommand(
                    List.of("docker", "inspect", "-f", "{{.State.Running}}", containerName),
                    10
            );
            return "true".equals(output.trim()) ? DockerStatus.RUNNING : DockerStatus.STOPPED;
        } catch (Exception e) {
            return DockerStatus.STOPPED;
        }
    }

    public RunnerOperationLog operationLog(String projectId) {
        Deque<String> lines = operationLogs.get(projectId);
        if (lines == null) {
            return new RunnerOperationLog(projectId, "", 0);
        }
        synchronized (lines) {
            return new RunnerOperationLog(projectId, String.join("\n", lines), lines.size());
        }
    }

    public List<RunnerContainer> listRunnerContainers() {
        return listDockerContainers().stream()
                .filter(container -> container.name().startsWith("playops-runner-"))
                .toList();
    }

    public List<RunnerContainer> listDockerContainers() {
        if (!properties.dockerEnabled()) {
            return List.of();
        }

        try {
            Map<String, ContainerStats> statsByName = getContainerStatsByName();
            String output = runCommand(
                    List.of(
                            "docker", "ps", "-a",
                            "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.CreatedAt}}\t{{.Status}}"
                    ),
                    10
            );
            if (output.isBlank()) {
                return List.of();
            }

            List<RunnerContainer> containers = new ArrayList<>();
            for (String line : output.split("\\R")) {
                String[] parts = line.split("\\t", -1);
                if (parts.length < 6 || parts[1].isBlank()) {
                    continue;
                }
                ContainerStats stats = statsByName.get(parts[1]);
                containers.add(new RunnerContainer(
                        parts[1],
                        parts[0],
                        parts[2],
                        "running".equalsIgnoreCase(parts[3]) ? DockerStatus.RUNNING : DockerStatus.STOPPED,
                        projectIdFromContainerName(parts[1]),
                        stats != null ? stats.cpuPercent() : "",
                        stats != null ? stats.memoryUsage() : "",
                        stats != null ? stats.memoryPercent() : "",
                        stats != null ? stats.netIo() : "",
                        stats != null ? stats.blockIo() : "",
                        parts[4],
                        "running".equalsIgnoreCase(parts[3]) ? parts[5] : ""
                ));
            }
            return containers;
        } catch (Exception e) {
            log.warn("Failed to list runner containers: {}", e.getMessage());
            return List.of();
        }
    }

    private Map<String, ContainerStats> getContainerStatsByName() {
        try {
            String output = runCommand(
                    List.of(
                            "docker", "stats", "--no-stream",
                            "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}"
                    ),
                    15
            );
            Map<String, ContainerStats> result = new HashMap<>();
            if (output.isBlank()) {
                return result;
            }
            for (String line : output.split("\\R")) {
                String[] parts = line.split("\\t", -1);
                if (parts.length < 6 || parts[0].isBlank()) {
                    continue;
                }
                result.put(parts[0], new ContainerStats(parts[1], parts[2], parts[3], parts[4], parts[5]));
            }
            return result;
        } catch (Exception e) {
            log.debug("Failed to read Docker stats: {}", e.getMessage());
            return Map.of();
        }
    }

    public boolean isDockerAvailable() {
        if (!properties.dockerEnabled()) {
            return false;
        }
        try {
            runCommand(List.of("docker", "info", "--format", "{{.ServerVersion}}"), 10);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public DockerHostResourceResponse getHostResources() {
        var osBean = ManagementFactory.getOperatingSystemMXBean();
        String hostName = "";
        try {
            hostName = InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            log.debug("Failed to resolve host name: {}", e.getMessage());
        }

        Long hostTotalMemoryBytes = null;
        Long hostFreeMemoryBytes = null;
        Long hostUsedMemoryBytes = null;
        Double hostCpuLoadPercent = null;
        if (osBean instanceof com.sun.management.OperatingSystemMXBean extendedOsBean) {
            hostTotalMemoryBytes = positiveOrNull(extendedOsBean.getTotalMemorySize());
            // Linux reports raw "free" memory as near-zero once the page cache fills up,
            // even though that cache is reclaimable on demand. MemAvailable accounts for
            // that, so prefer it over getFreeMemorySize() to avoid false "low memory" alerts.
            Long availableMemoryBytes = readLinuxMemAvailableBytes();
            hostFreeMemoryBytes = availableMemoryBytes != null
                    ? availableMemoryBytes
                    : positiveOrNull(extendedOsBean.getFreeMemorySize());
            if (hostTotalMemoryBytes != null && hostFreeMemoryBytes != null) {
                hostUsedMemoryBytes = Math.max(0, hostTotalMemoryBytes - hostFreeMemoryBytes);
            }
            double cpuLoad = extendedOsBean.getCpuLoad();
            if (cpuLoad >= 0) {
                hostCpuLoadPercent = cpuLoad * 100;
            }
        }

        Path storagePath = Path.of(properties.storageRoot()).toAbsolutePath().normalize();
        Long storageTotalBytes = null;
        Long storageUsableBytes = null;
        Long storageUsedBytes = null;
        try {
            Files.createDirectories(storagePath);
            FileStore store = Files.getFileStore(storagePath);
            storageTotalBytes = positiveOrNull(store.getTotalSpace());
            storageUsableBytes = positiveOrNull(store.getUsableSpace());
            if (storageTotalBytes != null && storageUsableBytes != null) {
                storageUsedBytes = Math.max(0, storageTotalBytes - storageUsableBytes);
            }
        } catch (Exception e) {
            log.debug("Failed to read storage usage for {}: {}", storagePath, e.getMessage());
        }

        boolean dockerAvailable = false;
        String dockerServerVersion = "";
        String dockerOSType = "";
        String dockerOperatingSystem = "";
        Integer dockerCpuCount = null;
        Long dockerMemoryBytes = null;
        String dockerRootDir = "";
        List<DockerHostResourceResponse.DockerDiskUsageItem> dockerDiskUsage = List.of();
        String message = "";

        if (!properties.dockerEnabled()) {
            message = "Docker is disabled";
        } else {
            try {
                String output = runCommand(
                        List.of(
                                "docker", "info",
                                "--format",
                                "{{.ServerVersion}}\t{{.OSType}}\t{{.OperatingSystem}}\t{{.NCPU}}\t{{.MemTotal}}\t{{.DockerRootDir}}"
                        ),
                        10
                );
                String[] parts = output.split("\\t", -1);
                dockerServerVersion = parts.length > 0 ? parts[0] : "";
                dockerOSType = parts.length > 1 ? parts[1] : "";
                dockerOperatingSystem = parts.length > 2 ? parts[2] : "";
                dockerCpuCount = parts.length > 3 ? parseInteger(parts[3]) : null;
                dockerMemoryBytes = parts.length > 4 ? parseLong(parts[4]) : null;
                dockerRootDir = parts.length > 5 ? parts[5] : "";
                dockerDiskUsage = getDockerDiskUsage();
                dockerAvailable = true;
            } catch (Exception e) {
                message = e.getMessage();
                log.debug("Failed to read Docker host resources: {}", e.getMessage());
            }
        }

        return new DockerHostResourceResponse(
                hostName,
                osBean.getName(),
                osBean.getVersion(),
                osBean.getArch(),
                osBean.getAvailableProcessors(),
                hostCpuLoadPercent,
                hostTotalMemoryBytes,
                hostFreeMemoryBytes,
                hostUsedMemoryBytes,
                storagePath.toString(),
                storageTotalBytes,
                storageUsableBytes,
                storageUsedBytes,
                dockerAvailable,
                dockerServerVersion,
                dockerOSType,
                dockerOperatingSystem,
                dockerCpuCount,
                dockerMemoryBytes,
                dockerRootDir,
                dockerDiskUsage,
                message
        );
    }

    private Long readLinuxMemAvailableBytes() {
        Path meminfo = Path.of("/proc/meminfo");
        if (!Files.isReadable(meminfo)) {
            return null;
        }
        try (BufferedReader reader = Files.newBufferedReader(meminfo)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("MemAvailable:")) {
                    String[] fields = line.trim().split("\\s+");
                    if (fields.length >= 2) {
                        return Long.parseLong(fields[1]) * 1024;
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Failed to read /proc/meminfo: {}", e.getMessage());
        }
        return null;
    }

    public void removeRunnerContainer(String containerName) {
        if (containerName == null || !containerName.startsWith("playops-runner-")) {
            throw new ApiException(400, "Invalid runner container name");
        }
        removeDockerContainer(containerName);
    }

    public void removeDockerContainer(String containerName) {
        if (containerName == null || containerName.isBlank()) {
            throw new ApiException(400, "Invalid container name");
        }
        try {
            runCommand(List.of("docker", "rm", "-f", containerName), 30);
        } catch (Exception e) {
            throw new ApiException(500, "Failed to remove Docker container " + containerName + ": " + e.getMessage());
        }
    }

    private void startExistingRunner(Project project, String containerName, ExistingContainer existing) {
        try {
            if (!existing.running()) {
                appendOperationLog(project.getProjectId(), "[playops] 기존 컨테이너 시작: " + containerName);
                runCommand(project.getProjectId(), List.of("docker", "start", containerName), 30);
            }
            project.setDockerContainerId(shortContainerId(existing.id()));
            project.setDockerStatus(DockerStatus.RUNNING);
            appendOperationLog(project.getProjectId(), "[playops] 기존 컨테이너 준비 완료: " + project.getDockerContainerId());
            log.info("Started existing runner container {} for project {}", containerName, project.getProjectId());
        } catch (Exception e) {
            project.setDockerStatus(DockerStatus.ERROR);
            appendOperationLog(project.getProjectId(), "[playops] 기존 컨테이너 시작 실패: " + e.getMessage());
            log.error("Failed to start existing runner for project {}: {}", project.getProjectId(), e.getMessage());
            throw new ApiException(500, "Failed to start Docker runner: " + e.getMessage());
        }
    }

    private ExistingContainer inspectExistingContainer(String containerName) {
        try {
            String output = runCommand(
                    List.of("docker", "inspect", "-f", "{{.Id}}\t{{.State.Running}}\t{{.Config.Image}}", containerName),
                    10
            );
            String[] parts = output.split("\\t", -1);
            if (parts.length < 3 || parts[0].isBlank()) {
                return null;
            }
            return new ExistingContainer(parts[0], "true".equalsIgnoreCase(parts[1].trim()), parts[2].trim());
        } catch (Exception e) {
            return null;
        }
    }

    private void removeContainerIfExists(String containerName) {
        try {
            runCommand(List.of("docker", "rm", "-f", containerName), 30);
        } catch (Exception e) {
            log.debug("Container {} not running or already removed", containerName);
        }
    }

    public String containerName(String projectId) {
        return "playops-runner-" + projectId;
    }

    /** startRunner()가 컨테이너에 부여하는 작업 디렉토리와 동일한 값을 계산한다 (docker exec -w 등에서 재사용). */
    public String containerWorkDir(String projectId) {
        if (isWindowsHost()) {
            return "/playwright-projects/" + projectId;
        }
        return java.nio.file.Path.of(properties.projectsRoot(), projectId)
                .toAbsolutePath()
                .normalize()
                .toString()
                .replace('\\', '/');
    }

    private boolean isWindowsHost() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    /** startRunner()가 프로젝트 디렉토리를 마운트하는 방식과 동일한 docker 인자를 반환한다 (clone 헬퍼 컨테이너 등에서 재사용). */
    public List<String> projectVolumeArgs(String projectId) {
        if (isWindowsHost()) {
            String rawPath = java.nio.file.Path.of(properties.projectsRoot(), projectId)
                    .toAbsolutePath()
                    .normalize()
                    .toString()
                    .replace('\\', '/');
            return List.of("-v", rawPath + ":" + containerWorkDir(projectId));
        }
        return List.of("--volumes-from", "playops-api");
    }

    /** 러너 관련 서비스(clone 등)가 동일한 진행 로그 스트림에 라인을 추가할 수 있도록 공개한다. */
    public void logOperation(String projectId, String line) {
        appendOperationLog(projectId, line);
    }

    public String projectIdFromContainerName(String containerName) {
        if (containerName == null || !containerName.startsWith("playops-runner-")) {
            return "";
        }
        return containerName.substring("playops-runner-".length());
    }

    private List<DockerHostResourceResponse.DockerDiskUsageItem> getDockerDiskUsage() {
        try {
            String output = runCommand(
                    List.of(
                            "docker", "system", "df",
                            "--format", "{{.Type}}\t{{.TotalCount}}\t{{.Active}}\t{{.Size}}\t{{.Reclaimable}}"
                    ),
                    15
            );
            if (output.isBlank()) {
                return List.of();
            }

            List<DockerHostResourceResponse.DockerDiskUsageItem> result = new ArrayList<>();
            for (String line : output.split("\\R")) {
                String[] parts = line.split("\\t", -1);
                if (parts.length < 5 || parts[0].isBlank()) {
                    continue;
                }
                result.add(new DockerHostResourceResponse.DockerDiskUsageItem(
                        parts[0],
                        parts[1],
                        parts[2],
                        parts[3],
                        parts[4]
                ));
            }
            return result;
        } catch (Exception e) {
            log.debug("Failed to read Docker disk usage: {}", e.getMessage());
            return List.of();
        }
    }

    private void ensureRunnerImage(String projectId, String image, String nodeVersion, String playwrightVersion) {
        try {
            runCommand(List.of("docker", "image", "inspect", image), 10);
            appendOperationLog(projectId, "[playops] 러너 이미지 준비 완료: " + image);
            return;
        } catch (Exception ignored) {
            appendOperationLog(projectId, "[playops] 러너 이미지가 없어 먼저 빌드합니다: " + image);
            log.info(
                    "러너 이미지가 없어 먼저 빌드합니다. 빌드 완료 후 컨테이너를 생성합니다. image={}, node={}, playwright={}",
                    image,
                    normalizeNodeVersion(nodeVersion),
                    normalizePlaywrightVersion(playwrightVersion)
            );
        }

        String dockerfile = "/app/runner.Dockerfile";
        try {
            runCommand(
                    projectId,
                    List.of(
                            "docker", "build",
                            "--no-cache",
                            "--force-rm",
                            "-f", dockerfile,
                            "--build-arg", "NODE_VERSION=" + normalizeNodeVersion(nodeVersion),
                            "--build-arg", "PLAYWRIGHT_VERSION=" + normalizePlaywrightVersion(playwrightVersion),
                            "-t", image,
                            "/app"
                    ),
                    900
            );
            appendOperationLog(projectId, "[playops] 러너 이미지 빌드 완료. 컨테이너 생성을 계속합니다.");
            log.info("러너 이미지 빌드 완료. 컨테이너 생성을 계속합니다. image={}", image);
        } catch (Exception e) {
            appendOperationLog(projectId, "[playops] 러너 이미지 빌드 실패: " + e.getMessage());
            throw new ApiException(500, "Docker Runner 이미지 빌드 실패\n" + summarizeDockerBuildError(e.getMessage()));
        }
    }

    private String summarizeDockerBuildError(String output) {
        if (output == null || output.isBlank()) {
            return "Docker build failed without output.";
        }

        List<String> lines = output.lines()
                .map(this::stripAnsi)
                .map(String::trim)
                .filter(line -> !line.isBlank())
                .filter(line -> !line.startsWith("DEPRECATED: The legacy builder is deprecated"))
                .filter(line -> !line.startsWith("Install the buildx component"))
                .filter(line -> !line.startsWith("https://docs.docker.com/go/buildx/"))
                .filter(line -> !line.startsWith("Sending build context to Docker daemon"))
                .toList();

        List<String> important = lines.stream()
                .filter(line -> {
                    String lower = line.toLowerCase();
                    return lower.contains("error")
                            || lower.contains("failed")
                            || lower.contains("not found")
                            || lower.contains("no such")
                            || lower.contains("denied")
                            || lower.contains("timeout")
                            || lower.contains("unable");
                })
                .toList();

        List<String> selected = important.isEmpty()
                ? lines.subList(Math.max(0, lines.size() - 20), lines.size())
                : important.subList(Math.max(0, important.size() - 12), important.size());

        return String.join("\n", selected);
    }

    private String stripAnsi(String value) {
        return ANSI_ESCAPE_PATTERN.matcher(value).replaceAll("");
    }

    private String runnerImage(String nodeVersion, String playwrightVersion) {
        return "playops-runner:node"
                + safeTag(normalizeNodeVersion(nodeVersion))
                + "-pw"
                + safeTag(normalizePlaywrightVersion(playwrightVersion));
    }

    private String normalizeNodeVersion(String version) {
        return RuntimeVersions.RESOLVED_NODE_VERSION;
    }

    private String normalizePlaywrightVersion(String version) {
        return RuntimeVersions.PLAYWRIGHT_VERSION;
    }

    private String safeTag(String value) {
        return value.replaceAll("[^A-Za-z0-9_.-]", "-");
    }

    private String shortContainerId(String containerId) {
        if (containerId == null) {
            return null;
        }
        return containerId.substring(0, Math.min(12, containerId.length()));
    }

    private Long positiveOrNull(long value) {
        return value >= 0 ? value : null;
    }

    private Integer parseInteger(String value) {
        try {
            return Integer.parseInt(value.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private Long parseLong(String value) {
        try {
            return Long.parseLong(value.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private String runCommand(List<String> command, int timeoutSeconds) throws Exception {
        return commandRunner.run(command, timeoutSeconds, null);
    }

    private String runCommand(String projectId, List<String> command, int timeoutSeconds) throws Exception {
        appendOperationLog(projectId, "$ " + String.join(" ", command));
        return commandRunner.run(command, timeoutSeconds, line -> appendOperationLog(projectId, line));
    }

    private void resetOperationLog(String projectId) {
        if (projectId == null || projectId.isBlank()) {
            return;
        }
        operationLogs.put(projectId, new ArrayDeque<>());
    }

    private void appendOperationLog(String projectId, String line) {
        if (projectId == null || projectId.isBlank() || line == null || line.isBlank()) {
            return;
        }
        Deque<String> lines = operationLogs.computeIfAbsent(projectId, ignored -> new ArrayDeque<>());
        synchronized (lines) {
            lines.addLast(stripAnsi(line));
            while (lines.size() > MAX_OPERATION_LOG_LINES) {
                lines.removeFirst();
            }
        }
    }

    private static String runProcessCommand(List<String> command, int timeoutSeconds, Consumer<String> outputConsumer) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();

        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
                if (outputConsumer != null) {
                    outputConsumer.accept(line);
                }
            }
        }

        if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new ApiException(500, "Docker command timed out");
        }

        if (process.exitValue() != 0) {
            throw new ApiException(500, output.toString().trim());
        }

        return output.toString().trim();
    }

    private String parseContainerId(String output) {
        String[] lines = output.split("\\R");
        for (int i = lines.length - 1; i >= 0; i--) {
            String line = lines[i].trim();
            if (line.matches("[a-f0-9]{12,64}")) {
                return line;
            }
        }
        throw new ApiException(500, "Docker did not return a container id: " + output);
    }

    @FunctionalInterface
    interface CommandRunner {
        String run(List<String> command, int timeoutSeconds, Consumer<String> outputConsumer) throws Exception;
    }

    public record RunnerOperationLog(
            String projectId,
            String output,
            int lineCount
    ) {}

    private record ExistingContainer(
            String id,
            boolean running,
            String image
    ) {}

    public record RunnerContainer(
            String name,
            String containerId,
            String image,
            DockerStatus dockerStatus,
            String projectId,
            String cpuPercent,
            String memoryUsage,
            String memoryPercent,
            String netIo,
            String blockIo,
            String createdAt,
            String uptime
    ) {}

    public record ContainerStats(
            String cpuPercent,
            String memoryUsage,
            String memoryPercent,
            String netIo,
            String blockIo
    ) {}
}
