package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.dto.ArtifactFile;
import com.playops.api.dto.ExecutionCaseResultResponse;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import jakarta.transaction.Transactional;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

@Service
public class ExecutionQueryService {

    private static final Set<ExecutionStatus> DELETE_BLOCKED_STATUSES = Set.of(
            ExecutionStatus.PENDING,
            ExecutionStatus.RUNNING,
            ExecutionStatus.CANCEL_REQUESTED
    );

    private final ExecutionRepository executionRepository;
    private final ExecutionCaseResultRepository executionCaseResultRepository;
    private final TestExecutionService testExecutionService;
    private final PlayOpsProperties properties;

    public ExecutionQueryService(
            ExecutionRepository executionRepository,
            ExecutionCaseResultRepository executionCaseResultRepository,
            TestExecutionService testExecutionService,
            PlayOpsProperties properties
    ) {
        this.executionRepository = executionRepository;
        this.executionCaseResultRepository = executionCaseResultRepository;
        this.testExecutionService = testExecutionService;
        this.properties = properties;
    }

    public List<ExecutionResponse> listByProject(String projectId) {
        return executionRepository.findByProjectIdOrderByCreatedAtDesc(projectId).stream()
                .map(ExecutionResponse::from)
                .toList();
    }

    public ExecutionDetailResponse getDetail(Long executionId) {
        Execution execution = getExecution(executionId);
        Path reportDir = resolveReportDir(execution);
        List<ArtifactFile> artifacts = listArtifacts(reportDir);
        String htmlUrl = artifacts.stream()
                .filter(a -> a.type().equals("report") || a.path().endsWith("index.html"))
                .findFirst()
                .map(a -> "/api/executions/" + executionId + "/artifact?path=" + a.path())
                .orElse(null);

        List<ExecutionCaseResultResponse> caseResults = executionCaseResultRepository
                .findByExecutionIdOrderByIdAsc(executionId).stream()
                .map(ExecutionCaseResultResponse::from)
                .toList();

        return new ExecutionDetailResponse(
                ExecutionResponse.from(execution),
                execution.getLogOutput(),
                artifacts,
                htmlUrl,
                caseResults
        );
    }

    public ExecutionResponse cancelExecution(Long executionId) {
        return ExecutionResponse.from(testExecutionService.cancelExecution(executionId));
    }

    @Transactional
    public void deleteExecution(Long executionId) {
        Execution execution = getExecution(executionId);
        ensureDeletable(execution);
        deleteReportDirectory(execution);
        executionRepository.delete(execution);
    }

    @Transactional
    public void resetProjectExecutions(String projectId) {
        List<Execution> executions = executionRepository.findByProjectIdOrderByCreatedAtDesc(projectId);
        boolean hasActiveExecution = executions.stream().anyMatch(execution ->
                DELETE_BLOCKED_STATUSES.contains(execution.getStatus())
        );
        if (hasActiveExecution) {
            throw new ApiException(409, "실행 중이거나 대기 중인 이력이 있습니다. 먼저 중단 또는 완료 후 초기화하세요.");
        }

        for (Execution execution : executions) {
            deleteReportDirectory(execution);
        }
        executionRepository.deleteByProjectId(projectId);
        deleteProjectReportDirectoryIfEmpty(projectId);
    }

    public ExecutionResponse triggerRun(
            String projectId, String grep, String specPath, List<String> specPaths, String caseTitle, boolean sequential
    ) {
        return triggerRun(projectId, grep, specPath, specPaths, caseTitle, sequential, null);
    }

    /** 실행 중으로 보는 상태 — 이 중 하나가 있으면 같은 프로젝트에 새 실행을 만들지 않는다 */
    static final List<ExecutionStatus> ACTIVE =
            List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED);

    // ponytail: 서버 한 대 기준 프로젝트별 JVM 잠금. 서버를 여러 대 띄우면 DB 잠금(SELECT … FOR UPDATE)으로 바꾼다.
    private final Map<String, Object> runLocks = new ConcurrentHashMap<>();

    /**
     * rerunOf: 결함 다시 실행(#82)이면 실패했던 원래 실행.
     * 전체 · 선택 · 스위트 · 결함 다시 실행 · 채팅 실행이 모두 여기를 지난다. 같은 프로젝트가 실행 중이면 409 (3차 3번).
     */
    public ExecutionResponse triggerRun(
            String projectId, String grep, String specPath, List<String> specPaths, String caseTitle, boolean sequential,
            Long rerunOf
    ) {
        Execution execution;
        synchronized (runLocks.computeIfAbsent(projectId, k -> new Object())) {
            if (executionRepository.existsByProjectIdAndStatusIn(projectId, ACTIVE)) {
                throw new ApiException(409, "이미 실행 중입니다. 끝나거나 중지한 뒤에 다시 실행하세요.");
            }
            execution = testExecutionService.createExecution(projectId, grep, specPath, specPaths, caseTitle, sequential);
        }
        execution.setRerunOf(rerunOf);
        Path reportDir = Path.of(properties.storageRoot(), "reports", projectId, String.valueOf(execution.getId()));
        execution.setReportPath(reportDir.toString().replace('\\', '/'));
        executionRepository.save(execution);
        try {
            testExecutionService.runExecutionAsync(execution.getId());
        } catch (TaskRejectedException e) {
            executionRepository.deleteById(execution.getId());
            throw new ApiException(429, "실행 대기열이 가득 찼습니다. 실행 중인 테스트가 끝난 뒤 다시 시도하세요.");
        }
        return ExecutionResponse.from(execution);
    }

    public Resource getArtifactResource(Long executionId, String relativePath) {
        Execution execution = getExecution(executionId);
        Path file = resolveArtifactPath(execution, relativePath);
        if (!Files.exists(file) || !Files.isRegularFile(file)) {
            throw new ApiException(404, "Artifact not found");
        }
        return new FileSystemResource(file);
    }

    public MediaType resolveMediaType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return MediaType.TEXT_HTML;
        if (lower.endsWith(".png")) return MediaType.IMAGE_PNG;
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return MediaType.IMAGE_JPEG;
        if (lower.endsWith(".webm")) return MediaType.parseMediaType("video/webm");
        if (lower.endsWith(".zip")) return MediaType.APPLICATION_OCTET_STREAM;
        if (lower.endsWith(".json")) return MediaType.APPLICATION_JSON;
        return MediaType.APPLICATION_OCTET_STREAM;
    }

    public List<ExecutionResponse> historyByGrep(String projectId, String grep) {
        if (grep == null || grep.isBlank()) {
            return List.of();
        }
        return executionRepository.findByProjectIdAndGrepFilterOrderByCreatedAtDesc(projectId, grep).stream()
                .map(ExecutionResponse::from)
                .toList();
    }

    public Execution getExecution(Long id) {
        return executionRepository.findById(id)
                .orElseThrow(() -> new ApiException(404, "Execution not found"));
    }

    private Path resolveReportDir(Execution execution) {
        String reportPath = execution.getReportPath();
        if (reportPath == null) {
            return Path.of(properties.storageRoot(), "reports", execution.getProjectId(), String.valueOf(execution.getId()));
        }
        Path dir = Path.of(reportPath);
        if (dir.isAbsolute()) {
            return dir.normalize();
        }
        if (reportPath.startsWith("reports/")) {
            return Path.of(properties.storageRoot()).resolve(reportPath).normalize();
        }
        return Path.of(properties.storageRoot(), "reports", execution.getProjectId(), String.valueOf(execution.getId())).normalize();
    }

    private void ensureDeletable(Execution execution) {
        if (DELETE_BLOCKED_STATUSES.contains(execution.getStatus())) {
            throw new ApiException(409, "실행 중이거나 대기 중인 이력은 삭제할 수 없습니다. 먼저 중단 또는 완료 후 삭제하세요.");
        }
    }

    private void deleteReportDirectory(Execution execution) {
        Path reportDir = resolveReportDir(execution).toAbsolutePath().normalize();
        Path reportsRoot = Path.of(properties.storageRoot(), "reports").toAbsolutePath().normalize();
        if (!reportDir.startsWith(reportsRoot)) {
            throw new ApiException(400, "리포트 경로가 안전한 저장소 범위를 벗어났습니다.");
        }
        deleteDirectory(reportDir);
    }

    private void deleteProjectReportDirectoryIfEmpty(String projectId) {
        Path projectReportDir = Path.of(properties.storageRoot(), "reports", projectId).toAbsolutePath().normalize();
        Path reportsRoot = Path.of(properties.storageRoot(), "reports").toAbsolutePath().normalize();
        if (!projectReportDir.startsWith(reportsRoot)) {
            return;
        }
        try {
            if (Files.isDirectory(projectReportDir)) {
                try (Stream<Path> entries = Files.list(projectReportDir)) {
                    if (entries.findAny().isEmpty()) {
                        Files.deleteIfExists(projectReportDir);
                    }
                }
            }
        } catch (IOException e) {
            throw new ApiException(500, "프로젝트 리포트 디렉터리 정리 실패: " + e.getMessage());
        }
    }

    private void deleteDirectory(Path directory) {
        if (!Files.exists(directory)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(directory)) {
            walk.sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (IOException e) {
                            throw new DeleteFailedException(e);
                        }
                    });
        } catch (DeleteFailedException e) {
            throw new ApiException(500, "실행 결과 파일 삭제 실패: " + e.getCause().getMessage());
        } catch (IOException e) {
            throw new ApiException(500, "실행 결과 파일 삭제 실패: " + e.getMessage());
        }
    }

    private static class DeleteFailedException extends RuntimeException {
        private DeleteFailedException(IOException cause) {
            super(cause);
        }
    }

    private List<ArtifactFile> listArtifacts(Path reportDir) {
        if (!Files.exists(reportDir)) {
            return List.of();
        }
        List<ArtifactFile> result = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(reportDir)) {
            walk.filter(Files::isRegularFile)
                    .sorted(Comparator.comparing(p -> reportDir.relativize(p).toString()))
                    .forEach(p -> {
                        String rel = reportDir.relativize(p).toString().replace('\\', '/');
                        try {
                            result.add(new ArtifactFile(
                                    rel,
                                    p.getFileName().toString(),
                                    classifyArtifact(rel),
                                    Files.size(p)
                            ));
                        } catch (IOException ignored) {}
                    });
        } catch (IOException e) {
            throw new ApiException(500, "Failed to list artifacts: " + e.getMessage());
        }
        return result;
    }

    private String classifyArtifact(String path) {
        String lower = path.toLowerCase();
        if (lower.contains("playwright-report") && lower.endsWith(".html")) return "report";
        if (lower.endsWith(".webm")) return "video";
        if (lower.endsWith(".zip") && lower.contains("trace")) return "trace";
        if (lower.endsWith(".png") || lower.endsWith(".jpg")) return "screenshot";
        if (lower.endsWith(".log") || lower.endsWith(".json")) return "log";
        return "file";
    }

    private Path resolveArtifactPath(Execution execution, String relativePath) {
        if (relativePath == null || relativePath.contains("..")) {
            throw new ApiException(400, "Invalid path");
        }
        Path reportDir = resolveReportDir(execution).toAbsolutePath().normalize();
        Path resolved = reportDir.resolve(relativePath.replace('\\', '/')).normalize();
        if (!resolved.startsWith(reportDir)) {
            throw new ApiException(400, "Invalid path");
        }
        return resolved;
    }
}
